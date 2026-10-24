import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  type CallToolResult,
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";
import { collectScopeRepos, describeSyncScope, parseSyncScope } from "../cliSupport.ts";
import { type CustomPreset, isPresetId, PRESET_IDS, type PresetRef } from "../presets/index.ts";
import { AuthError, getAuthInfo } from "../services/auth.ts";
import { type DivergenceStrategy, firstErrorLine } from "../services/cloner.ts";
import { searchCode } from "../services/codeSearch.ts";
import {
  appConfigDir,
  CONFIG_FILENAME,
  type EnvLike,
  type RepoInventoryEntry,
  type RepotruckConfig,
  readAgentsMd,
} from "../services/config.ts";
import { createRepository } from "../services/creator.ts";
import { runDoctor } from "../services/doctor.ts";
import { filterReposByKey } from "../services/filters.ts";
import { fileEtagCache, GitHubService } from "../services/github.ts";
import {
  detectApps,
  listAliases,
  removeAlias,
  resolveApp,
  resolveRepoRef,
  runAppInRepo,
  type SpawnRequest,
  setAlias,
} from "../services/launcher.ts";
import {
  archiveRepository,
  deleteRepository,
  forgetRepository,
  pruneWorkspace,
  workspaceStatus,
} from "../services/lifecycle.ts";
import { moveRepository } from "../services/mover.ts";
import { createProgressHub, isRepoProgressEvent } from "../services/progressHub.ts";
import { reorganizeWorkspace } from "../services/reorganizer.ts";
import { runInRepos } from "../services/runner.ts";
import { effectiveRoot, readCustomPresets, resolveGithubBaseUrl } from "../services/settings.ts";
import { quoteForShell } from "../services/shellQuote.ts";
import { cloneSingleRepository, parseGitUrl } from "../services/singleCloner.ts";
import { calculateWorkspaceStats, walkRepositoriesOnDisk } from "../services/stats.ts";
import { readVersion } from "../services/version.ts";
import { loadWorkspace, saveWorkspace, syncRepos, toPosixRelative } from "../services/workspace.ts";
import {
  isRegisteredWorkspace,
  listWorkspaces,
  removeWorkspace,
  resolveWorkspaceRoot,
} from "../services/workspaceRegistry.ts";

export interface McpServerOptions {
  env?: EnvLike;
  cwd?: string;
  version?: string;
  /** GitHub Enterprise base URL override (same as the CLI's --base-url). */
  baseUrl?: string;
}

const ROOT_PARAM_DESCRIPTION =
  "Workspace root directory. Default: the nearest registered workspace found walking up from the MCP server's working directory (records live in the central repotruck.json in the app config dir), otherwise the configured default root (settings.json), otherwise the OS default.";

const rootParam = z.string().optional().describe(ROOT_PARAM_DESCRIPTION);

const presetParam = z
  .string()
  .optional()
  .describe(
    `Directory layout preset for the target placement: ${PRESET_IDS.join(", ")}, or a custom preset defined with 'repotruck preset add'`,
  );

const presetRequired = z
  .string()
  .describe(`Target preset: ${PRESET_IDS.join(", ")}, or a custom preset id`);

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function okText(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function guarded(action: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message);
    return fail(firstErrorLine(error));
  }
}

function makeRequirePreset(customPresets: readonly CustomPreset[]) {
  return (value: string): PresetRef => {
    if (isPresetId(value)) return value;
    if (customPresets.some((preset) => preset.id === value)) return value;
    throw new Error(
      `invalid preset: ${value} (expected ${PRESET_IDS.join(", ")}, or a custom preset defined with 'repotruck preset add')`,
    );
  };
}

function aliasesByPath(config: RepotruckConfig): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(config.aliases ?? {})) {
    const key = target.toLowerCase();
    const current = map.get(key) ?? [];
    current.push(alias);
    map.set(key, current);
  }
  return map;
}

function repoView(
  root: string,
  entry: RepoInventoryEntry,
  aliases: Map<string, string[]>,
): Record<string, unknown> {
  const absolutePath = path.join(root, ...entry.relativePath.split("/"));
  return {
    key: `${entry.owner}/${entry.name}`,
    owner: entry.owner,
    name: entry.name,
    relativePath: entry.relativePath,
    absolutePath,
    onDisk: existsSync(absolutePath),
    category: entry.category,
    internal: entry.internal,
    language: entry.language,
    updatedAt: entry.updatedAt,
    custom: entry.custom === true,
    aliases: (aliases.get(entry.relativePath.toLowerCase()) ?? []).sort((a, b) =>
      a.localeCompare(b),
    ),
  };
}

export type ProgressSink = (progress: number, total: number | undefined, message: string) => void;

interface ProgressCapableRequest {
  _meta?: Record<string, unknown>;
  notify?: (notification: { method: string; params: Record<string, unknown> }) => Promise<void>;
}

export function progressSinkFromContext(ctx: unknown): ProgressSink | null {
  const mcpReq = (ctx as { mcpReq?: ProgressCapableRequest } | null | undefined)?.mcpReq;
  if (mcpReq === undefined || typeof mcpReq.notify !== "function") return null;
  const token = mcpReq._meta?.progressToken;
  if (typeof token !== "string" && typeof token !== "number") return null;
  const notify = mcpReq.notify.bind(mcpReq);
  return (progress, total, message) => {
    void notify({
      method: "notifications/progress",
      params: {
        progressToken: token,
        progress,
        ...(total !== undefined ? { total } : {}),
        ...(message.length > 0 ? { message } : {}),
      },
    }).catch(() => {});
  };
}

export function bridgeHubToSink(
  hub: ReturnType<typeof createProgressHub>,
  sink: ProgressSink,
): void {
  hub.subscribe((event) => {
    if (!isRepoProgressEvent(event)) return;
    sink(
      event.index ?? 0,
      event.total,
      `${event.key} — ${event.phase}${event.message ? `: ${event.message}` : ""}`,
    );
  });
}

function detachedSpawnImpl(request: SpawnRequest): Promise<number> {
  const attempt = (useShell: boolean): Promise<number> =>
    new Promise((resolve, reject) => {
      const child = useShell
        ? spawn(quoteForShell(request.command, request.args), {
            cwd: request.cwd,
            stdio: "ignore",
            detached: true,
            shell: true,
            windowsHide: false,
          })
        : spawn(request.command, request.args, {
            cwd: request.cwd,
            stdio: "ignore",
            detached: true,
            windowsHide: false,
          });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve(0);
      });
    });
  return attempt(false).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return attempt(true);
    }
    throw error;
  });
}

function workspaceTreeText(root: string): Promise<string> {
  const MAX_DEPTH = 3;
  const MAX_ENTRIES = 200;

  async function walk(dir: string, depth: number): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return ["(unreadable directory)"];
    }
    const visible = entries
      .filter((item) => item.name !== ".git" && item.name !== "node_modules")
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    const shown = visible.slice(0, MAX_ENTRIES);
    const out: string[] = [];
    for (const [index, entry] of shown.entries()) {
      const last = index === shown.length - 1 && visible.length <= MAX_ENTRIES;
      const branch = last ? "└── " : "├── ";
      out.push(`${branch}${entry.name}${entry.isDirectory() ? "/" : ""}`);
      if (entry.isDirectory() && depth < MAX_DEPTH) {
        const nested = await walk(path.join(dir, entry.name), depth + 1);
        const pad = last ? "    " : "│   ";
        out.push(...nested.map((line) => `${pad}${line}`));
      }
    }
    if (visible.length > MAX_ENTRIES) {
      out.push(`└── … ${visible.length - MAX_ENTRIES} more`);
    }
    return out;
  }

  return walk(root, 1).then((out) => [root, ...out].join("\n"));
}

export async function createRepotruckMcpServer(options: McpServerOptions = {}): Promise<McpServer> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const version = options.version ?? (await readVersion());
  const customPresets = await readCustomPresets(env);
  const requirePresetRef = makeRequirePreset(customPresets);
  const server = new McpServer({ name: "repotruck", version });

  async function resolveRoot(rootArg?: string): Promise<string> {
    if (rootArg !== undefined && rootArg.length > 0) return path.resolve(rootArg);
    const walked = await resolveWorkspaceRoot(cwd, env);
    if (walked.found) return walked.root;
    return (await effectiveRoot(env)).root;
  }

  async function requireWorkspaceRoot(rootArg?: string): Promise<string> {
    const root = await resolveRoot(rootArg);
    const registered = await isRegisteredWorkspace(root, env);
    const legacy = existsSync(path.join(root, CONFIG_FILENAME));
    if (!registered && !legacy) {
      throw new Error(
        `not a repotruck workspace (no record for it in the central repotruck.json): ${root} — pass an explicit root, or create the workspace first with repotruck_sync / repotruck_clone`,
      );
    }
    return root;
  }

  async function requireAuth(): Promise<{ token: string; github: GitHubService }> {
    // The MCP server never has an interactive terminal for the device flow,
    // so authentication must come from the environment, gh, or a cached login.
    const auth = await getAuthInfo(env, { interactive: false });
    const baseUrl = await resolveGithubBaseUrl(env, options.baseUrl);
    return {
      token: auth.token,
      github: new GitHubService(auth.token, {
        baseUrl,
        ...(env.REPOTRUCK_NO_API_CACHE
          ? {}
          : { etagCache: fileEtagCache(path.join(appConfigDir(env), "github-cache.json")) }),
      }),
    };
  }

  server.registerTool(
    "repotruck_list_workspaces",
    {
      title: "List workspaces",
      description:
        "List every registered repotruck workspace: absolute path, preset, repository count, last sync time, last use time, and whether the directory is still on disk. Use this first to discover which workspace roots exist before calling other tools.",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () =>
      guarded(async () => {
        const workspaces = await listWorkspaces(env);
        return ok({ workspaces });
      }),
  );

  server.registerTool(
    "repotruck_workspace_status",
    {
      title: "Workspace status",
      description:
        "Inspect one workspace: whether it is initialized (registered in the central repotruck.json), the active preset, last sync time, repository counts split by internal/community/custom, and the alias map. Read-only.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({ root: rootParam }),
    },
    async ({ root: rootArg }) =>
      guarded(async () => {
        const root = await resolveRoot(rootArg);
        const initialized =
          (await isRegisteredWorkspace(root, env)) || existsSync(path.join(root, CONFIG_FILENAME));
        const config = await loadWorkspace(root, undefined, env);
        return ok({
          root,
          initialized,
          preset: initialized ? config.preset : null,
          lastSync: initialized ? config.lastSync : null,
          totalRepos: initialized ? config.repos.length : 0,
          internalRepos: config.repos.filter((repo) => repo.internal).length,
          communityRepos: config.repos.filter((repo) => !repo.internal).length,
          customRepos: config.repos.filter((repo) => repo.custom === true).length,
          aliases: Object.fromEntries(listAliases(config).map((a) => [a.alias, a.target])),
          agentsMd: existsSync(path.join(root, "AGENTS.md")),
        });
      }),
  );

  server.registerTool(
    "repotruck_list_repos",
    {
      title: "List repositories",
      description:
        "List the repositories tracked by a workspace, with workspace-relative and absolute paths, category (source/forks/archived), language, updatedAt, custom flag and aliases. Optional filters: internal vs community, category, custom. Requires an initialized workspace.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({
        root: rootParam,
        internal: z
          .boolean()
          .optional()
          .describe("Only your own (true) or only community (false) repositories"),
        category: z
          .enum(["source", "forks", "archived"])
          .optional()
          .describe("Filter by repository category"),
        custom: z
          .boolean()
          .optional()
          .describe("Only manually placed (true) or preset-placed (false) repositories"),
        limit: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Max repositories to return (default 500; totalCount reports the full count)"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Skip the first N repositories of the filtered list (default 0)"),
      }),
    },
    async ({ root: rootArg, internal, category, custom, limit, offset }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root);
        const aliases = aliasesByPath(config);
        let repos = config.repos;
        if (internal !== undefined) repos = repos.filter((repo) => repo.internal === internal);
        if (category !== undefined) repos = repos.filter((repo) => repo.category === category);
        if (custom !== undefined) repos = repos.filter((repo) => (repo.custom === true) === custom);
        const totalCount = repos.length;
        const start = offset ?? 0;
        const page = repos.slice(start, start + (limit ?? 500));
        return ok({
          root,
          preset: config.preset,
          count: page.length,
          totalCount,
          offset: start,
          ...(start + page.length < totalCount ? { nextOffset: start + page.length } : {}),
          repos: page.map((entry) => repoView(root, entry, aliases)),
        });
      }),
  );

  server.registerTool(
    "repotruck_search_repos",
    {
      title: "Search repositories",
      description:
        "Case-insensitive substring search over a workspace's tracked repositories: matches owner, name, owner/name, relative path, language and alias. Returns matches with absolute paths. Requires an initialized workspace.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({
        query: z.string().min(1).describe("Substring to match"),
        root: rootParam,
        limit: z.number().int().positive().max(200).optional().describe("Max results (default 25)"),
      }),
    },
    async ({ query, root: rootArg, limit }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root);
        const aliases = aliasesByPath(config);
        const needle = query.toLowerCase();
        const matches = config.repos.filter((entry) => {
          const haystacks = [
            entry.owner,
            entry.name,
            `${entry.owner}/${entry.name}`,
            entry.relativePath,
            entry.language ?? "",
            ...(aliases.get(entry.relativePath.toLowerCase()) ?? []),
          ];
          return haystacks.some((value) => value.toLowerCase().includes(needle));
        });
        const capped = matches.slice(0, limit ?? 25);
        return ok({
          root,
          query,
          count: capped.length,
          totalCount: matches.length,
          repos: capped.map((entry) => repoView(root, entry, aliases)),
        });
      }),
  );

  server.registerTool(
    "repotruck_resolve_repo",
    {
      title: "Resolve repository reference",
      description:
        "Resolve a repository reference (alias, workspace-relative path, or owner/name) inside a workspace to its inventory entry and absolute path on disk. Use this before reading or editing a repository to learn where it lives.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({
        ref: z.string().min(1).describe("Alias, workspace-relative path, or owner/name"),
        root: rootParam,
      }),
    },
    async ({ ref, root: rootArg }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root);
        const match = resolveRepoRef(config, ref);
        if (match === null) {
          const aliases = listAliases(config).map((item) => item.alias);
          const candidates = [
            ...aliases,
            ...config.repos.map((item) => item.relativePath),
            ...config.repos.map((item) => `${item.owner}/${item.name}`),
          ];
          const needle = ref.toLowerCase();
          const close = candidates.filter((candidate) => candidate.toLowerCase().includes(needle));
          return fail(
            `repository not found: ${ref}.${
              close.length > 0
                ? ` Did you mean: ${close.slice(0, 5).join(", ")}?`
                : ` Tracked repositories: ${config.repos.length}.`
            }`,
          );
        }
        const aliases = aliasesByPath(config);
        return ok({
          ref,
          root,
          repo: repoView(root, match.entry, aliases),
        });
      }),
  );

  server.registerTool(
    "repotruck_agents_md",
    {
      title: "Read AGENTS.md",
      description:
        "Return the raw AGENTS.md workspace map for a workspace: workspace metadata, every repository with its relative path, agent rules, and the preserved custom instructions block. Read this to understand the workspace before working in it.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({ root: rootParam }),
    },
    async ({ root: rootArg }) =>
      guarded(async () => {
        const root = await resolveRoot(rootArg);
        const content = await readAgentsMd(root);
        if (content === null) {
          return fail(
            `no AGENTS.md found at ${root} — is it a repotruck workspace? Create it with repotruck_sync or repotruck_clone first.`,
          );
        }
        return okText(content);
      }),
  );

  server.registerTool(
    "repotruck_sync",
    {
      title: "Sync workspace",
      description:
        "Clone or fast-forward-update repositories in bulk into the workspace layout, exactly like `repotruck sync`. Scope: user (your repositories), org:<name>, or all (your repositories plus every active organization). Creates the workspace (a record in the central repotruck.json + AGENTS.md) when missing. Requires GitHub authentication (GitHub CLI token or cached device-flow token). Emits notifications/progress updates when the client sends a progress token.",
      annotations: { idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({
        root: rootParam,
        preset: presetParam.describe("Preset applied when the workspace is created or overridden"),
        scope: z
          .enum(["user", "all", "org"])
          .optional()
          .describe(
            'Repositories to sync: "user" (default), "all", or "org" paired with the org parameter',
          ),
        org: z
          .string()
          .min(1)
          .optional()
          .describe('Organization name (required when scope is "org")'),
        limit: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Sync only the first N repositories of the resolved scope, in API order"),
        include: z
          .array(z.string().min(1))
          .optional()
          .describe("Only sync repositories whose owner/name matches one of these globs"),
        exclude: z
          .array(z.string().min(1))
          .optional()
          .describe("Skip repositories whose owner/name matches one of these globs"),
        depth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Create shallow clones with this commit depth (new clones only)"),
        blobless: z
          .boolean()
          .optional()
          .describe(
            "Create blobless partial clones (git clone --filter=blob:none; new clones only)",
          ),
        stash: z
          .boolean()
          .optional()
          .describe("Stash uncommitted changes before updating and restore them afterwards"),
        divergence: z
          .enum(["fail", "rebase", "reset", "skip"])
          .optional()
          .describe(
            "What to do with repositories that have local commits ahead of origin (default fail)",
          ),
        concurrency: z
          .number()
          .int()
          .positive()
          .max(32)
          .optional()
          .describe("How many repositories to sync in parallel (default 3)"),
      }),
    },
    async (
      {
        root: rootArg,
        preset,
        scope,
        org,
        limit,
        include,
        exclude,
        depth,
        blobless,
        stash,
        divergence,
        concurrency,
      },
      ctx,
    ) =>
      guarded(async () => {
        const scopeValue = scope ?? "user";
        if (scopeValue === "org" && (org === undefined || org.length === 0)) {
          return fail('scope "org" requires the org parameter');
        }
        const parsedScope = parseSyncScope(
          scopeValue === "org" && org !== undefined ? `org:${org}` : scopeValue,
        );
        if (parsedScope === null) {
          return fail(`invalid scope: ${scopeValue} (expected user, org, or all)`);
        }
        const presetOverride = preset === undefined ? undefined : requirePresetRef(preset);
        const root = await resolveRoot(rootArg);
        const { token, github } = await requireAuth();
        const userLogin = await github.getUserLogin();
        const orgs = await github.getActiveOrgs();
        let repos = await collectScopeRepos(github, parsedScope);
        if (include !== undefined || exclude !== undefined) {
          repos = filterReposByKey(repos, include ?? [], exclude ?? []);
        }
        if (limit !== undefined) repos = repos.slice(0, limit);
        if (repos.length === 0) {
          return ok({
            root,
            preset: presetOverride ?? "unchanged",
            scope: describeSyncScope(parsedScope),
            summary: "0 synced, 0 failed (no repositories matched)",
            synced: [],
            failed: [],
            progress: [],
          });
        }
        const config = await loadWorkspace(root, presetOverride, env);
        const progressLines: string[] = [];
        const sink = progressSinkFromContext(ctx);
        const hub = sink === null ? undefined : createProgressHub();
        if (hub !== undefined && sink !== null) bridgeHubToSink(hub, sink);
        const result = await syncRepos({
          root,
          config,
          repos,
          userLogin,
          orgs,
          token,
          env,
          concurrency,
          depth,
          blobless: blobless === true,
          stash: stash === true,
          divergence: divergence as DivergenceStrategy | undefined,
          customPresets,
          emit: (progress) => {
            progressLines.push(
              `[${progress.phase}] ${progress.key}${progress.message ? ` — ${progress.message}` : ""}`,
            );
          },
          ...(hub !== undefined ? { hub } : {}),
        });
        return {
          ...ok({
            root,
            preset: config.preset,
            scope: describeSyncScope(parsedScope),
            summary: `${result.done.length} synced, ${result.failed.length} failed`,
            synced: result.done.map((entry) => ({
              key: entry.key,
              relativePath: entry.relativePath,
              internal: entry.internal,
            })),
            failed: result.failed,
            progress: progressLines,
          }),
          ...(result.failed.length > 0 ? { isError: true } : {}),
        };
      }),
  );

  server.registerTool(
    "repotruck_clone",
    {
      title: "Clone repository",
      description:
        "Clone a single GitHub repository (URL or owner/name) into the workspace layout, or fast-forward-pull it when the destination already exists. Registers the repository in the central repotruck.json and in AGENTS.md. Requires GitHub authentication. Emits notifications/progress updates when the client sends a progress token.",
      annotations: { idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({
        url: z.string().min(1).describe("GitHub repository URL or owner/name"),
        root: rootParam,
        preset: presetParam,
      }),
    },
    async ({ url, root: rootArg, preset }, ctx) =>
      guarded(async () => {
        if (parseGitUrl(url) === null) {
          return fail(
            `invalid GitHub repository URL: ${url} (expected https://github.com/owner/repo, git@github.com:owner/repo, or owner/name)`,
          );
        }
        const presetOverride = preset === undefined ? undefined : requirePresetRef(preset);
        const root = await resolveRoot(rootArg);
        const { token, github } = await requireAuth();
        const userLogin = await github.getUserLogin();
        const orgs = await github.getActiveOrgs();
        const progressLines: string[] = [];
        const sink = progressSinkFromContext(ctx);
        let cloneStep = 0;
        const result = await cloneSingleRepository(url, {
          root,
          github,
          userLogin,
          orgs,
          token,
          presetOverride,
          customPresets,
          emit: (progress) => {
            progressLines.push(
              `[${progress.phase}] ${progress.key}${progress.message ? ` — ${progress.message}` : ""}`,
            );
            cloneStep += 1;
            sink?.(
              cloneStep,
              undefined,
              `${progress.key} — ${progress.phase}${progress.message ? `: ${progress.message}` : ""}`,
            );
          },
        });
        return ok({
          key: `${result.repo.owner}/${result.repo.name}`,
          relativePath: toPosixRelative(root, result.destDir),
          absolutePath: result.destDir,
          internal: result.internal,
          preset: result.preset,
          action: result.progress.message ?? "done",
          description: result.repo.description,
          language: result.repo.language,
          progress: progressLines,
        });
      }),
  );

  server.registerTool(
    "repotruck_create",
    {
      title: "Create repository",
      description:
        "Create a new GitHub repository and register it in the workspace, exactly like `repotruck create`. Optionally import an existing local directory (--from semantics: a Git repository must have a clean tree) and place it at a custom workspace-relative path. Requires GitHub authentication.",
      annotations: { openWorldHint: true },
      inputSchema: z.object({
        name: z.string().min(1).describe("New repository name"),
        root: rootParam,
        org: z.string().min(1).optional().describe("Create inside this organization"),
        isPrivate: z.boolean().optional().describe("Create as private (default true)"),
        description: z.string().optional().describe("Short repository description"),
        at: z
          .string()
          .min(1)
          .optional()
          .describe("Custom workspace-relative path for the repository"),
        from: z
          .string()
          .min(1)
          .optional()
          .describe("Import an existing local directory (absolute path)"),
      }),
    },
    async ({ name, root: rootArg, org, isPrivate, description, at, from }) =>
      guarded(async () => {
        const root = await resolveRoot(rootArg);
        const { token, github } = await requireAuth();
        const userLogin = await github.getUserLogin();
        const orgs = await github.getActiveOrgs();
        const config = await loadWorkspace(root);
        const messages: string[] = [];
        const result = await createRepository({
          root,
          config,
          github,
          token,
          userLogin,
          orgs,
          customPresets,
          options: {
            name,
            org,
            isPrivate: isPrivate ?? true,
            description,
            customPath: at,
            fromDir: from,
          },
          emit: (message) => messages.push(message),
        });
        return {
          ...ok({
            ok: result.ok,
            message: result.message,
            ...(result.relativePath !== undefined ? { relativePath: result.relativePath } : {}),
            ...(result.destDir !== undefined ? { absolutePath: result.destDir } : {}),
            progress: messages,
          }),
          ...(result.ok ? {} : { isError: true }),
        };
      }),
  );

  server.registerTool(
    "repotruck_move",
    {
      title: "Move repository",
      description:
        "Move a tracked repository to a custom workspace-relative path and mark it as manually placed (custom), exactly like `repotruck move`. Rewrites the central repotruck.json, AGENTS.md and alias targets. Refuses to overwrite an occupied destination.",
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        repo: z.string().min(1).describe('Repository key as "owner/name"'),
        destination: z.string().min(1).describe("New workspace-relative destination path"),
        root: rootParam,
      }),
    },
    async ({ repo, destination, root: rootArg }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root);
        const result = await moveRepository(root, config, repo, destination);
        return {
          ...ok({ ok: result.ok, message: result.message, root }),
          ...(result.ok ? {} : { isError: true }),
        };
      }),
  );

  server.registerTool(
    "repotruck_reorganize",
    {
      title: "Reorganize workspace",
      description:
        "Move every tracked repository to its path for a new preset, exactly like `repotruck reorganize`. Use dryRun first to preview the plan. scan also adopts untracked Git repositories found on disk; keepCustom leaves manually placed repositories where they are.",
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        preset: presetRequired,
        root: rootParam,
        scan: z
          .boolean()
          .optional()
          .describe("Also discover untracked Git repositories on disk and adopt them"),
        dryRun: z.boolean().optional().describe("Show the move plan without touching anything"),
        keepCustom: z
          .boolean()
          .optional()
          .describe("Keep manually placed (custom) repositories where they are"),
      }),
    },
    async ({ preset, root: rootArg, scan, dryRun, keepCustom }) =>
      guarded(async () => {
        const target = requirePresetRef(preset);
        const root = await requireWorkspaceRoot(rootArg);
        const result = await reorganizeWorkspace(root, target, {
          scan: scan === true,
          dryRun: dryRun === true,
          keepCustom: keepCustom === true,
          env,
          customPresets,
        });
        const hasProblems = result.failed.length > 0 || result.collisions.length > 0;
        return {
          ...ok({
            root,
            preset: target,
            dryRun: dryRun === true,
            moved: result.moved,
            skipped: result.skipped,
            collisions: result.collisions,
            failed: result.failed,
            summary: `${result.moved.length} moved, ${result.skipped.length} skipped, ${result.collisions.length} collisions, ${result.failed.length} failed`,
          }),
          ...(hasProblems ? { isError: true } : {}),
        };
      }),
  );

  server.registerTool(
    "repotruck_forget",
    {
      title: "Forget repository",
      description:
        "Stop tracking a repository without touching its files on disk: removes the entry (and its aliases) from the central repotruck.json and the AGENTS.md map, exactly like `repotruck forget`. The cloned directory stays where it is; re-tracking it later is a reorganize scan away.",
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        repo: z
          .string()
          .min(1)
          .describe("Repository alias, workspace-relative path, or owner/name"),
        root: rootParam,
      }),
    },
    async ({ repo, root: rootArg }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const result = await forgetRepository(root, config, repo, env);
        return {
          ...ok({ ok: result.ok, message: result.message, root }),
          ...(result.ok ? {} : { isError: true }),
        };
      }),
  );

  server.registerTool(
    "repotruck_prune",
    {
      title: "Prune deleted repositories",
      description:
        "Untrack repositories that were deleted from GitHub (or became inaccessible): checks every tracked repository against the GitHub API and removes the missing ones from the central repotruck.json and AGENTS.md, exactly like `repotruck prune`. Use dryRun first to preview. Files on disk are never touched. Requires GitHub authentication.",
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({
        root: rootParam,
        dryRun: z
          .boolean()
          .optional()
          .describe("Report what would be pruned without untracking anything"),
      }),
    },
    async ({ root: rootArg, dryRun }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const { github } = await requireAuth();
        const result = await pruneWorkspace(root, config, github, { dryRun: dryRun === true }, env);
        return {
          ...ok({
            ok: result.ok,
            message: result.message,
            root,
            ...(result.lines !== undefined ? { lines: result.lines } : {}),
          }),
          ...(result.ok ? {} : { isError: true }),
        };
      }),
  );

  server.registerTool(
    "repotruck_status",
    {
      title: "Repository git status",
      description:
        "Per-repository Git health for a workspace, exactly like `repotruck status`: for every tracked repository reports missing-on-disk, dirty or clean tree, ahead/behind counts against upstream, category, custom flag and aliases. Read-only.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({ root: rootParam }),
    },
    async ({ root: rootArg }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const result = await workspaceStatus(root, config);
        return ok({ root, lastSync: result.lastSync, repos: result.repos });
      }),
  );

  server.registerTool(
    "repotruck_archive",
    {
      title: "Archive repository",
      description:
        "Archive a repository on GitHub and move its local directory into the archived category of the workspace layout, exactly like `repotruck archive`: the GitHub repository is archived, the inventory category becomes archived, the directory moves and alias targets are rewritten. Requires GitHub authentication.",
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({
        repo: z
          .string()
          .min(1)
          .describe("Repository alias, workspace-relative path, or owner/name"),
        root: rootParam,
      }),
    },
    async ({ repo, root: rootArg }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const { github } = await requireAuth();
        const result = await archiveRepository(root, config, repo, github, {}, env);
        return {
          ...ok({ ok: result.ok, message: result.message, root }),
          ...(result.ok ? {} : { isError: true }),
        };
      }),
  );

  server.registerTool(
    "repotruck_open",
    {
      title: "Open repository in an app",
      description:
        "Launch an application (vscode, cursor, claude, codex, gemini, aider, a custom apps.json entry, or any PATH executable) with its working directory set to a tracked repository, exactly like `repotruck open`. The app is started detached from the MCP server; the tool returns as soon as the process is launched. Resolve the repository first with repotruck_resolve_repo if you only know part of its name.",
      annotations: { idempotentHint: true },
      inputSchema: z.object({
        repo: z
          .string()
          .min(1)
          .describe("Repository alias, workspace-relative path, or owner/name"),
        app: z
          .string()
          .min(1)
          .describe("App name (builtin, custom apps.json entry, or bare PATH executable)"),
        root: rootParam,
      }),
    },
    async ({ repo, app, root: rootArg }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const resolved = await resolveApp(app, { env });
        if (resolved === null) {
          const detected = await detectApps({ env });
          return fail(
            `unknown app: ${app}. Available apps: ${
              detected.map((item) => item.name).join(", ") || "none detected"
            }`,
          );
        }
        const result = await runAppInRepo(
          { root, config, ref: repo, app: resolved, mode: "foreground" },
          { spawnImpl: detachedSpawnImpl },
        );
        return {
          ...ok({
            ok: result.ok,
            app: resolved.name,
            root,
            message:
              result.message ??
              (result.ok
                ? `launched ${resolved.name} in ${result.dir ?? repo}`
                : `launch failed in ${result.dir ?? repo}`),
          }),
          ...(result.ok ? {} : { isError: true }),
        };
      }),
  );

  server.registerTool(
    "repotruck_alias_set",
    {
      title: "Set alias",
      description:
        "Set a short alias (letters, digits, dots, dashes, underscores) for a tracked repository, usable as a reference in other tools. Exactly like `repotruck alias set`.",
      annotations: { idempotentHint: true },
      inputSchema: z.object({
        alias: z.string().min(1).describe("Alias name"),
        repo: z
          .string()
          .min(1)
          .describe("Repository alias, workspace-relative path, or owner/name"),
        root: rootParam,
      }),
    },
    async ({ alias, repo, root: rootArg }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const result = setAlias(config, alias, repo);
        if (!result.ok) return fail(result.message);
        await saveWorkspace(root, result.config, env);
        return ok({ ok: true, message: result.message, root });
      }),
  );

  server.registerTool(
    "repotruck_alias_remove",
    {
      title: "Remove alias",
      description:
        "Remove a repository alias, exactly like `repotruck alias remove`. List current aliases with repotruck_workspace_status.",
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        alias: z.string().min(1).describe("Alias name to remove"),
        root: rootParam,
      }),
    },
    async ({ alias, root: rootArg }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const result = removeAlias(config, alias);
        if (!result.ok) return fail(result.message);
        await saveWorkspace(root, result.config, env);
        return ok({ ok: true, message: result.message, root });
      }),
  );

  server.registerTool(
    "repotruck_search_github",
    {
      title: "Search GitHub",
      description:
        "Search public repositories on GitHub by keyword (GitHub search syntax). Use this to find repositories to clone with repotruck_clone. Requires GitHub authentication.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe('GitHub search query (e.g. "language:typescript mcp server")'),
        limit: z.number().int().positive().max(50).optional().describe("Max results (default 10)"),
      }),
    },
    async ({ query, limit }) =>
      guarded(async () => {
        const { github } = await requireAuth();
        const results = await github.searchRepos(query, limit ?? 10);
        return ok({
          query,
          count: results.length,
          repos: results.map((repo) => ({
            key: `${repo.owner}/${repo.name}`,
            description: repo.description,
            language: repo.language,
            stars: repo.stars,
            isFork: repo.isFork,
            isArchived: repo.isArchived,
            updatedAt: repo.updatedAt,
            httpsUrl: repo.httpsUrl,
          })),
        });
      }),
  );

  server.registerTool(
    "repotruck_search_code",
    {
      title: "Search code symbols",
      description:
        "Search an indexed symbol name (substring, case-insensitive) across every tracked repository in a workspace, exactly like `repotruck search-code`: a tree-sitter symbol index over ts/tsx/js/python/go/rust sources returning repo:path:line hits with symbol kind and export status. The first search builds the index (~3 MB per second); later searches reuse it unless rebuild is set. Read-only.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({
        pattern: z.string().min(1).describe("Symbol name substring to match (case-insensitive)"),
        root: rootParam,
        kind: z
          .enum(["function", "class", "interface", "type", "enum", "method", "const"])
          .optional()
          .describe("Only this symbol kind"),
        lang: z
          .enum(["ts", "tsx", "js", "py", "go", "rs"])
          .optional()
          .describe("Only this source language (py = python, rs = rust)"),
        limit: z.number().int().positive().optional().describe("Max matches (default: all)"),
        rebuild: z.boolean().optional().describe("Force a full index rebuild before searching"),
      }),
    },
    async ({ pattern, root: rootArg, kind, lang, limit, rebuild }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const result = await searchCode({
          root,
          config,
          pattern,
          kind,
          lang,
          limit,
          rebuild: rebuild === true,
        });
        return ok({
          root,
          pattern,
          count: result.matches.length,
          matches: result.matches,
          index: result.index,
        });
      }),
  );

  server.registerTool(
    "repotruck_run",
    {
      title: "Run command in repositories",
      description:
        "Run a shell command in every selected tracked repository of a workspace (in parallel), exactly like `repotruck run`. With no repos selection the command runs in every tracked repository on disk. Per-repository results report exit code, duration and truncated output; a non-zero exit marks the result failed and the whole call isError.",
      annotations: { openWorldHint: true },
      inputSchema: z.object({
        command: z.string().min(1).describe("Executable to run (e.g. npm, git, bun)"),
        args: z.array(z.string()).optional().describe("Arguments for the command (default none)"),
        root: rootParam,
        repos: z
          .array(z.string().min(1))
          .optional()
          .describe("Repository refs (owner/name, alias, or path) to target; default all tracked"),
        concurrency: z
          .number()
          .int()
          .positive()
          .max(32)
          .optional()
          .describe("Parallel processes (default 3)"),
      }),
    },
    async ({ command, args, root: rootArg, repos, concurrency }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const result = await runInRepos({
          root,
          config,
          refs: repos ?? [],
          command,
          args: args ?? [],
          concurrency,
        });
        return {
          ...ok({
            root,
            command,
            results: result.results.map((r) => ({
              key: r.key,
              relativePath: r.relativePath,
              ok: r.ok,
              exitCode: r.exitCode,
              durationMs: r.durationMs,
              stdout: r.stdout.slice(0, 2000),
              stderr: r.stderr.slice(0, 2000),
            })),
            skipped: result.skipped,
          }),
          ...(result.results.some((r) => !r.ok) ? { isError: true } : {}),
        };
      }),
  );

  server.registerTool(
    "repotruck_stats",
    {
      title: "Workspace statistics",
      description:
        "Workspace metrics, exactly like `repotruck stats`: language distribution, category counts (source/forks/archived/custom), stale repositories (>=180 days inactive) and disk footprint of the repositories on disk. Read-only.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({ root: rootParam }),
    },
    async ({ root: rootArg }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const disk = walkRepositoriesOnDisk(root);
        const stats = calculateWorkspaceStats(config, disk);
        const { formatted: _formatted, ...data } = stats;
        void _formatted;
        return ok({ root, ...data });
      }),
  );

  server.registerTool(
    "repotruck_delete",
    {
      title: "Delete repository",
      description:
        'Stop tracking a repository AND permanently remove its directory from disk, exactly like `repotruck delete --yes`. This is irreversible; confirm must be the literal string "yes". Use repotruck_forget to keep the files on disk.',
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        repo: z
          .string()
          .min(1)
          .describe("Repository alias, workspace-relative path, or owner/name"),
        confirm: z.literal("yes").describe('Must be the literal "yes" to actually delete'),
        root: rootParam,
      }),
    },
    async ({ repo, confirm, root: rootArg }) =>
      guarded(async () => {
        if (confirm !== "yes") {
          return fail('delete requires confirm: "yes"');
        }
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const result = await deleteRepository(root, config, repo, { yes: true }, env);
        return {
          ...ok({ ok: result.ok, message: result.message, root }),
          ...(result.ok ? {} : { isError: true }),
        };
      }),
  );

  server.registerTool(
    "repotruck_doctor",
    {
      title: "Run health checks",
      description:
        "Run the repotruck doctor diagnostics, exactly like `repotruck doctor`: checks git, the GitHub CLI, token authentication, the central registry, and workspace roots on disk. Read-only.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({}),
    },
    async () =>
      guarded(async () => {
        const result = await runDoctor({ env });
        return {
          ...ok({
            ok: result.ok,
            checks: result.checks.map(({ formatted, ...check }) => {
              void formatted;
              return check;
            }),
          }),
          ...(result.ok ? {} : { isError: true }),
        };
      }),
  );

  server.registerTool(
    "repotruck_workspaces_remove",
    {
      title: "Remove workspace record",
      description:
        "Remove a workspace from the central repotruck.json registry, exactly like `repotruck workspaces remove <path>`. Only the record is removed; files on disk (including AGENTS.md and repositories) are untouched.",
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path of the workspace to remove"),
      }),
    },
    async ({ path: wsPath }) =>
      guarded(async () => {
        const removed = await removeWorkspace(wsPath, env);
        if (removed === null) {
          return fail(`workspace not found: ${wsPath}`);
        }
        return ok({ ok: true, removed: removed.root, repoCount: removed.repos.length });
      }),
  );

  server.registerResource(
    "agents-md",
    "repotruck://agents-md",
    {
      title: "Workspace AGENTS.md map",
      description:
        "The AGENTS.md workspace map of the resolved default workspace (nearest registered workspace walking up from the server's working directory, otherwise the configured default root): workspace metadata, every repository with its relative path, agent rules, and the custom instructions block.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const root = await resolveRoot();
      const content = await readAgentsMd(root);
      if (content === null) {
        throw new Error(
          `no AGENTS.md found at ${root} — is it a repotruck workspace? Create it with repotruck_sync or repotruck_clone first.`,
        );
      }
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }],
      };
    },
  );

  server.registerResource(
    "inventory",
    "repotruck://inventory",
    {
      title: "Workspace inventory",
      description:
        "The repotruck.json inventory of the resolved default workspace as JSON: preset, lastSync, every repository entry (owner, name, relativePath, category, internal, language, updatedAt, custom) and the alias map.",
      mimeType: "application/json",
    },
    async (uri) => {
      const root = await resolveRoot();
      const registered =
        (await isRegisteredWorkspace(root, env)) || existsSync(path.join(root, CONFIG_FILENAME));
      if (!registered) {
        throw new Error(
          `not a repotruck workspace (no record for it in the central repotruck.json): ${root}`,
        );
      }
      const config = await loadWorkspace(root, undefined, env);
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(config, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    "tree",
    "repotruck://tree",
    {
      title: "Workspace directory tree",
      description:
        "A depth-limited directory tree (3 levels) of the resolved default workspace root as plain text. Skips .git and node_modules directories and caps entries per directory.",
      mimeType: "text/plain",
    },
    async (uri) => {
      const root = await resolveRoot();
      const text = await workspaceTreeText(root);
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
    },
  );

  // Per-workspace resource templates: agents-md/inventory/tree for any
  // registered workspace, addressed by URL-encoded absolute root.
  server.registerResource(
    "agents-md-by-root",
    new ResourceTemplate("repotruck://agents-md/{root}", { list: undefined }),
    {
      title: "Workspace AGENTS.md map by root",
      description:
        "The AGENTS.md workspace map of a specific workspace, addressed by its URL-encoded absolute root path — use this instead of repotruck://agents-md when multiple workspaces are registered.",
      mimeType: "text/markdown",
    },
    async (uri, extra) => {
      const root = path.resolve(
        decodeURIComponent(String((extra.params as unknown as Record<string, unknown>).root ?? "")),
      );
      const content = await readAgentsMd(root);
      if (content === null) {
        throw new Error(`no AGENTS.md found at ${root} — is it a repotruck workspace?`);
      }
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }] };
    },
  );

  server.registerResource(
    "inventory-by-root",
    new ResourceTemplate("repotruck://inventory/{root}", { list: undefined }),
    {
      title: "Workspace inventory by root",
      description:
        "The repotruck.json inventory of a specific workspace (URL-encoded absolute root) as JSON: preset, lastSync, repositories and aliases.",
      mimeType: "application/json",
    },
    async (uri, extra) => {
      const root = path.resolve(
        decodeURIComponent(String((extra.params as unknown as Record<string, unknown>).root ?? "")),
      );
      const registered =
        (await isRegisteredWorkspace(root, env)) || existsSync(path.join(root, CONFIG_FILENAME));
      if (!registered) {
        throw new Error(`not a repotruck workspace: ${root}`);
      }
      const config = await loadWorkspace(root, undefined, env);
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(config, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    "tree-by-root",
    new ResourceTemplate("repotruck://tree/{root}", { list: undefined }),
    {
      title: "Workspace directory tree by root",
      description:
        "A depth-limited directory tree (3 levels) of a specific workspace root (URL-encoded absolute path) as plain text. Skips .git and node_modules.",
      mimeType: "text/plain",
    },
    async (uri, extra) => {
      const root = path.resolve(
        decodeURIComponent(String((extra.params as unknown as Record<string, unknown>).root ?? "")),
      );
      const text = await workspaceTreeText(root);
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text }] };
    },
  );

  server.registerPrompt(
    "sync-and-summarize",
    {
      title: "Sync workspace and summarize new repositories",
      description:
        "Instructions for running a repotruck sync over the workspace and then summarizing what arrived: new repositories, their languages and paths, and any failures.",
      argsSchema: z.object({
        root: rootParam,
        scope: z
          .enum(["user", "all", "org"])
          .optional()
          .describe(
            'Repositories to sync: "user" (default), "all", or "org" paired with the org argument',
          ),
        org: z
          .string()
          .min(1)
          .optional()
          .describe('Organization name (required when scope is "org")'),
        limit: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Sync only the first N repositories of the resolved scope"),
      }),
    },
    ({ root, scope, org, limit }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Synchronize the repotruck workspace${
                root !== undefined && root.length > 0 ? ` at ${root}` : " (default root resolution)"
              } and summarize the result:`,
              `1. Call the repotruck_sync tool with scope "${scope ?? "user"}"${
                org !== undefined ? ` and org "${org}"` : ""
              }${limit !== undefined ? ` and limit ${limit}` : ""}${
                root !== undefined && root.length > 0 ? ` and root "${root}"` : ""
              }.`,
              "2. When it finishes, call repotruck_list_repos for the same workspace.",
              "3. Summarize: how many repositories were newly cloned vs updated vs failed, then a short table of new repositories (key, language, workspace-relative path).",
              "4. If any repository failed to sync, include the failure messages verbatim.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "suggest-agent-rules",
    {
      title: "Suggest agent rules for this workspace",
      description:
        "Instructions for reading the workspace map and inventory and then proposing grounded AGENTS.md agent rules: per-category guidance, language conventions, alias usage, and safe defaults.",
      argsSchema: z.object({ root: rootParam }),
    },
    ({ root }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Propose agent rules for the repotruck workspace${
                root !== undefined && root.length > 0 ? ` at ${root}` : " (default root resolution)"
              }:`,
              "1. Read the AGENTS.md map (the repotruck://agents-md resource or the repotruck_agents_md tool) and the repository inventory (repotruck_list_repos).",
              "2. Draft 5-10 concise agent rules grounded in what you found: per-category guidance (source vs forks vs archived), language-specific conventions where one language dominates, how to use aliases, and which directories are safe to modify.",
              "3. Present the rules as a markdown list ready to paste into the agent rules section of AGENTS.md. Do not invent repositories that are not in the inventory.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}

export async function runRepotruckMcpServer(options: McpServerOptions = {}): Promise<void> {
  const server = await createRepotruckMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export interface McpHttpServerOptions extends McpServerOptions {
  host?: string;
  port?: number;
  token?: string;
}

export const MCP_HTTP_DEFAULT_HOST = "127.0.0.1";
export const MCP_HTTP_DEFAULT_PORT = 3000;

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalHostname(host: string): boolean {
  return LOCAL_HOSTNAMES.has(host.trim().toLowerCase());
}

export function validateHttpBindOptions(
  host: string | undefined,
  token: string | undefined,
): string | null {
  const effectiveHost = (host ?? MCP_HTTP_DEFAULT_HOST).trim();
  if (effectiveHost.length === 0) {
    return "--host cannot be empty";
  }
  if (token === undefined && !isLocalHostname(effectiveHost)) {
    return `--host ${effectiveHost} is not a localhost address — binding beyond localhost requires --token <value>`;
  }
  return null;
}

export interface RepotruckHttpMcpHandler {
  fetch: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
}

// Version drift note: @modelcontextprotocol/node is deliberately pinned (2.1.1)
// while @modelcontextprotocol/server is on the 2.3.x line — the two packages
// version independently and the node package's peer range (^2.3.0) accepts the
// server version in use; both sides interoperate over the fetch-shaped handler.
/** Constant-time comparison so the bearer token is not leaked through timing. */
function tokensEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Compare lengths only after a constant-time run to avoid a length oracle.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function createRepotruckHttpHandler(
  options: McpHttpServerOptions = {},
): RepotruckHttpMcpHandler {
  const token = options.token;
  const handler = createMcpHandler(() => createRepotruckMcpServer(options), {
    onerror: (error) => {
      process.stderr.write(`mcp http: ${firstErrorLine(error)}\n`);
    },
  });
  const guardedFetch = async (
    request: Request,
    fetchOptions?: Parameters<typeof handler.fetch>[1],
  ): Promise<Response> => {
    if (token !== undefined) {
      const authorization = request.headers.get("authorization") ?? "";
      if (!tokensEqual(authorization, `Bearer ${token}`)) {
        return new Response("unauthorized: missing or invalid bearer token\n", {
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer realm="repotruck"' },
        });
      }
    } else {
      const hostRejected = hostHeaderValidationResponse(request, localhostAllowedHostnames());
      if (hostRejected !== undefined) return hostRejected;
      const originRejected = originValidationResponse(request, localhostAllowedOrigins());
      if (originRejected !== undefined) return originRejected;
    }
    return handler.fetch(request, fetchOptions);
  };
  return { fetch: guardedFetch, close: () => handler.close() };
}

export async function runRepotruckMcpHttpServer(options: McpHttpServerOptions = {}): Promise<void> {
  const host = options.host ?? MCP_HTTP_DEFAULT_HOST;
  const port = options.port ?? MCP_HTTP_DEFAULT_PORT;
  const bindProblem = validateHttpBindOptions(host, options.token);
  if (bindProblem !== null) {
    throw new Error(bindProblem);
  }
  const handler = createRepotruckHttpHandler(options);
  const nodeHandler = toNodeHandler({ fetch: handler.fetch });
  const httpServer = createServer((req, res) => {
    void nodeHandler(req, res).catch((error: unknown) => {
      process.stderr.write(`mcp http: ${firstErrorLine(error)}\n`);
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onListenError = (error: NodeJS.ErrnoException): void => reject(error);
    httpServer.once("error", onListenError);
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", onListenError);
      httpServer.on("error", (error) => {
        process.stderr.write(`mcp http: ${firstErrorLine(error)}\n`);
      });
      resolve();
    });
  });
  process.stdout.write(`repotruck MCP server (HTTP) listening on http://${host}:${port}\n`);
  let closed = false;
  const shutdown = (): void => {
    if (closed) return;
    closed = true;
    void handler.close().finally(() => {
      httpServer.close(() => {
        process.exit(0);
      });
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

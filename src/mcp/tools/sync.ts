import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { collectScopeRepos, describeSyncScope, parseSyncScope } from "../../cliSupport.ts";
import type { DivergenceStrategy } from "../../services/cloner.ts";
import { createRepository } from "../../services/creator.ts";
import { filterReposByKey } from "../../services/filters.ts";
import { createProgressHub } from "../../services/progressHub.ts";
import { cloneSingleRepository, parseGitUrl } from "../../services/singleCloner.ts";
import { loadWorkspace, syncRepos, toPosixRelative } from "../../services/workspace.ts";
import type { ToolContext } from "../toolContext.ts";
import {
  bridgeHubToSink,
  fail,
  guarded,
  ok,
  presetParam,
  progressSinkFromContext,
  rootParam,
} from "../toolHelpers.ts";

export function registerSyncTools(server: McpServer, ctx: ToolContext): void {
  const { env, customPresets, requirePresetRef, resolveRoot, requireAuth } = ctx;
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
}

import { existsSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { CONFIG_FILENAME, readAgentsMd } from "../../services/config.ts";
import { runDoctor } from "../../services/doctor.ts";
import { listAliases } from "../../services/launcher.ts";
import { calculateWorkspaceStats, walkRepositoriesOnDisk } from "../../services/stats.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import {
  isRegisteredWorkspace,
  listWorkspaces,
  removeWorkspace,
} from "../../services/workspaceRegistry.ts";
import type { ToolContext } from "../toolContext.ts";
import { fail, guarded, ok, okText, rootParam, workspaceTreeText } from "../toolHelpers.ts";

export function registerWorkspaceTools(server: McpServer, ctx: ToolContext): void {
  const { env, resolveRoot, requireWorkspaceRoot } = ctx;
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
}

export function registerWorkspaceResources(server: McpServer, ctx: ToolContext): void {
  const { env, resolveRoot } = ctx;
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
}

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { getWorkspaceStatus } from "../../core/inspect.ts";
import { listAliases, resolveRepoRef } from "../../services/launcher.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import type { ToolContext } from "../toolContext.ts";
import { aliasesByPath, fail, guarded, ok, repoView, rootParam } from "../toolHelpers.ts";

export function registerReposTools(server: McpServer, ctx: ToolContext): void {
  const { env, requireWorkspaceRoot } = ctx;
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
        const result = await getWorkspaceStatus(root, env);
        return ok({ root, lastSync: result.lastSync, repos: result.repos });
      }),
  );
}

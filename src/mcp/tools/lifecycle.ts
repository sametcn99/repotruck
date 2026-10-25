import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { archiveRepo, deleteRepo, forgetRepo, moveRepo, pruneRepos } from "../../core/repos.ts";
import { reorganizeWorkspace } from "../../services/reorganizer.ts";
import type { ToolContext } from "../toolContext.ts";
import { fail, guarded, ok, presetRequired, rootParam } from "../toolHelpers.ts";

export function registerLifecycleTools(server: McpServer, ctx: ToolContext): void {
  const { env, customPresets, requirePresetRef, requireWorkspaceRoot, requireAuth } = ctx;
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
        const result = await moveRepo(root, repo, destination);
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
        const result = await forgetRepo(root, repo, env);
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
        const { github } = await requireAuth();
        const result = await pruneRepos(root, github, { dryRun: dryRun === true }, env);
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
        const { github } = await requireAuth();
        const result = await archiveRepo(root, repo, github, env);
        return {
          ...ok({ ok: result.ok, message: result.message, root }),
          ...(result.ok ? {} : { isError: true }),
        };
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
        const result = await deleteRepo(root, repo, { yes: true }, env);
        return {
          ...ok({ ok: result.ok, message: result.message, root }),
          ...(result.ok ? {} : { isError: true }),
        };
      }),
  );
}

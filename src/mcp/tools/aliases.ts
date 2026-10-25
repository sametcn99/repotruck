import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { removeWorkspaceAlias, setWorkspaceAlias } from "../../core/aliases.ts";
import { detectApps, resolveApp, runAppInRepo } from "../../services/launcher.ts";
import { runInRepos } from "../../services/runner.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import type { ToolContext } from "../toolContext.ts";
import { detachedSpawnImpl, fail, guarded, ok, rootParam } from "../toolHelpers.ts";

export function registerAliasesTools(server: McpServer, ctx: ToolContext): void {
  const { env, requireWorkspaceRoot } = ctx;
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
        const res = await setWorkspaceAlias(root, alias, repo, env);
        if (!res.ok) {
          throw new Error(res.message);
        }
        return ok({ ok: true, message: res.message, root });
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
        const res = await removeWorkspaceAlias(root, alias, env);
        if (!res.ok) {
          throw new Error(res.message);
        }
        return ok({ ok: true, message: res.message, root });
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
}

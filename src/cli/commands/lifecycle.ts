import type { Command } from "commander";
import { archiveRepo, deleteRepo, forgetRepo, moveRepo, pruneRepos } from "../../core/repos.ts";
import { resolveGithubBaseUrl } from "../../services/settings.ts";
import { type CliContext, exitFail, requireExistingRoot, runAction } from "../shared.ts";

export function register(program: Command, ctx: CliContext): void {
  program
    .command("move")
    .description("Move a tracked repository to a custom path and mark it as manually placed.")
    .argument("<owner/name>", 'repository key as "owner/name"')
    .argument("<relative-path>", "new workspace-relative destination path")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .action(async (key: string, destRelative: string, options: { dir?: string }) => {
      await runAction(async () => {
        const root = await requireExistingRoot(options.dir);
        const result = await moveRepo(root, key, destRelative, {
          emit: (message) => process.stdout.write(`${message}\n`),
        });
        if (!result.ok) exitFail(result.message);
        process.stdout.write(`\u2713 ${result.message}\n`);
      });
    });

  program
    .command("forget")
    .description("Stop tracking a repository; the clone stays on disk untouched.")
    .argument(
      "<repo>",
      'repository to forget: "owner/name", an alias, or a workspace-relative path',
    )
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .action(async (ref: string, options: { dir?: string }) => {
      await runAction(async () => {
        const root = await requireExistingRoot(options.dir);
        const result = await forgetRepo(root, ref);
        if (!result.ok) exitFail(result.message);
        process.stdout.write(`\u2713 ${result.message}\n`);
      });
    });

  program
    .command("prune")
    .description(
      "Untrack repositories that were deleted on GitHub (or became inaccessible). Repositories with unclear answers are kept and reported.",
    )
    .option("--dry-run", "only list what would be pruned; change nothing")
    .option("--base-url <url>", "GitHub Enterprise base URL (e.g. https://ghe.example.com)")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .option("--json", "Output results as JSON")
    .action(
      async (options: { dryRun?: boolean; dir?: string; baseUrl?: string; json?: boolean }) => {
        await runAction(
          async () => {
            const root = await requireExistingRoot(options.dir);
            const auth = await ctx.requireAuth();
            const baseUrl = await resolveGithubBaseUrl(process.env, options.baseUrl);
            const github = ctx.buildGithub(auth.token, baseUrl);
            const result = await pruneRepos(root, github, {
              dryRun: options.dryRun === true,
            });
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({
                  command: "prune",
                  ok: result.ok,
                  message: result.message,
                  lines: result.lines ?? [],
                })}\n`,
              );
              if (!result.ok) {
                process.exitCode = 1;
                return;
              }
              return;
            }
            for (const line of result.lines ?? []) {
              process.stdout.write(`${line}\n`);
            }
            if (!result.ok) exitFail(result.message);
            process.stdout.write(`\u2713 ${result.message}\n`);
          },
          { command: "prune", json: options.json },
        );
      },
    );

  program
    .command("delete")
    .description("Stop tracking a repository and permanently remove its directory from disk.")
    .argument(
      "<repo>",
      'repository to delete: "owner/name", an alias, or a workspace-relative path',
    )
    .option("--yes", "confirm the deletion (required; this permanently removes the directory)")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .action(async (ref: string, options: { yes?: boolean; dir?: string }) => {
      await runAction(async () => {
        const root = await requireExistingRoot(options.dir);
        const result = await deleteRepo(root, ref, {
          yes: options.yes === true,
        });
        if (!result.ok) exitFail(result.message);
        process.stdout.write(`\u2713 ${result.message}\n`);
      });
    });

  program
    .command("archive")
    .description("Archive the repository on GitHub and re-file it under the archived category.")
    .argument(
      "<repo>",
      'repository to archive: "owner/name", an alias, or a workspace-relative path',
    )
    .option("--base-url <url>", "GitHub Enterprise base URL (e.g. https://ghe.example.com)")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .action(async (ref: string, options: { dir?: string; baseUrl?: string }) => {
      await runAction(async () => {
        const root = await requireExistingRoot(options.dir);
        const auth = await ctx.requireAuth();
        const baseUrl = await resolveGithubBaseUrl(process.env, options.baseUrl);
        const github = ctx.buildGithub(auth.token, baseUrl);
        const result = await archiveRepo(root, ref, github);
        if (!result.ok) exitFail(result.message);
        process.stdout.write(`\u2713 ${result.message}\n`);
      });
    });
}

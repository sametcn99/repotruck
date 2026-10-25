import type { Command } from "commander";
import { getWorkspaceStatus } from "../../core/inspect.ts";
import { type CliContext, requireExistingRoot, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("status")
    .description("Show per-repository health: dirty state, ahead/behind, category, aliases.")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .option("--json", "Output results as JSON")
    .action(async (options: { dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await requireExistingRoot(options.dir);
          const status = await getWorkspaceStatus(root);
          if (options.json) {
            const payload = {
              command: "status",
              ok: true,
              root,
              lastSync: status.lastSync,
              repos: status.repos.map((r) => ({ key: r.key, line: r.line })),
            };
            process.stdout.write(`${JSON.stringify(payload)}\n`);
            return;
          }
          process.stdout.write(`last sync (workspace): ${status.lastSync ?? "never"}\n`);
          if (status.repos.length === 0) {
            process.stdout.write("no repositories tracked\n");
            return;
          }
          for (const repo of status.repos) {
            process.stdout.write(`${repo.line}\n`);
          }
        },
        { command: "status", json: options.json },
      );
    });
}

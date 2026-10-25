import type { Command } from "commander";
import { calculateWorkspaceStats, walkRepositoriesOnDisk } from "../../services/stats.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { type CliContext, requireExistingRoot, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("stats")
    .description("Display repository statistics, language breakdown, and disk usage.")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .option("--json", "Output the statistics as JSON")
    .action(async (options: { dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await requireExistingRoot(options.dir);
          const config = await loadWorkspace(root);
          const disk = walkRepositoriesOnDisk(root);
          const calculated = calculateWorkspaceStats(config, disk);
          if (options.json) {
            const { formatted: _formatted, ...data } = calculated;
            void _formatted;
            process.stdout.write(
              `${JSON.stringify({ command: "stats", ok: true, root, ...data })}\n`,
            );
            return;
          }
          process.stdout.write(`${calculated.formatted}\n`);
        },
        { command: "stats", json: options.json },
      );
    });
}

import type { Command } from "commander";
import { computeWorkspaceHealthScore } from "../../services/healthScore.ts";
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
    .option("--health", "calculate and display overall workspace health scoreboard")
    .option("--json", "Output the statistics as JSON")
    .action(async (options: { dir?: string; health?: boolean; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await requireExistingRoot(options.dir);
          const config = await loadWorkspace(root);
          const disk = walkRepositoriesOnDisk(root);
          const calculated = calculateWorkspaceStats(config, disk);

          if (options.health) {
            const health = await computeWorkspaceHealthScore(root, config);
            if (options.json) {
              const { formatted: _formatted, ...data } = calculated;
              void _formatted;
              process.stdout.write(
                `${JSON.stringify({ command: "stats", ok: true, root, ...data, health })}\n`,
              );
              return;
            }
            process.stdout.write(`${calculated.formatted}\n\n`);
            process.stdout.write(`=== ${health.summary} ===\n`);
            process.stdout.write(
              `Cleanliness:     ${health.breakdown.cleanliness.score}/${health.breakdown.cleanliness.max} (${health.breakdown.cleanliness.dirtyCount} dirty repos)\n`,
            );
            process.stdout.write(
              `Synchronization: ${health.breakdown.synchronization.score}/${health.breakdown.synchronization.max} (${health.breakdown.synchronization.behindCount} behind)\n`,
            );
            process.stdout.write(
              `Active Focus:    ${health.breakdown.focus.score}/${health.breakdown.focus.max} (${health.breakdown.focus.pinnedCount} pinned)\n`,
            );
            process.stdout.write(
              `Hygiene:         ${health.breakdown.hygiene.score}/${health.breakdown.hygiene.max} (${health.breakdown.hygiene.backupCount} backups, ${health.breakdown.hygiene.trashCount} trashed)\n`,
            );
            process.stdout.write(
              `Doctor Checks:   ${health.breakdown.doctor.score}/${health.breakdown.doctor.max} (${health.breakdown.doctor.passed}/${health.breakdown.doctor.total} passed)\n`,
            );
            if (health.recommendations.length > 0) {
              process.stdout.write("\nRecommendations:\n");
              for (const rec of health.recommendations) {
                process.stdout.write(`  - ${rec}\n`);
              }
            }
            return;
          }

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

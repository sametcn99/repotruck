import type { Command } from "commander";
import {
  adoptUnregisteredRepos,
  buildAdoptPlan,
  scanWorkspaceRepos,
} from "../../services/scanner.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { type CliContext, requireExistingRoot, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("scan [directory]")
    .description(
      "Scan directory recursively for git repositories, detect unregistered repos, and optionally move them into preset layout.",
    )
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up)",
    )
    .option(
      "-m, --move",
      "Adopt and move unregistered repositories into their target preset directory",
    )
    .option(
      "--dry-run",
      "Preview planned moves for unregistered repositories without modifying files",
    )
    .option("--json", "Output results as JSON")
    .action(
      async (
        directory: string | undefined,
        options: {
          dir?: string;
          move?: boolean;
          dryRun?: boolean;
          json?: boolean;
        },
      ) => {
        await runAction(
          async () => {
            const root = await requireExistingRoot(directory ?? options.dir);
            const config = await loadWorkspace(root);
            const scanResult = await scanWorkspaceRepos(root, config);

            const plans = buildAdoptPlan(root, config, scanResult.unregistered);

            if (options.move) {
              const execution = await adoptUnregisteredRepos(root, config, plans, {
                dryRun: options.dryRun,
              });

              if (options.json) {
                const payload = {
                  command: "scan",
                  ok: execution.errors.length === 0,
                  dryRun: options.dryRun === true,
                  adopted: execution.adopted,
                  errors: execution.errors,
                };
                process.stdout.write(`${JSON.stringify(payload)}\n`);
                return;
              }

              const prefix = options.dryRun ? "[dry-run] " : "";
              if (execution.adopted.length === 0) {
                process.stdout.write("no unregistered repositories to adopt\n");
              } else {
                for (const item of execution.adopted) {
                  process.stdout.write(
                    `${prefix}adopted ${item.key}: ${item.from} -> ${item.to}\n`,
                  );
                }
              }
              if (execution.errors.length > 0) {
                for (const err of execution.errors) {
                  process.stderr.write(`error adopting ${err.key}: ${err.error}\n`);
                }
              }
              return;
            }

            // Normal scan listing
            if (options.json) {
              const payload = {
                command: "scan",
                ok: true,
                root,
                discoveredCount: scanResult.allDiscovered.length,
                trackedCount: scanResult.tracked.length,
                unregisteredCount: scanResult.unregistered.length,
                unregistered: plans.map((p) => ({
                  owner: p.repo.owner,
                  name: p.repo.name,
                  currentPath: p.repo.relativePath,
                  suggestedPath: p.targetRelativePath,
                  remoteUrl: p.repo.remoteUrl,
                  needsMove: p.needsMove,
                })),
              };
              process.stdout.write(`${JSON.stringify(payload)}\n`);
              return;
            }

            process.stdout.write(
              `scanned ${scanResult.allDiscovered.length} repositories (${scanResult.tracked.length} tracked, ${scanResult.unregistered.length} unregistered)\n`,
            );

            if (scanResult.unregistered.length === 0) {
              process.stdout.write("all discovered repositories are tracked by repotruck\n");
              return;
            }

            process.stdout.write("\nunregistered repositories:\n");
            for (const p of plans) {
              const moveNote = p.needsMove
                ? ` -> ${p.targetRelativePath}`
                : " (already at layout path)";
              process.stdout.write(
                `  * ${p.repo.owner}/${p.repo.name} [${p.repo.relativePath}]${moveNote}\n`,
              );
            }
            process.stdout.write(
              "\nRun 'repotruck scan --move' to adopt and move them into the workspace preset layout.\n",
            );
          },
          { command: "scan", json: options.json },
        );
      },
    );
}

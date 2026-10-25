import type { Command } from "commander";
import { PRESET_IDS } from "../../presets/index.ts";
import { reorganizeWorkspace } from "../../services/reorganizer.ts";
import { readCustomPresets } from "../../services/settings.ts";
import {
  type CliContext,
  exitFail,
  requireExistingRoot,
  requirePreset,
  runAction,
} from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("reorganize")
    .usage("[options] <preset>")
    .description("Move every tracked repository to its path for a new preset.")
    .argument("[preset]", `target preset: ${PRESET_IDS.join(", ")} or a custom preset id`)
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .option("--scan", "also discover untracked Git repositories on disk and adopt them")
    .option("--dry-run", "show the move plan without touching anything")
    .option("--keep-custom", "keep manually placed (custom) repositories where they are")
    .option("--resume", "resume an interrupted reorganization from its journal")
    .option("--json", "Output the plan/result as JSON")
    .action(
      async (
        preset: string | undefined,
        options: {
          dir?: string;
          scan?: boolean;
          dryRun?: boolean;
          keepCustom?: boolean;
          resume?: boolean;
          json?: boolean;
        },
      ) => {
        await runAction(
          async () => {
            const root = await requireExistingRoot(options.dir);
            if (options.resume === true) {
              const result = await reorganizeWorkspace(root, undefined, {
                resume: true,
                env: process.env,
              });
              if (options.json) {
                process.stdout.write(
                  `${JSON.stringify({ command: "reorganize", ok: true, resume: true, ...result })}\n`,
                );
                if (result.failed.length > 0 || result.collisions.length > 0) {
                  process.exitCode = 1;
                  return;
                }
                return;
              }
              for (const move of result.moved) {
                process.stdout.write(`[resume] moved: ${move.key} (${move.from} -> ${move.to})\n`);
              }
              for (const skip of result.skipped) {
                process.stdout.write(`[resume] skipped: ${skip.key} (${skip.reason})\n`);
              }
              for (const failure of result.failed) {
                process.stdout.write(`[resume] failed: ${failure.key} (${failure.message})\n`);
              }
              process.stdout.write(
                `[resume] summary: ${result.moved.length} moved, ${result.skipped.length} skipped, ${result.failed.length} failed\n`,
              );
              if (result.failed.length > 0) {
                process.exitCode = 1;
                return;
              }
              return;
            }

            if (!preset) {
              exitFail("missing required argument 'preset'", options.json, "reorganize");
            }

            const target = await requirePreset(preset, options.json, "reorganize");
            const result = await reorganizeWorkspace(root, target, {
              scan: options.scan === true,
              dryRun: options.dryRun === true,
              keepCustom: options.keepCustom === true,
              env: process.env,
              customPresets: await readCustomPresets(process.env),
            });
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({ command: "reorganize", ok: true, dryRun: options.dryRun === true, ...result })}\n`,
              );
              if (result.failed.length > 0 || result.collisions.length > 0) {
                process.exitCode = 1;
                return;
              }
              return;
            }
            const prefix = options.dryRun === true ? "[dry-run] " : "";
            for (const move of result.moved) {
              process.stdout.write(`${prefix}moved: ${move.key} (${move.from} -> ${move.to})\n`);
            }
            for (const skip of result.skipped) {
              process.stdout.write(`${prefix}skipped: ${skip.key} (${skip.reason})\n`);
            }
            for (const collision of result.collisions) {
              process.stdout.write(
                `${prefix}collision: ${collision.key} -> ${collision.target} (occupied by ${collision.occupiedBy})\n`,
              );
            }
            for (const failure of result.failed) {
              process.stdout.write(`${prefix}failed: ${failure.key} (${failure.message})\n`);
            }
            process.stdout.write(
              `${prefix}summary: ${result.moved.length} moved, ${result.skipped.length} skipped, ${result.collisions.length} collisions, ${result.failed.length} failed\n`,
            );
            if (result.failed.length > 0 || result.collisions.length > 0) {
              process.exitCode = 1;
              return;
            }
          },
          { command: "reorganize", json: options.json },
        );
      },
    );
}

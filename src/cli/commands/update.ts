import type { Command } from "commander";
import { checkForUpdate, performSelfUpdate } from "../../services/updater.ts";
import { readVersion } from "../../services/version.ts";
import { type CliContext, exitFail, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("update")
    .description("Check for a newer repotruck release and self-update global installs.")
    .option("--json", "Output the check result as JSON")
    .action(async (options: { json?: boolean }) => {
      await runAction(
        async () => {
          if (process.env.REPOTRUCK_NO_UPDATE_CHECK) {
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({ command: "update", ok: true, disabled: true, currentVersion: await readVersion() })}\n`,
              );
              return;
            }
            process.stdout.write("update checks are disabled (REPOTRUCK_NO_UPDATE_CHECK is set)\n");
            return;
          }
          const result = await checkForUpdate(process.env, { force: true });
          if (!result.updateAvailable || result.latestVersion === null) {
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({
                  command: "update",
                  ok: true,
                  currentVersion: result.currentVersion,
                  latestVersion: result.latestVersion,
                  updateAvailable: false,
                })}\n`,
              );
              return;
            }
            process.stdout.write(`already up to date (${result.currentVersion})\n`);
            return;
          }
          if (!options.json) {
            process.stdout.write(
              `updating repotruck ${result.currentVersion} -> ${result.latestVersion}\n`,
            );
          }
          const outcome = await performSelfUpdate();
          if (!outcome.updated) {
            exitFail(outcome.message, options.json, "update");
          }
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({
                command: "update",
                ok: true,
                currentVersion: result.currentVersion,
                latestVersion: result.latestVersion,
                updateAvailable: true,
                updated: true,
                message: outcome.message,
              })}\n`,
            );
            return;
          }
          process.stdout.write(`✓ ${outcome.message}\n`);
        },
        { command: "update", json: options.json },
      );
    });
}

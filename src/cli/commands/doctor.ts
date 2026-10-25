import type { Command } from "commander";
import { deviceLogin } from "../../services/auth.ts";
import { fixDoctor, runDoctor } from "../../services/doctor.ts";
import { type CliContext, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("doctor")
    .description("Check system dependencies, configuration, and workspace health.")
    .option("--json", "Output the checks as JSON")
    .option(
      "--fix",
      "attempt to fix what it can: starts 'repotruck auth login' when no token is found",
    )
    .action(async (options: { json?: boolean; fix?: boolean }) => {
      await runAction(
        async () => {
          let result = await runDoctor({ env: process.env });
          if (!result.ok && options.fix === true) {
            const authCheck = result.checks.find((check) => check.check === "token");
            if (authCheck !== undefined && authCheck.status === "fail") {
              process.stdout.write("fix: no GitHub token found - starting device flow login\n");
              await deviceLogin({ env: process.env });
              process.stdout.write("✓ logged in via device flow\n");
            }
            result = await fixDoctor({
              env: process.env,
              onFixProgress: (m) => process.stdout.write(`${m}\n`),
            });
          }
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({
                command: "doctor",
                ok: result.ok,
                checks: result.checks.map(({ formatted, ...check }) => {
                  void formatted;
                  return check;
                }),
              })}\n`,
            );
            if (!result.ok) {
              process.exitCode = 1;
              return;
            }
            return;
          }
          for (const check of result.checks) {
            process.stdout.write(`${check.formatted}\n`);
          }
          if (!result.ok) {
            process.exitCode = 1;
            return;
          }
        },
        { command: "doctor", json: options.json },
      );
    });
}

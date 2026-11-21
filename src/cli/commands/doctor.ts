import type { Command } from "commander";
import { deviceLogin } from "../../services/auth.ts";
import { fixDoctor, runDoctor } from "../../services/doctor.ts";
import { type CliContext, resolveRootOption, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("doctor")
    .description("Check system dependencies, configuration, and workspace health.")
    .option("--json", "Output the checks as JSON")
    .option("--dir <path>", "Check and fix inventory in this workspace")
    .option(
      "--fix",
      "apply suggested inventory repairs, recover interrupted moves, and offer login in a terminal",
    )
    .action(async (options: { json?: boolean; fix?: boolean; dir?: string }) => {
      await runAction(
        async () => {
          const workspaceRoot =
            options.dir === undefined ? undefined : await resolveRootOption(options.dir);
          const deps = { env: process.env, workspaceRoot };
          let result = options.fix
            ? await fixDoctor({
                ...deps,
                onFixProgress: (message) =>
                  (options.json ? process.stderr : process.stdout).write(`${message}\n`),
              })
            : await runDoctor(deps);
          if (options.fix === true) {
            const authCheck = result.checks.find((check) => check.check === "token");
            if (authCheck?.status === "fail" && !options.json && process.stdin.isTTY) {
              process.stdout.write("fix: no GitHub token found - starting device flow login\n");
              await deviceLogin({ env: process.env });
              process.stdout.write("✓ logged in via device flow\n");
              result = await runDoctor(deps);
            }
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

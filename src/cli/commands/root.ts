import type { Command } from "commander";
import {
  effectiveRoot,
  osDefaultRoot,
  readSettings,
  validateRootInput,
  writeSettings,
} from "../../services/settings.ts";
import { type CliContext, exitFail, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("root")
    .description("Show, set, or reset the default workspace root used when no workspace is found.")
    .argument("[path]", "new default root (absolute path, ~ allowed)")
    .option("--reset", "clear the saved default root and return to the OS default")
    .action(async (pathArg: string | undefined, options: { reset?: boolean }) => {
      await runAction(async () => {
        if (options.reset === true) {
          if (pathArg !== undefined) {
            exitFail("root --reset takes no path argument (see: repotruck root --help)");
          }
          const settings = await readSettings(process.env);
          const { defaultRoot: _cleared, ...rest } = settings;
          void _cleared;
          await writeSettings(process.env, rest);
          process.stdout.write(
            `✓ default root cleared; new sessions use the OS default: ${osDefaultRoot(process.env)}\n`,
          );
          return;
        }
        if (pathArg === undefined) {
          const effective = await effectiveRoot(process.env);
          process.stdout.write(
            `default root: ${effective.root}${effective.fromOverride ? " (settings override)" : " (OS default)"}\n`,
          );
          return;
        }
        const validated = validateRootInput(pathArg, process.env);
        if (!validated.ok) exitFail(validated.error);
        const settings = await readSettings(process.env);
        await writeSettings(process.env, { ...settings, defaultRoot: validated.root });
        process.stdout.write(`✓ default root set: ${validated.root}\n`);
      });
    });
}

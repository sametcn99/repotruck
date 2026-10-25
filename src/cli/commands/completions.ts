import type { Command } from "commander";
import { PRESET_IDS } from "../../presets/index.ts";
import { LANG_ALIASES, SYMBOL_KINDS } from "../../services/codeSearch.ts";
import {
  buildCompletions,
  type CompletionCommand,
  isSupportedShell,
} from "../../services/completions.ts";
import { detectApps, listAliases } from "../../services/launcher.ts";
import { readCustomPresets } from "../../services/settings.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { type CliContext, exitFail, resolveRootOption, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("completions")
    .description("Generate shell completion scripts (bash, zsh, fish, powershell).")
    .argument("<shell>", "Target shell: bash, zsh, fish, or powershell")
    .action(async (shell: string) => {
      await runAction(async () => {
        if (!isSupportedShell(shell)) {
          exitFail(`unsupported shell: ${shell} (expected bash, zsh, fish, powershell)`);
        }
        const collect = (cmds: readonly Command[]): CompletionCommand[] =>
          cmds.map((cmd) => ({
            name: cmd.name(),
            description: cmd.description(),
            options: cmd.options.map((opt) => ({
              flags: opt.flags,
              long: opt.long,
              short: opt.short,
              description: opt.description,
            })),
            ...(cmd.commands.length > 0 ? { subcommands: collect(cmd.commands) } : {}),
          }));
        const script = buildCompletions(
          shell,
          collect(program.commands.filter((cmd) => cmd.name() !== "__complete")),
        );
        process.stdout.write(`${script}\n`);
      });
    });

  const completeCommand = program
    .command("__complete", { hidden: true })
    .description("Print whitespace-separated completion candidates (used by shell completions).");

  completeCommand.command("presets", { hidden: true }).action(async () => {
    const customs = await readCustomPresets(process.env);
    process.stdout.write(`${[...PRESET_IDS, ...customs.map((p) => p.id)].join(" ")}\n`);
  });

  completeCommand.command("apps", { hidden: true }).action(async () => {
    const apps = await detectApps({ env: process.env });
    process.stdout.write(`${apps.map((app) => app.name).join(" ")}\n`);
  });

  completeCommand.command("aliases", { hidden: true }).action(async () => {
    try {
      const root = await resolveRootOption();
      const config = await loadWorkspace(root);
      process.stdout.write(
        `${listAliases(config)
          .map((item) => item.alias)
          .join(" ")}\n`,
      );
    } catch {
      process.stdout.write("\n");
    }
  });

  completeCommand.command("scopes", { hidden: true }).action(async () => {
    process.stdout.write("user all org:\n");
  });

  completeCommand.command("kinds", { hidden: true }).action(async () => {
    process.stdout.write(`${SYMBOL_KINDS.join(" ")}\n`);
  });

  completeCommand.command("langs", { hidden: true }).action(async () => {
    process.stdout.write(`${Object.keys(LANG_ALIASES).join(" ")}\n`);
  });

  completeCommand.command("divergence", { hidden: true }).action(async () => {
    process.stdout.write("fail rebase reset skip\n");
  });
}

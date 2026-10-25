import type { Command } from "commander";
import {
  applyAgentsMdTemplate,
  clearAgentsMdTemplate,
  listAgentsMdTemplates,
} from "../../services/templates.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { type CliContext, exitFail, requireExistingRoot, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  const instructionsCommand = program
    .command("instructions")
    .description("Manage the generated AGENTS.md workspace map.");

  instructionsCommand
    .command("template")
    .description("Manage the AGENTS.md instruction templates.")
    .argument("[name]", "Template name to apply (node, python, monorepo)")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .option("--clear", "Clear any applied template rules from AGENTS.md")
    .action(async (name: string | undefined, options: { dir?: string; clear?: boolean }) => {
      await runAction(async () => {
        if (options.clear === true) {
          const root = await requireExistingRoot(options.dir);
          const config = await loadWorkspace(root);
          const res = await clearAgentsMdTemplate({
            root,
            repos: config.repos,
            preset: config.preset,
            lastSync: config.lastSync,
            aliases: config.aliases,
          });
          process.stdout.write(`${res.message}\n`);
          return;
        }
        if (name === undefined || name.trim().length === 0) {
          const templates = listAgentsMdTemplates();
          for (const t of templates) {
            process.stdout.write(`${t.name} - ${t.description}\n`);
          }
          return;
        }
        const root = await requireExistingRoot(options.dir);
        const config = await loadWorkspace(root);
        const res = await applyAgentsMdTemplate(
          {
            root,
            repos: config.repos,
            preset: config.preset,
            lastSync: config.lastSync,
            aliases: config.aliases,
          },
          name,
        );
        if (!res.ok) {
          exitFail(res.message);
        }
        process.stdout.write(`${res.message}\n`);
      });
    });
}

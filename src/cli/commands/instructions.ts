import type { Command } from "commander";
import {
  exportInstructionsFile,
  INSTRUCTION_FORMATS,
  isInstructionFormat,
} from "../../services/instructionExport.ts";
import {
  applyAgentsMdTemplate,
  clearAgentsMdTemplate,
  listAgentsMdTemplates,
} from "../../services/templates.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { findLinkedWorktrees } from "../../services/worktree.ts";
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

  instructionsCommand
    .command("export")
    .description(
      "Export workspace agent instructions to formats like CursorRules, Copilot, Claude, or AGENTS.md.",
    )
    .option(
      "-f, --format <format>",
      `export format: ${INSTRUCTION_FORMATS.join(", ")} (default: cursor)`,
      "cursor",
    )
    .option("-o, --out <path>", "custom output file path")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .option("--json", "Output result as JSON")
    .action(async (options: { format?: string; out?: string; dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const rawFormat = options.format ?? "cursor";
          if (!isInstructionFormat(rawFormat)) {
            exitFail(`invalid format: must be one of: ${INSTRUCTION_FORMATS.join(", ")}`);
          }
          const root = await requireExistingRoot(options.dir);
          const config = await loadWorkspace(root);
          let worktrees: Awaited<ReturnType<typeof findLinkedWorktrees>> = [];
          try {
            worktrees = await findLinkedWorktrees(root, 4);
          } catch {
            worktrees = [];
          }

          const res = await exportInstructionsFile(
            root,
            {
              preset: config.preset,
              lastSync: config.lastSync,
              repos: config.repos,
              aliases: config.aliases,
              pinned: config.pinned,
              worktrees,
            },
            rawFormat,
            options.out,
          );

          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({
                command: "instructions export",
                ok: true,
                format: res.format,
                targetPath: res.targetPath,
              })}\n`,
            );
            return;
          }

          process.stdout.write(`Exported ${res.format} instructions to: ${res.targetPath}\n`);
        },
        { command: "instructions export", json: options.json },
      );
    });
}

import type { Command } from "commander";
import {
  listWorkspaceAliases,
  removeWorkspaceAlias,
  setWorkspaceAlias,
} from "../../core/aliases.ts";
import { type CliContext, requireExistingRoot, resolveRootOption, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  const aliasCommand = program
    .command("alias")
    .description("Manage repository aliases (short names usable with `open`).");

  aliasCommand
    .command("set")
    .description("Set an alias for a tracked repository.")
    .argument("<alias>", "alias name (letters, digits, dots, dashes, underscores)")
    .argument("<repo>", "repository alias, workspace-relative path, or owner/name")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .action(async (alias: string, repo: string, options: { dir?: string }) => {
      await runAction(async () => {
        const root = await requireExistingRoot(options.dir);
        const res = await setWorkspaceAlias(root, alias, repo);
        if (!res.ok) throw new Error(res.message);
        process.stdout.write(`✓ ${res.message}\n`);
      });
    });

  aliasCommand
    .command("remove")
    .description("Remove a repository alias.")
    .argument("<alias>", "alias name")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .action(async (alias: string, options: { dir?: string }) => {
      await runAction(async () => {
        const root = await requireExistingRoot(options.dir);
        const res = await removeWorkspaceAlias(root, alias);
        if (!res.ok) throw new Error(res.message);
        process.stdout.write(`✓ ${res.message}\n`);
      });
    });

  aliasCommand
    .command("list")
    .description("List all repository aliases.")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .option("--json", "Output aliases as JSON")
    .action(async (options: { dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await resolveRootOption(options.dir);
          const listings = await listWorkspaceAliases(root);
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ command: "alias list", ok: true, aliases: listings })}\n`,
            );
            return;
          }
          if (listings.length === 0) {
            process.stdout.write("no aliases defined\n");
            return;
          }
          for (const item of listings) {
            process.stdout.write(`${item.alias} -> ${item.target}\n`);
          }
        },
        { command: "alias list", json: options.json },
      );
    });
}

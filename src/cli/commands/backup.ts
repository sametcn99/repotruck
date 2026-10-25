import type { Command } from "commander";
import { listWorkspaceSnapshots } from "../../services/backups.ts";
import { restoreWorkspaceSnapshot } from "../../services/workspaceRegistry.ts";
import { type CliContext, exitFail, requireExistingRoot, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("backup")
    .description("List and restore automatic workspace snapshots (<root>/.repotruck/backups).")
    .argument("[action]", '"list" (the default) or "restore"')
    .argument("[snapshot]", 'snapshot filename to restore (required with "restore")')
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .option("--yes", "confirm the restore (required; it replaces the current inventory)")
    .option("--json", "Output the snapshot listing as JSON")
    .action(
      async (
        action: string | undefined,
        snapshot: string | undefined,
        options: { dir?: string; yes?: boolean; json?: boolean },
      ) => {
        await runAction(
          async () => {
            const verb = action ?? "list";
            if (verb !== "list" && verb !== "restore") {
              exitFail(
                `unknown action: ${verb} (expected "list" or "restore")`,
                options.json,
                "backup",
              );
            }
            const root = await requireExistingRoot(options.dir);
            if (verb === "list") {
              const entries = await listWorkspaceSnapshots(root);
              if (options.json) {
                process.stdout.write(
                  `${JSON.stringify({ command: "backup", ok: true, snapshots: entries })}\n`,
                );
                return;
              }
              if (entries.length === 0) {
                process.stdout.write(
                  "no snapshots yet (one is written on every workspace change)\n",
                );
                return;
              }
              for (const entry of entries) {
                process.stdout.write(
                  `${entry.file} — ${entry.repoCount} repos (${entry.createdAt})\n`,
                );
              }
              return;
            }
            if (snapshot === undefined || snapshot.length === 0) {
              exitFail(
                "backup restore requires a snapshot filename (see: repotruck backup list)",
                options.json,
                "backup",
              );
            }
            if (options.yes !== true) {
              exitFail(
                "backup restore requires --yes (it replaces the current workspace inventory)",
                options.json,
                "backup",
              );
            }
            const result = await restoreWorkspaceSnapshot(root, snapshot, process.env);
            if (!result.ok) exitFail(result.message, options.json, "backup");
            process.stdout.write(`✓ ${result.message}\n`);
          },
          { command: "backup", json: options.json },
        );
      },
    );
}

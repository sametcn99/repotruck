import type { Command } from "commander";
import { refreshCodeIndexIfPresent } from "../../services/codeSearch.ts";
import { formatDiskSize } from "../../services/stats.ts";
import { emptyTrash, listTrashEntries, restoreTrashEntry } from "../../services/trash.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import {
  type CliContext,
  exitFail,
  parseIntStrict,
  requireExistingRoot,
  runAction,
} from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  const trashCmd = program
    .command("trash")
    .description("Inspect, restore, or empty soft-deleted repositories (<root>/.repotruck/trash).");

  trashCmd
    .command("list", { isDefault: true })
    .description("List trashed repositories in the workspace.")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--json", "Output trashed entries as JSON")
    .action(async (options: { dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await requireExistingRoot(options.dir);
          const entries = listTrashEntries(root);
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ command: "trash list", ok: true, root, entries })}\n`,
            );
            return;
          }
          if (entries.length === 0) {
            process.stdout.write("trash is empty\n");
            return;
          }
          for (const entry of entries) {
            process.stdout.write(
              `${entry.id} — ${entry.owner}/${entry.name} (${formatDiskSize(entry.sizeBytes)}, trashed ${entry.trashedAt})\n`,
            );
          }
        },
        { command: "trash list", json: options.json },
      );
    });

  trashCmd
    .command("restore")
    .description("Restore a trashed repository back into the workspace layout.")
    .argument("<selector>", "trash entry ID, owner/name, or repository name")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--json", "Output result as JSON")
    .action(async (selector: string, options: { dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await requireExistingRoot(options.dir);
          const result = await restoreTrashEntry(root, selector, { env: process.env });
          if (!result.ok) {
            exitFail(result.message, options.json, "trash restore");
          }
          await refreshCodeIndexIfPresent(root, await loadWorkspace(root, undefined, process.env));
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({
                command: "trash restore",
                ok: true,
                root,
                restoredTo: result.restoredTo,
                message: result.message,
              })}\n`,
            );
            return;
          }
          process.stdout.write(`✓ ${result.message}\n`);
        },
        { command: "trash restore", json: options.json },
      );
    });

  trashCmd
    .command("empty")
    .description("Permanently remove trashed repositories from disk.")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--older-than <days>", "only delete entries trashed more than N days ago")
    .option("--yes", "confirm permanent deletion (required)")
    .option("--json", "Output result as JSON")
    .action(
      async (options: { dir?: string; olderThan?: string; yes?: boolean; json?: boolean }) => {
        await runAction(
          async () => {
            const root = await requireExistingRoot(options.dir);
            let olderThanDays: number | undefined;
            if (options.olderThan !== undefined) {
              olderThanDays = parseIntStrict(
                options.olderThan,
                "older-than",
                options.json,
                "trash empty",
              );
            }
            if (options.yes !== true) {
              exitFail(
                "trash empty requires --yes (this permanently removes trashed directories from disk)",
                options.json,
                "trash empty",
              );
            }
            const result = emptyTrash(root, { olderThanDays });
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({
                  command: "trash empty",
                  ok: true,
                  root,
                  removed: result.removed.map((e) => e.id),
                  kept: result.kept.map((e) => e.id),
                  freedBytes: result.freedBytes,
                })}\n`,
              );
              return;
            }
            process.stdout.write(
              `✓ removed ${result.removed.length} trashed entries (freed ${formatDiskSize(result.freedBytes)}${
                result.kept.length > 0 ? `, kept ${result.kept.length}` : ""
              })\n`,
            );
          },
          { command: "trash empty", json: options.json },
        );
      },
    );
}

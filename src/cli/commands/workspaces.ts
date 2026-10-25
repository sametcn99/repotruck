import type { Command } from "commander";
import { formatWorkspaceLine } from "../../cliSupport.ts";
import {
  centralStorePath,
  listWorkspaces,
  removeWorkspace,
} from "../../services/workspaceRegistry.ts";
import { type CliContext, exitFail, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("workspaces")
    .description("List or remove registered repotruck workspaces.")
    .argument("[action]", '"list" (the default) or "remove"')
    .argument("[path]", 'workspace path to remove (required with "remove")')
    .option("--json", "Output the workspace listing as JSON")
    .action(
      async (
        action: string | undefined,
        wsPath: string | undefined,
        options: { json?: boolean },
      ) => {
        await runAction(
          async () => {
            const verb = action ?? "list";
            if (verb !== "list" && verb !== "remove") {
              exitFail(
                `unknown action: ${verb} (expected "list" or "remove")`,
                options.json,
                "workspaces",
              );
            }
            if (verb === "list") {
              process.stdout.write(`workspace records: ${centralStorePath()}\n`);
              const listing = await listWorkspaces();
              if (options.json) {
                process.stdout.write(
                  `${JSON.stringify({ command: "workspaces", ok: true, workspaces: listing })}\n`,
                );
                return;
              }
              if (listing.length === 0) {
                process.stdout.write("no registered workspaces\n");
                return;
              }
              for (const item of listing) {
                process.stdout.write(`${formatWorkspaceLine(item)}\n`);
              }
              return;
            }
            if (wsPath === undefined || wsPath.length === 0) {
              exitFail(
                "workspaces remove requires a path (see: repotruck workspaces --help)",
                options.json,
                "workspaces",
              );
            }
            const removed = await removeWorkspace(wsPath);
            if (removed === null) {
              exitFail(
                `workspace not found: ${wsPath} (records: ${centralStorePath()})`,
                options.json,
                "workspaces",
              );
            }
            process.stdout.write(
              `✓ removed workspace: ${removed.root} — records: ${centralStorePath()}\n`,
            );
          },
          { command: "workspaces", json: options.json },
        );
      },
    );
}

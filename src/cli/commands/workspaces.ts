import type { Command } from "commander";
import { formatWorkspaceLine } from "../../cliSupport.ts";
import { validateRootInput } from "../../services/settings.ts";
import { registerWorkspace } from "../../services/workspace.ts";
import {
  centralStorePath,
  listWorkspaces,
  removeWorkspace,
} from "../../services/workspaceRegistry.ts";
import { type CliContext, exitFail, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("workspaces")
    .description("List, add, or remove registered repotruck workspaces.")
    .argument("[action]", '"list" (the default), "add", or "remove"')
    .argument("[path]", 'workspace path (required with "add" and "remove")')
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
            if (verb !== "list" && verb !== "add" && verb !== "remove") {
              exitFail(
                `unknown action: ${verb} (expected "list", "add", or "remove")`,
                options.json,
                "workspaces",
              );
            }
            if (verb === "list") {
              const listing = await listWorkspaces();
              if (options.json) {
                process.stdout.write(
                  `${JSON.stringify({ command: "workspaces", ok: true, workspaces: listing })}\n`,
                );
                return;
              }
              process.stdout.write(`workspace records: ${centralStorePath()}\n`);
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
                `workspaces ${verb} requires a path (see: repotruck workspaces --help)`,
                options.json,
                "workspaces",
              );
            }
            if (verb === "add") {
              const validated = validateRootInput(wsPath);
              if (!validated.ok) exitFail(validated.error, options.json, "workspaces");
              const config = await registerWorkspace(validated.root);
              process.stdout.write(
                options.json
                  ? `${JSON.stringify({ command: "workspaces", ok: true, root: config.root, preset: config.preset })}\n`
                  : `✓ registered workspace: ${config.root} — records: ${centralStorePath()}\n`,
              );
              return;
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

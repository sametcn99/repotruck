import type { Command } from "commander";
import {
  deleteWorkspaceProfile,
  getWorkspaceProfilesAndPinned,
  pinWorkspaceRepo,
  saveWorkspaceProfile,
  unpinWorkspaceRepo,
} from "../../core/profiles.ts";
import {
  type CliContext,
  exitFail,
  requireExistingRoot,
  resolveRootOption,
  runAction,
} from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  const profileCmd = program
    .command("profile")
    .description("Manage pinned focus repositories and named workspace repository profiles.");

  profileCmd
    .command("list", { isDefault: true })
    .description("List pinned repositories and named profiles in the workspace.")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--json", "Output pinned repos and profiles as JSON")
    .action(async (options: { dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await resolveRootOption(options.dir);
          const data = await getWorkspaceProfilesAndPinned(root, process.env);
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({
                command: "profile list",
                ok: true,
                root,
                pinned: data.pinned,
                profiles: data.profiles,
              })}\n`,
            );
            return;
          }
          process.stdout.write(
            `pinned (${data.pinned.length}): ${data.pinned.length > 0 ? data.pinned.join(", ") : "(none)"}\n`,
          );
          if (data.profiles.length === 0) {
            process.stdout.write("profiles: (none)\n");
            return;
          }
          for (const p of data.profiles) {
            process.stdout.write(`profile ${p.name} (${p.repos.length}): ${p.repos.join(", ")}\n`);
          }
        },
        { command: "profile list", json: options.json },
      );
    });

  profileCmd
    .command("pin")
    .description("Pin one or more tracked repositories to the active focus list.")
    .argument("<repos...>", "repositories by owner/name, alias, or workspace-relative path")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--json", "Output result as JSON")
    .action(async (repos: string[], options: { dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await requireExistingRoot(options.dir);
          const messages: string[] = [];
          for (const ref of repos) {
            const res = await pinWorkspaceRepo(root, ref, process.env);
            if (!res.ok) exitFail(res.message, options.json, "profile pin");
            messages.push(res.message);
          }
          const updated = await getWorkspaceProfilesAndPinned(root, process.env);
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ command: "profile pin", ok: true, root, pinned: updated.pinned, messages })}\n`,
            );
            return;
          }
          for (const msg of messages) {
            process.stdout.write(`✓ ${msg}\n`);
          }
        },
        { command: "profile pin", json: options.json },
      );
    });

  profileCmd
    .command("unpin")
    .description("Remove one or more repositories from the pinned focus list.")
    .argument("<repos...>", "repositories by owner/name, alias, or workspace-relative path")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--json", "Output result as JSON")
    .action(async (repos: string[], options: { dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await requireExistingRoot(options.dir);
          const messages: string[] = [];
          for (const ref of repos) {
            const res = await unpinWorkspaceRepo(root, ref, process.env);
            if (!res.ok) exitFail(res.message, options.json, "profile unpin");
            messages.push(res.message);
          }
          const updated = await getWorkspaceProfilesAndPinned(root, process.env);
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ command: "profile unpin", ok: true, root, pinned: updated.pinned, messages })}\n`,
            );
            return;
          }
          for (const msg of messages) {
            process.stdout.write(`✓ ${msg}\n`);
          }
        },
        { command: "profile unpin", json: options.json },
      );
    });

  profileCmd
    .command("save")
    .description("Save a named repository profile from explicit refs or the current pinned list.")
    .argument("<name>", "profile name (letters, digits, dots, dashes, underscores)")
    .argument("[repos...]", "repositories by owner/name, alias, or workspace-relative path")
    .option("--from-pinned", "populate the profile from the currently pinned repositories")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--json", "Output result as JSON")
    .action(
      async (
        name: string,
        repos: string[],
        options: { fromPinned?: boolean; dir?: string; json?: boolean },
      ) => {
        await runAction(
          async () => {
            const root = await requireExistingRoot(options.dir);
            let targetRefs = [...repos];
            if (options.fromPinned) {
              const current = await getWorkspaceProfilesAndPinned(root, process.env);
              targetRefs = [...targetRefs, ...current.pinned];
            }
            const res = await saveWorkspaceProfile(root, name, targetRefs, process.env);
            if (!res.ok) exitFail(res.message, options.json, "profile save");
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({ command: "profile save", ok: true, root, name, message: res.message })}\n`,
              );
              return;
            }
            process.stdout.write(`✓ ${res.message}\n`);
          },
          { command: "profile save", json: options.json },
        );
      },
    );

  profileCmd
    .command("delete")
    .description("Delete a named repository profile.")
    .argument("<name>", "profile name")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--json", "Output result as JSON")
    .action(async (name: string, options: { dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await requireExistingRoot(options.dir);
          const res = await deleteWorkspaceProfile(root, name, process.env);
          if (!res.ok) exitFail(res.message, options.json, "profile delete");
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ command: "profile delete", ok: true, root, name, message: res.message })}\n`,
            );
            return;
          }
          process.stdout.write(`✓ ${res.message}\n`);
        },
        { command: "profile delete", json: options.json },
      );
    });
}

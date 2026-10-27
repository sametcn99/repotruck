import path from "node:path";
import type { Command } from "commander";
import { resolveRepoRef } from "../../services/launcher.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import {
  createRepoWorktree,
  findLinkedWorktrees,
  listRepoWorktrees,
  removeRepoWorktree,
} from "../../services/worktree.ts";
import { type CliContext, exitFail, requireExistingRoot, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  const wtCmd = program
    .command("worktree")
    .description("Manage linked git worktrees for workspace repositories.");

  wtCmd
    .command("list")
    .description("List worktrees belonging to a tracked repository.")
    .argument("<repo>", "Repository alias, workspace-relative path, or owner/name")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--json", "Output worktree list as JSON")
    .action(async (repoArg: string, options: { dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await requireExistingRoot(options.dir);
          const config = await loadWorkspace(root);
          const match = resolveRepoRef(config, repoArg);
          if (match === null) {
            exitFail(`repository not found: ${repoArg}`);
          }
          const repoDir = path.join(root, ...match.entry.relativePath.split("/"));
          const worktrees = await listRepoWorktrees(repoDir);
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ command: "worktree list", ok: true, repo: match.entry.relativePath, worktrees })}\n`,
            );
            return;
          }
          if (worktrees.length === 0) {
            process.stdout.write(
              `no worktrees found for ${match.entry.owner}/${match.entry.name}\n`,
            );
            return;
          }
          process.stdout.write(`Worktrees for ${match.entry.owner}/${match.entry.name}:\n`);
          for (const wt of worktrees) {
            const role = wt.isMain ? " (main)" : "";
            const branch = wt.branch ? `[${wt.branch}]` : "[detached]";
            const locked = wt.locked ? " [locked]" : "";
            process.stdout.write(`  ${wt.path} ${branch}${role}${locked}\n`);
          }
        },
        { command: "worktree list", json: options.json },
      );
    });

  wtCmd
    .command("scan")
    .description("Discover all linked git worktrees across the workspace.")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--json", "Output discovered worktrees as JSON")
    .action(async (options: { dir?: string; json?: boolean }) => {
      await runAction(
        async () => {
          const root = await requireExistingRoot(options.dir);
          const found = await findLinkedWorktrees(root);
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ command: "worktree scan", ok: true, root, worktrees: found })}\n`,
            );
            return;
          }
          if (found.length === 0) {
            process.stdout.write("no linked worktrees discovered in workspace\n");
            return;
          }
          process.stdout.write(`Discovered ${found.length} linked worktree(s):\n`);
          for (const item of found) {
            const parent = item.mainRepoDir ? ` -> parent: ${item.mainRepoDir}` : "";
            process.stdout.write(`  ${item.relativePath}${parent}\n`);
          }
        },
        { command: "worktree scan", json: options.json },
      );
    });

  wtCmd
    .command("create")
    .description("Create a new git worktree for a branch.")
    .argument("<repo>", "Repository alias, workspace-relative path, or owner/name")
    .argument("<branch>", "Branch name for the worktree")
    .argument("[path]", "Destination directory path for the worktree")
    .option("-b, --new-branch", "Create a new branch instead of checking out existing")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--json", "Output creation result as JSON")
    .action(
      async (
        repoArg: string,
        branch: string,
        targetPathArg: string | undefined,
        options: { newBranch?: boolean; dir?: string; json?: boolean },
      ) => {
        await runAction(
          async () => {
            const root = await requireExistingRoot(options.dir);
            const config = await loadWorkspace(root);
            const match = resolveRepoRef(config, repoArg);
            if (match === null) {
              exitFail(`repository not found: ${repoArg}`);
            }
            const repoDir = path.join(root, ...match.entry.relativePath.split("/"));
            const safeBranchName = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
            const targetPath =
              targetPathArg ??
              path.join(path.dirname(repoDir), `${match.entry.name}+${safeBranchName}`);

            const result = await createRepoWorktree(repoDir, branch, targetPath, {
              newBranch: options.newBranch === true,
            });
            if (!result.ok) {
              exitFail(`worktree create failed: ${result.message}`);
            }
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({
                  command: "worktree create",
                  ok: true,
                  repo: match.entry.relativePath,
                  branch,
                  path: result.path,
                })}\n`,
              );
              return;
            }
            process.stdout.write(`${result.message}\n`);
          },
          { command: "worktree create", json: options.json },
        );
      },
    );

  wtCmd
    .command("remove")
    .description("Remove an existing git worktree.")
    .argument("<repo>", "Repository alias, workspace-relative path, or owner/name")
    .argument("<path>", "Worktree path to remove")
    .option("-f, --force", "Force removal even if worktree contains untracked changes")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--json", "Output removal result as JSON")
    .action(
      async (
        repoArg: string,
        pathArg: string,
        options: { force?: boolean; dir?: string; json?: boolean },
      ) => {
        await runAction(
          async () => {
            const root = await requireExistingRoot(options.dir);
            const config = await loadWorkspace(root);
            const match = resolveRepoRef(config, repoArg);
            if (match === null) {
              exitFail(`repository not found: ${repoArg}`);
            }
            const repoDir = path.join(root, ...match.entry.relativePath.split("/"));
            const targetPath = path.isAbsolute(pathArg) ? pathArg : path.resolve(root, pathArg);
            const result = await removeRepoWorktree(repoDir, targetPath, options.force === true);
            if (!result.ok) {
              exitFail(`worktree remove failed: ${result.message}`);
            }
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({
                  command: "worktree remove",
                  ok: true,
                  repo: match.entry.relativePath,
                  path: targetPath,
                })}\n`,
              );
              return;
            }
            process.stdout.write(`${result.message}\n`);
          },
          { command: "worktree remove", json: options.json },
        );
      },
    );
}

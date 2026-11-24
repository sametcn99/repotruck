import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { type RepotruckConfig, writeAgentsMd } from "./config.ts";
import { writeFileAtomic } from "./fsUtils.ts";
import { assertWorkspacePath } from "./workspacePaths.ts";
import { findLinkedWorktrees } from "./worktree.ts";

export function agentsRecoveryPath(root: string) {
  return assertWorkspacePath(root, path.join(root, ".repotruck", "pending-agents.json"));
}

export async function prepareAgentsUpdate(root: string) {
  const file = agentsRecoveryPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, '{"version":1}\n');
}

export async function regenerateWorkspaceMap(root: string, config: RepotruckConfig) {
  const worktrees = await findLinkedWorktrees(root, 4).catch(() => []);
  await writeAgentsMd(
    root,
    config.repos,
    config.preset,
    config.lastSync,
    config.aliases,
    undefined,
    { pinned: config.pinned, worktrees },
  );
  await rm(agentsRecoveryPath(root), { force: true });
}

export async function recoverWorkspaceMap(root: string, config: RepotruckConfig) {
  if (existsSync(agentsRecoveryPath(root))) await regenerateWorkspaceMap(root, config);
}

import path from "node:path";
import { resolveRepoRef, runAppInRepo, type SpawnImpl } from "../../services/launcher.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import {
  createRepoWorktree,
  listRepoWorktrees,
  type RepoWorktreeDetail,
  removeRepoWorktree,
} from "../../services/worktree.ts";
import type { ResolvedStoreDeps } from "./defaults.ts";

/**
 * Worktree and launcher workflows split out of modalWorkflows.ts for the
 * file-size budget. Behavior is unchanged.
 */
export async function performRunOpenApp(
  root: string,
  key: string,
  appName: string,
  deps: ResolvedStoreDeps,
): Promise<{ code: number; error?: string }> {
  const resolved = await deps.resolveAppFn(appName);
  if (resolved === null) {
    return { code: 1, error: `unknown app: ${appName}` };
  }
  const config = await loadWorkspace(root);
  const options: { spawnImpl?: SpawnImpl } =
    deps.spawnImpl !== undefined ? { spawnImpl: deps.spawnImpl } : {};
  const result = await runAppInRepo(
    { root, config, ref: key, app: resolved, mode: "attached-resume" },
    options,
  );
  return {
    code: result.code ?? 1,
    ...(result.message !== undefined && !result.ok ? { error: result.message } : {}),
  };
}

export async function performOpenWorktreeModal(
  root: string,
  key: string,
): Promise<RepoWorktreeDetail[]> {
  const config = await loadWorkspace(root);
  const match = resolveRepoRef(config, key);
  if (match === null) {
    throw new Error(`repository not found: ${key}`);
  }
  const repoDir = path.join(root, ...match.entry.relativePath.split("/"));
  return await listRepoWorktrees(repoDir);
}

export async function performCreateWorktree(
  root: string,
  key: string,
  branch: string,
  targetPath?: string,
  newBranch = false,
): Promise<{ ok: boolean; message: string }> {
  const config = await loadWorkspace(root);
  const match = resolveRepoRef(config, key);
  if (match === null) {
    return { ok: false, message: `repository not found: ${key}` };
  }
  const repoDir = path.join(root, ...match.entry.relativePath.split("/"));
  const safeBranch = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
  const destPath =
    targetPath ?? path.join(path.dirname(repoDir), `${match.entry.name}+${safeBranch}`);
  return await createRepoWorktree(repoDir, branch, destPath, { newBranch });
}

export async function performRemoveWorktree(
  root: string,
  key: string,
  targetPath: string,
  force = false,
): Promise<{ ok: boolean; message: string }> {
  const config = await loadWorkspace(root);
  const match = resolveRepoRef(config, key);
  if (match === null) {
    return { ok: false, message: `repository not found: ${key}` };
  }
  const repoDir = path.join(root, ...match.entry.relativePath.split("/"));
  return await removeRepoWorktree(repoDir, targetPath, force);
}

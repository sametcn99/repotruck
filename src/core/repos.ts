import type { EnvLike } from "../services/config.ts";
import type { GitHubService } from "../services/github.ts";
import {
  archiveRepository,
  deleteRepository,
  forgetRepository,
  pruneWorkspace,
} from "../services/lifecycle.ts";
import { moveRepository } from "../services/mover.ts";
import { loadWorkspace } from "../services/workspace.ts";

type MoveOptions = Parameters<typeof moveRepository>[4];

export async function moveRepo(
  root: string,
  key: string,
  destRelative: string,
  options?: MoveOptions,
) {
  const config = await loadWorkspace(root);
  return moveRepository(root, config, key, destRelative, options);
}

export async function forgetRepo(root: string, ref: string, env?: EnvLike) {
  const config = await loadWorkspace(root, undefined, env);
  return forgetRepository(root, config, ref, env);
}

export async function deleteRepo(
  root: string,
  ref: string,
  options: { yes: boolean },
  env?: EnvLike,
) {
  const config = await loadWorkspace(root, undefined, env);
  return deleteRepository(root, config, ref, options, env);
}

export async function archiveRepo(root: string, ref: string, github: GitHubService, env?: EnvLike) {
  const config = await loadWorkspace(root, undefined, env);
  return archiveRepository(root, config, ref, github, {}, env);
}

export async function pruneRepos(
  root: string,
  github: GitHubService,
  options: { dryRun: boolean },
  env?: EnvLike,
) {
  const config = await loadWorkspace(root, undefined, env);
  return pruneWorkspace(root, config, github, options, env);
}

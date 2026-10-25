import type { EnvLike } from "../services/config.ts";
import type { DetailedGitStatus } from "../services/gitState.ts";
import { type WorkspaceStatusOptions, workspaceStatus } from "../services/lifecycle.ts";
import { loadWorkspace } from "../services/workspace.ts";

export type { DetailedGitStatus };

export async function getWorkspaceStatus(
  root: string,
  env?: EnvLike,
  options?: WorkspaceStatusOptions,
) {
  const config = await loadWorkspace(root, undefined, env);
  return workspaceStatus(root, config, options);
}

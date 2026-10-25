import type { EnvLike } from "../services/config.ts";
import { workspaceStatus } from "../services/lifecycle.ts";
import { loadWorkspace } from "../services/workspace.ts";

export async function getWorkspaceStatus(root: string, env?: EnvLike) {
  const config = await loadWorkspace(root, undefined, env);
  return workspaceStatus(root, config);
}

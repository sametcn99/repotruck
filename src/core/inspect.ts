import type { EnvLike } from "../services/config.ts";
import type { DetailedGitStatus } from "../services/gitState.ts";
import { type WorkspaceStatusOptions, workspaceStatus } from "../services/lifecycle.ts";
import { resolveProfileKeys } from "../services/profiles.ts";
import { loadWorkspace } from "../services/workspace.ts";

export type { DetailedGitStatus };

export interface InspectWorkspaceOptions extends WorkspaceStatusOptions {
  pinned?: boolean;
  profile?: string;
}

export async function getWorkspaceStatus(
  root: string,
  env?: EnvLike,
  options?: InspectWorkspaceOptions,
) {
  let config = await loadWorkspace(root, undefined, env);
  if (options?.pinned || options?.profile !== undefined) {
    const allowed = new Set<string>();
    if (options.pinned) {
      for (const key of config.pinned ?? []) {
        allowed.add(key.toLowerCase());
      }
    }
    if (options.profile !== undefined) {
      const profileKeys = resolveProfileKeys(config, options.profile);
      if (profileKeys === null) {
        throw new Error(`profile not found: ${options.profile}`);
      }
      for (const key of profileKeys) {
        allowed.add(key.toLowerCase());
      }
    }
    config = {
      ...config,
      repos: config.repos.filter((r) => allowed.has(`${r.owner}/${r.name}`.toLowerCase())),
    };
  }
  return workspaceStatus(root, config, options);
}

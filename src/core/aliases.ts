import type { EnvLike } from "../services/config.ts";
import { listAliases, removeAlias, setAlias } from "../services/launcher.ts";
import { loadWorkspace, updateWorkspace } from "../services/workspace.ts";

/**
 * Expected-flow failure marker inside a core use-case. Thrown inside the
 * `updateWorkspace` mutate callback so an invalid operation never writes to
 * disk; the core function converts it back into a typed `{ ok: false }`
 * outcome for callers.
 */
class CoreFlowError extends Error {}

export type AliasOutcome = { ok: true; message: string } | { ok: false; message: string };

export async function setWorkspaceAlias(
  root: string,
  alias: string,
  ref: string,
  env?: EnvLike,
): Promise<AliasOutcome> {
  try {
    const { result } = await updateWorkspace(
      root,
      (config) => {
        const res = setAlias(config, alias, ref);
        if (!res.ok) throw new CoreFlowError(res.message);
        return { config: res.config, result: res.message };
      },
      env,
    );
    return { ok: true, message: result };
  } catch (error) {
    if (error instanceof CoreFlowError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function removeWorkspaceAlias(
  root: string,
  alias: string,
  env?: EnvLike,
): Promise<AliasOutcome> {
  try {
    const { result } = await updateWorkspace(
      root,
      (config) => {
        const res = removeAlias(config, alias);
        if (!res.ok) throw new CoreFlowError(res.message);
        return { config: res.config, result: res.message };
      },
      env,
    );
    return { ok: true, message: result };
  } catch (error) {
    if (error instanceof CoreFlowError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function listWorkspaceAliases(root: string) {
  const config = await loadWorkspace(root);
  return listAliases(config);
}

import type { EnvLike } from "../services/config.ts";
import {
  deleteProfile,
  listPinned,
  listProfiles,
  pinRepo,
  saveProfile,
  togglePinRepo,
  unpinRepo,
} from "../services/profiles.ts";
import { loadWorkspace, updateWorkspace } from "../services/workspace.ts";

class CoreProfileError extends Error {}

export type ProfileOutcome =
  | { ok: true; message: string; pinned?: boolean }
  | { ok: false; message: string };

export async function pinWorkspaceRepo(
  root: string,
  ref: string,
  env?: EnvLike,
): Promise<ProfileOutcome> {
  try {
    const { result } = await updateWorkspace(
      root,
      (config) => {
        const res = pinRepo(config, ref);
        if (!res.ok) throw new CoreProfileError(res.message);
        return { config: res.config, result: res };
      },
      env,
    );
    return { ok: true, message: result.message, pinned: result.pinned };
  } catch (error) {
    if (error instanceof CoreProfileError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function unpinWorkspaceRepo(
  root: string,
  ref: string,
  env?: EnvLike,
): Promise<ProfileOutcome> {
  try {
    const { result } = await updateWorkspace(
      root,
      (config) => {
        const res = unpinRepo(config, ref);
        if (!res.ok) throw new CoreProfileError(res.message);
        return { config: res.config, result: res };
      },
      env,
    );
    return { ok: true, message: result.message, pinned: result.pinned };
  } catch (error) {
    if (error instanceof CoreProfileError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function toggleWorkspacePin(
  root: string,
  ref: string,
  env?: EnvLike,
): Promise<ProfileOutcome> {
  try {
    const { result } = await updateWorkspace(
      root,
      (config) => {
        const res = togglePinRepo(config, ref);
        if (!res.ok) throw new CoreProfileError(res.message);
        return { config: res.config, result: res };
      },
      env,
    );
    return { ok: true, message: result.message, pinned: result.pinned };
  } catch (error) {
    if (error instanceof CoreProfileError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function saveWorkspaceProfile(
  root: string,
  name: string,
  refs: readonly string[],
  env?: EnvLike,
): Promise<ProfileOutcome> {
  try {
    const { result } = await updateWorkspace(
      root,
      (config) => {
        const res = saveProfile(config, name, refs);
        if (!res.ok) throw new CoreProfileError(res.message);
        return { config: res.config, result: res.message };
      },
      env,
    );
    return { ok: true, message: result };
  } catch (error) {
    if (error instanceof CoreProfileError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function deleteWorkspaceProfile(
  root: string,
  name: string,
  env?: EnvLike,
): Promise<ProfileOutcome> {
  try {
    const { result } = await updateWorkspace(
      root,
      (config) => {
        const res = deleteProfile(config, name);
        if (!res.ok) throw new CoreProfileError(res.message);
        return { config: res.config, result: res.message };
      },
      env,
    );
    return { ok: true, message: result };
  } catch (error) {
    if (error instanceof CoreProfileError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function getWorkspaceProfilesAndPinned(root: string, env?: EnvLike) {
  const config = await loadWorkspace(root, undefined, env);
  return {
    pinned: listPinned(config),
    profiles: listProfiles(config),
  };
}

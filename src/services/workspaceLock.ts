import { open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { appConfigDir, CONFIG_FILENAME, type EnvLike } from "./config.ts";

export const LOCK_FILENAME = "repotruck.json.lock";
export const DEFAULT_STALE_LOCK_MS = 30_000;
export const DEFAULT_LOCK_WAIT_MS = 10_000;
export const DEFAULT_LOCK_RETRY_MS = 200;

export interface WorkspaceLockDeps {
  env?: EnvLike;
  /**
   * Which store file to serialize on, as a filename (default: the central
   * `repotruck.json`). Locks are keyed per store file, NOT per workspace
   * root: every workspace lives in the same store file, so two processes
   * writing different workspaces must still serialize here or their
   * read-modify-write cycles would drop each other's updates. Distinct
   * store files (e.g. per REPOTRUCK_CONFIG_DIR) never contend.
   */
  lockName?: string;
  staleLockMs?: number;
  waitMs?: number;
  retryMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface HeldLock {
  depth: number;
}

const heldLocks = new Map<string, HeldLock>();

function lockFileName(lockName?: string): string {
  return `${lockName ?? CONFIG_FILENAME}.lock`;
}

export function workspaceLockPath(deps: WorkspaceLockDeps = {}): string {
  const env = deps.env ?? process.env;
  const dir = appConfigDir(env);
  return path.join(dir, lockFileName(deps.lockName));
}

async function tryAcquire(
  lockPath: string,
  now: () => number,
  staleLockMs: number,
): Promise<boolean> {
  try {
    const handle = await open(lockPath, "wx");
    await handle.write(`${process.pid} ${new Date(now()).toISOString()}`);
    await handle.close();
    return true;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code !== "EEXIST") throw error;
    let ageMs: number;
    try {
      const info = await stat(lockPath);
      ageMs = now() - info.mtimeMs;
    } catch {
      return false;
    }
    if (ageMs > staleLockMs) {
      try {
        await unlink(lockPath);
      } catch {
        /* someone else removed it first — retry normally */
      }
      return false;
    }
    return false;
  }
}

export async function withWorkspaceLock<T>(
  fn: () => Promise<T>,
  deps: WorkspaceLockDeps = {},
): Promise<T> {
  const lockPath = workspaceLockPath(deps);
  const now = deps.now ?? (() => Date.now());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const staleLockMs = deps.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  const waitMs = deps.waitMs ?? DEFAULT_LOCK_WAIT_MS;
  const retryMs = deps.retryMs ?? DEFAULT_LOCK_RETRY_MS;

  const held = heldLocks.get(lockPath);
  if (held !== undefined) {
    held.depth += 1;
    try {
      return await fn();
    } finally {
      held.depth -= 1;
    }
  }

  const deadline = now() + waitMs;
  for (;;) {
    if (await tryAcquire(lockPath, now, staleLockMs)) break;
    if (now() >= deadline) {
      let ageSeconds = 0;
      try {
        const info = await stat(lockPath);
        ageSeconds = Math.max(0, Math.round((now() - info.mtimeMs) / 1000));
      } catch {
        /* lock vanished — race, fall through to the error with age 0 */
      }
      throw new Error(
        `another repotruck process holds ${lockPath} (held for ${ageSeconds}s) — close it or delete the file and retry`,
      );
    }
    await sleep(Math.min(retryMs, Math.max(1, deadline - now())));
  }

  heldLocks.set(lockPath, { depth: 1 });
  try {
    return await fn();
  } finally {
    const current = heldLocks.get(lockPath);
    if (current !== undefined) {
      current.depth -= 1;
      if (current.depth <= 0) {
        heldLocks.delete(lockPath);
        try {
          await unlink(lockPath);
        } catch {
          /* already removed — stale takeover by another process is accepted */
        }
      }
    }
  }
}

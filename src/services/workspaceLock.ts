import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink, utimes } from "node:fs/promises";
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
  heartbeatMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const reentrancyStorage = new AsyncLocalStorage<Set<string>>();
const mutexQueues = new Map<string, Promise<void>>();

function defaultNow(): number {
  return Date.now();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockFileName(lockName?: string): string {
  return `${lockName ?? CONFIG_FILENAME}.lock`;
}

export function workspaceLockPath(deps: WorkspaceLockDeps = {}): string {
  const env = deps.env ?? process.env;
  const dir = appConfigDir(env);
  return path.join(dir, lockFileName(deps.lockName));
}

async function acquireMutex(lockPath: string): Promise<() => void> {
  const current = mutexQueues.get(lockPath) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  mutexQueues.set(lockPath, next);

  await current;

  return () => {
    release();
    if (mutexQueues.get(lockPath) === next) {
      mutexQueues.delete(lockPath);
    }
  };
}

async function tryAcquire(
  lockPath: string,
  token: string,
  now: () => number,
  staleLockMs: number,
): Promise<boolean> {
  try {
    await mkdir(path.dirname(lockPath), { recursive: true });
    const handle = await open(lockPath, "wx");
    await handle.write(token);
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
        /* someone else removed it first - retry normally */
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
  const heldSet = reentrancyStorage.getStore();
  if (heldSet?.has(lockPath)) {
    return await fn();
  }

  const releaseMutex = await acquireMutex(lockPath);
  try {
    const now = deps.now ?? defaultNow;
    const sleep = deps.sleep ?? defaultSleep;
    const staleLockMs = deps.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
    const waitMs = deps.waitMs ?? DEFAULT_LOCK_WAIT_MS;
    const retryMs = deps.retryMs ?? DEFAULT_LOCK_RETRY_MS;
    const heartbeatIntervalMs = deps.heartbeatMs ?? Math.max(1, Math.floor(staleLockMs / 3));

    const token = `${process.pid} ${randomUUID()} ${new Date(now()).toISOString()}`;
    const deadline = now() + waitMs;

    for (;;) {
      if (await tryAcquire(lockPath, token, now, staleLockMs)) break;
      if (now() >= deadline) {
        let ageSeconds = 0;
        try {
          const info = await stat(lockPath);
          ageSeconds = Math.max(0, Math.round((now() - info.mtimeMs) / 1000));
        } catch {
          /* lock vanished - race, fall through to the error with age 0 */
        }
        throw new Error(
          `another repotruck process holds ${lockPath} (held for ${ageSeconds}s) - close it or delete the file and retry`,
        );
      }
      await sleep(Math.min(retryMs, Math.max(1, deadline - now())));
    }

    let heartbeatTimer: NodeJS.Timeout | null = setInterval(async () => {
      try {
        const content = await readFile(lockPath, "utf8");
        if (content === token) {
          const currentDate = new Date(now());
          await utimes(lockPath, currentDate, currentDate);
        } else {
          // Token mismatch: someone took over the lock file
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      } catch {
        // Transient error reading/touching file: do not cancel heartbeat permanently
      }
    }, heartbeatIntervalMs);
    if (typeof heartbeatTimer.unref === "function") {
      heartbeatTimer.unref();
    }

    const nextHeld = new Set(heldSet);
    nextHeld.add(lockPath);

    try {
      return await reentrancyStorage.run(nextHeld, async () => {
        return await fn();
      });
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      try {
        const content = await readFile(lockPath, "utf8");
        if (content === token) {
          await unlink(lockPath);
        }
      } catch {
        /* already removed */
      }
    }
  } finally {
    releaseMutex();
  }
}

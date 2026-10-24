import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EnvLike } from "../src/services/config.ts";
import {
  DEFAULT_STALE_LOCK_MS,
  LOCK_FILENAME,
  withWorkspaceLock,
  workspaceLockPath,
} from "../src/services/workspaceLock.ts";

const tempDirs: string[] = [];

function tempConfigDir(prefix: string): { dir: string; env: EnvLike } {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return { dir, env: { REPOTRUCK_CONFIG_DIR: dir } };
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("withWorkspaceLock", () => {
  test("acquires, runs, and releases the lock file", async () => {
    const { env } = tempConfigDir("rt-lock-basic-");
    let ran = false;
    await withWorkspaceLock(
      async () => {
        ran = true;
        expect(existsSync(workspaceLockPath({ env }))).toBe(true);
      },
      { env },
    );
    expect(ran).toBe(true);
    expect(existsSync(workspaceLockPath({ env }))).toBe(false);
  });

  test("is re-entrant within the same process", async () => {
    const { env } = tempConfigDir("rt-lock-reentrant-");
    let innerRan = false;
    await withWorkspaceLock(
      async () => {
        await withWorkspaceLock(
          async () => {
            innerRan = true;
          },
          { env },
        );
        expect(existsSync(workspaceLockPath({ env }))).toBe(true);
      },
      { env },
    );
    expect(innerRan).toBe(true);
    expect(existsSync(workspaceLockPath({ env }))).toBe(false);
  });

  test("takes over a stale lock older than staleLockMs", async () => {
    const { env } = tempConfigDir("rt-lock-stale-");
    const lockPath = workspaceLockPath({ env });
    writeFileSync(lockPath, "1234 2026-01-01T00:00:00.000Z", "utf8");
    const longAgo = Date.now() - 60_000;
    utimesSync(lockPath, new Date(longAgo), new Date(longAgo));
    let ran = false;
    await withWorkspaceLock(
      async () => {
        ran = true;
      },
      { env, staleLockMs: 30_000 },
    );
    expect(ran).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  test("fails with a single-line error when a fresh lock is held past the wait budget", async () => {
    const { env } = tempConfigDir("rt-lock-held-");
    const lockPath = workspaceLockPath({ env });
    writeFileSync(lockPath, "9999 fresh", "utf8");
    const fresh = Date.now() - 1000;
    utimesSync(lockPath, new Date(fresh), new Date(fresh));
    const original = readFileSync(lockPath, "utf8");
    let message = "";
    try {
      await withWorkspaceLock(
        async () => {
          expect.unreachable();
        },
        { env, waitMs: 50, retryMs: 10 },
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("another repotruck process holds");
    expect(message).toContain(LOCK_FILENAME);
    expect(message.split("\n").length).toBe(1);
    expect(readFileSync(lockPath, "utf8")).toBe(original);
  });
});

describe("per-store-file lock keying", () => {
  test("different lockNames use different lock files and never contend", async () => {
    const { env } = tempConfigDir("rt-lock-keyed-");
    // Hold the default store lock from "another process" by creating the file.
    const defaultLock = workspaceLockPath({ env });
    writeFileSync(defaultLock, "999999 2026-01-01T00:00:00.000Z", "utf8");
    try {
      // A different store file must acquire instantly despite the held default.
      const started = Date.now();
      await withWorkspaceLock(async () => "ok", {
        env,
        lockName: "other-store.json",
        staleLockMs: DEFAULT_STALE_LOCK_MS,
        waitMs: 50,
      }).then((value) => expect(value).toBe("ok"));
      expect(Date.now() - started).toBeLessThan(2000);
      // The default lock path is unchanged (back-compat for docs and errors).
      expect(defaultLock.endsWith("repotruck.json.lock")).toBe(true);
      // The other lock file was created next to it and cleaned up afterwards.
      expect(existsSync(path.join(path.dirname(defaultLock), "other-store.json.lock"))).toBe(false);
    } finally {
      rmSync(defaultLock, { force: true });
    }
  });
});

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

  test("20 concurrent withWorkspaceLock in the same process serialize with peak concurrency 1 (C8)", async () => {
    const { env } = tempConfigDir("rt-lock-c8-");
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 20 }, async (_, index) => {
      await withWorkspaceLock(
        async () => {
          active += 1;
          if (active > maxActive) maxActive = active;
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return index;
        },
        { env, waitMs: 5000, retryMs: 10 },
      );
    });
    await Promise.all(tasks);
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
    expect(existsSync(workspaceLockPath({ env }))).toBe(false);
  });

  test("different async execution contexts are not treated as reentrant (C10)", async () => {
    const { env } = tempConfigDir("rt-lock-c10-");
    const executionOrder: string[] = [];
    const p1 = withWorkspaceLock(
      async () => {
        executionOrder.push("p1-start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        executionOrder.push("p1-end");
      },
      { env, waitMs: 5000, retryMs: 10 },
    );
    const p2 = withWorkspaceLock(
      async () => {
        executionOrder.push("p2-start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        executionOrder.push("p2-end");
      },
      { env, waitMs: 5000, retryMs: 10 },
    );
    await Promise.all([p1, p2]);
    expect(executionOrder).toEqual(["p1-start", "p1-end", "p2-start", "p2-end"]);
  });

  test("lock file with a different ownership token is not deleted on release (C11)", async () => {
    const { env } = tempConfigDir("rt-lock-c11-");
    const lockPath = workspaceLockPath({ env });
    await withWorkspaceLock(
      async () => {
        expect(existsSync(lockPath)).toBe(true);
        writeFileSync(lockPath, "another-pid another-uuid 2026-01-01T00:00:00.000Z", "utf8");
      },
      { env },
    );
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf8")).toBe(
      "another-pid another-uuid 2026-01-01T00:00:00.000Z",
    );
  });

  test("heartbeat stops if file token is modified or file deleted during hold", async () => {
    const { env } = tempConfigDir("rt-lock-hb-stop-");
    const lockPath = workspaceLockPath({ env });
    await withWorkspaceLock(
      async () => {
        writeFileSync(lockPath, "different-token", "utf8");
        await new Promise((resolve) => setTimeout(resolve, 60));
        rmSync(lockPath, { force: true });
        await new Promise((resolve) => setTimeout(resolve, 60));
      },
      { env, heartbeatMs: 20 },
    );
  });

  test("heartbeat prevents second process from taking over lock held longer than staleLockMs (C12)", async () => {
    const { env } = tempConfigDir("rt-lock-c12-");
    let childExitCode = -1;
    let childStderr = "";

    await withWorkspaceLock(
      async () => {
        const childScript = `
          import { withWorkspaceLock } from "./src/services/workspaceLock.ts";
          try {
            await withWorkspaceLock(async () => {
              process.exit(0);
            }, { env: { REPOTRUCK_CONFIG_DIR: ${JSON.stringify(env.REPOTRUCK_CONFIG_DIR)} }, waitMs: 250, retryMs: 20, staleLockMs: 300 });
          } catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
            process.exit(1);
          }
        `;
        await new Promise((resolve) => setTimeout(resolve, 350));
        const proc = Bun.spawn(["bun", "-e", childScript], {
          cwd: process.cwd(),
          stderr: "pipe",
        });
        childStderr = await new Response(proc.stderr).text();
        childExitCode = await proc.exited;
      },
      { env, staleLockMs: 300, heartbeatMs: 50 },
    );

    expect(childExitCode).toBe(1);
    expect(childStderr).toContain("another repotruck process holds");

    let acquiredAfterRelease = false;
    await withWorkspaceLock(
      async () => {
        acquiredAfterRelease = true;
      },
      { env, waitMs: 500, staleLockMs: 300 },
    );
    expect(acquiredAfterRelease).toBe(true);
  });
});

describe("per-store-file lock keying", () => {
  test("different lockNames use different lock files and never contend", async () => {
    const { env } = tempConfigDir("rt-lock-keyed-");
    const defaultLock = workspaceLockPath({ env });
    writeFileSync(defaultLock, "999999 2026-01-01T00:00:00.000Z", "utf8");
    try {
      const started = Date.now();
      await withWorkspaceLock(async () => "ok", {
        env,
        lockName: "other-store.json",
        staleLockMs: DEFAULT_STALE_LOCK_MS,
        waitMs: 50,
      }).then((value) => expect(value).toBe("ok"));
      expect(Date.now() - started).toBeLessThan(2000);
      expect(defaultLock.endsWith("repotruck.json.lock")).toBe(true);
      expect(existsSync(path.join(path.dirname(defaultLock), "other-store.json.lock"))).toBe(false);
    } finally {
      rmSync(defaultLock, { force: true });
    }
  });
});

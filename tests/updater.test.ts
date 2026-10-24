import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkForUpdate,
  defaultUpdateState,
  fetchLatestVersion,
  performSelfUpdate,
  readUpdateState,
  shouldCheckForUpdate,
  UPDATE_STATE_FILENAME,
  type UpdateState,
  updateStatePath,
  writeUpdateState,
} from "../src/services/updater.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sweepTempRoots(roots: string[]): string[] {
  const pending: string[] = [];
  for (const dir of roots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      pending.push(dir);
    }
  }
  return pending;
}

const pendingTempDirs: string[] = [];

afterEach(() => {
  pendingTempDirs.push(...sweepTempRoots(tempRoots));
});

afterAll(() => {
  pendingTempDirs.push(...sweepTempRoots(pendingTempDirs));
  pendingTempDirs.push(...sweepTempRoots(tempRoots));
  for (const dir of pendingTempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* best-effort */
    }
  }
});

function tempEnv(): { dir: string; env: Record<string, string> } {
  const dir = mkdtempSync(path.join(tmpdir(), "repotruck-updater-"));
  tempRoots.push(dir);
  return { dir, env: { REPOTRUCK_CONFIG_DIR: dir } };
}

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function fetchFailing(): typeof fetch {
  return (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
}

describe("fetchLatestVersion", () => {
  test("parses the version from the registry payload", async () => {
    const version = await fetchLatestVersion({
      fetchImpl: fetchReturning({ version: "9.9.9" }),
    });
    expect(version).toBe("9.9.9");
  });

  test("404 and other non-OK statuses return null", async () => {
    expect(await fetchLatestVersion({ fetchImpl: fetchReturning({}, 404) })).toBeNull();
    expect(await fetchLatestVersion({ fetchImpl: fetchReturning({}, 500) })).toBeNull();
  });

  test("network errors return null and never throw", async () => {
    expect(await fetchLatestVersion({ fetchImpl: fetchFailing() })).toBeNull();
  });

  test("timeouts return null", async () => {
    const hanging = ((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    expect(await fetchLatestVersion({ fetchImpl: hanging, timeoutMs: 20 })).toBeNull();
  });

  test("payload without a version string returns null", async () => {
    expect(await fetchLatestVersion({ fetchImpl: fetchReturning({ version: 3 }) })).toBeNull();
    expect(await fetchLatestVersion({ fetchImpl: fetchReturning(null) })).toBeNull();
  });
});

describe("shouldCheckForUpdate", () => {
  const now = Date.parse("2026-10-23T12:00:00.000Z");

  test("null lastCheck always checks", () => {
    expect(shouldCheckForUpdate(defaultUpdateState(), now)).toBe(true);
  });

  test("a check less than 24h ago is throttled", () => {
    const state: UpdateState = {
      lastCheck: "2026-10-23T00:00:00.000Z",
      latestVersion: "0.1.0",
      dismissedVersion: null,
    };
    expect(shouldCheckForUpdate(state, now)).toBe(false);
  });

  test("a check older than 24h runs again", () => {
    const state: UpdateState = {
      lastCheck: "2026-10-21T00:00:00.000Z",
      latestVersion: "0.1.0",
      dismissedVersion: null,
    };
    expect(shouldCheckForUpdate(state, now)).toBe(true);
  });

  test("an unparseable lastCheck runs again", () => {
    const state: UpdateState = {
      lastCheck: "not a date",
      latestVersion: null,
      dismissedVersion: null,
    };
    expect(shouldCheckForUpdate(state, now)).toBe(true);
  });
});

describe("checkForUpdate", () => {
  test("writes update.json with lastCheck and latestVersion", async () => {
    const { dir, env } = tempEnv();
    const result = await checkForUpdate(env, {
      fetchImpl: fetchReturning({ version: "9.9.9" }),
      now: () => "2026-10-23T12:00:00.000Z",
    });
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("9.9.9");
    const raw = JSON.parse(
      readFileSync(path.join(dir, UPDATE_STATE_FILENAME), "utf8"),
    ) as UpdateState;
    expect(raw.lastCheck).toBe("2026-10-23T12:00:00.000Z");
    expect(raw.latestVersion).toBe("9.9.9");
  });

  test("unpublished package (404) is a silent no-update", async () => {
    const { env } = tempEnv();
    const result = await checkForUpdate(env, {
      fetchImpl: fetchReturning({}, 404),
    });
    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBeNull();
  });

  test("REPOTRUCK_NO_UPDATE_CHECK short-circuits: no fetch, no state write", async () => {
    const { dir, env } = tempEnv();
    const fetchSpy = fetchReturning({ version: "9.9.9" });
    const result = await checkForUpdate(
      { ...env, REPOTRUCK_NO_UPDATE_CHECK: "1" },
      { fetchImpl: fetchSpy, force: true },
    );
    expect(result.updateAvailable).toBe(false);
    expect(result.disabled).toBe(true);
    expect(existsSync(path.join(dir, UPDATE_STATE_FILENAME))).toBe(false);
  });

  test("throttle: a fresh cached check reuses state without fetching", async () => {
    const { env } = tempEnv();
    let fetchCount = 0;
    const counting = ((_url: unknown, _init?: unknown) => {
      fetchCount += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ version: "9.9.9" }),
      });
    }) as unknown as typeof fetch;
    await checkForUpdate(env, { fetchImpl: counting });
    const state: UpdateState = {
      lastCheck: new Date().toISOString(),
      latestVersion: "0.2.0",
      dismissedVersion: null,
    };
    writeFileSync(updateStatePath(env), JSON.stringify(state), "utf8");
    const second = await checkForUpdate(env, { fetchImpl: counting });
    expect(fetchCount).toBe(1);
    expect(second.fromCache).toBe(true);
    expect(second.latestVersion).toBe("0.2.0");
    expect(second.updateAvailable).toBe(true);
  });

  test("force bypasses the throttle", async () => {
    const { env } = tempEnv();
    const state: UpdateState = {
      lastCheck: new Date().toISOString(),
      latestVersion: "0.2.0",
      dismissedVersion: null,
    };
    writeFileSync(updateStatePath(env), JSON.stringify(state), "utf8");
    let fetchCount = 0;
    const counting = ((_url: unknown, _init?: unknown) => {
      fetchCount += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ version: "9.9.9" }),
      });
    }) as unknown as typeof fetch;
    await checkForUpdate(env, { fetchImpl: counting, force: true });
    expect(fetchCount).toBe(1);
  });

  test("registry failure keeps the check silent and never throws", async () => {
    const { env } = tempEnv();
    const result = await checkForUpdate(env, { fetchImpl: fetchFailing() });
    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBeNull();
  });
});

describe("update state round-trip", () => {
  test("write then read returns the same state", async () => {
    const { env } = tempEnv();
    const state: UpdateState = {
      lastCheck: "2026-10-23T00:00:00.000Z",
      latestVersion: "1.2.3",
      dismissedVersion: "1.1.0",
    };
    await writeUpdateState(env, state);
    expect(await readUpdateState(env)).toEqual(state);
  });

  test("missing or corrupt state reads as the default", async () => {
    const { dir, env } = tempEnv();
    expect(await readUpdateState(env)).toEqual(defaultUpdateState());
    writeFileSync(path.join(dir, UPDATE_STATE_FILENAME), "{nope", "utf8");
    expect(await readUpdateState(env)).toEqual(defaultUpdateState());
  });
});

describe("performSelfUpdate", () => {
  test("source checkout reports the notice and never executes npm", async () => {
    let calls = 0;
    const result = await performSelfUpdate({
      execImpl: async () => {
        calls += 1;
      },
      entryPath: "C:\\repo\\repotruck\\src\\cli.ts",
    });
    expect(result.updated).toBe(false);
    expect(result.message).toContain("running from source");
    expect(calls).toBe(0);
  });

  test("global npm install runs npm i -g repotruck@latest", async () => {
    const seen: Array<{ command: string; args: string[] }> = [];
    const result = await performSelfUpdate({
      execImpl: async (command, args) => {
        seen.push({ command, args });
      },
      entryPath: "C:\\Users\\samet\\AppData\\Roaming\\npm\\node_modules\\repotruck\\dist\\cli.js",
    });
    expect(result.updated).toBe(true);
    expect(seen).toEqual([{ command: "npm", args: ["i", "-g", "repotruck@latest"] }]);
  });

  test("whichImpl matching entryPath triggers global update", async () => {
    const seen: Array<{ command: string; args: string[] }> = [];
    const binaryPath = "/custom/bin/repotruck";
    const result = await performSelfUpdate({
      execImpl: async (command, args) => {
        seen.push({ command, args });
      },
      entryPath: binaryPath,
      whichImpl: async () => binaryPath,
      realpathImpl: async (p) => p,
    });
    expect(result.updated).toBe(true);
    expect(seen).toEqual([{ command: "npm", args: ["i", "-g", "repotruck@latest"] }]);
  });

  test("npx cache path gets per-method guidance", async () => {
    let calls = 0;
    const result = await performSelfUpdate({
      execImpl: async () => {
        calls += 1;
      },
      entryPath:
        "C:\\Users\\samet\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\repotruck\\dist\\cli.js",
    });
    expect(result.updated).toBe(false);
    expect(result.message).toContain("npx repotruck@latest");
    expect(calls).toBe(0);
  });

  test("non-global node_modules gets reinstall guidance", async () => {
    let calls = 0;
    const result = await performSelfUpdate({
      execImpl: async () => {
        calls += 1;
      },
      entryPath: "C:\\proj\\node_modules\\repotruck\\dist\\cli.js",
    });
    expect(result.updated).toBe(false);
    expect(result.message).toContain("npm i -g repotruck");
    expect(calls).toBe(0);
  });

  test("npm failure surfaces the first error line without throwing", async () => {
    const result = await performSelfUpdate({
      execImpl: async () => {
        throw new Error("npm ERR! network\nmore lines");
      },
      entryPath: "/usr/local/lib/node_modules/repotruck/dist/cli.js",
    });
    expect(result.updated).toBe(false);
    expect(result.message).toBe("npm ERR! network");
  });
});

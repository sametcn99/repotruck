import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cachedLoginExists, logout } from "../src/services/auth.ts";
import { appConfigDir, CONFIG_FILENAME } from "../src/services/config.ts";
import {
  effectiveRoot,
  homeDirFrom,
  osDefaultRoot,
  readSettings,
  resolveRootForSession,
  resolveSyncSettings,
  SETTINGS_FILENAME,
  settingsPath,
  validateRootInput,
  writeSettings,
} from "../src/services/settings.ts";
import { listWorkspaces } from "../src/services/workspaceRegistry.ts";

const tempRoots: string[] = [];
const pendingTempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = (realpathSync.native ?? realpathSync)(mkdtempSync(path.join(tmpdir(), prefix)));
  tempRoots.push(dir);
  return dir;
}

function sweep(roots: string[]): string[] {
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

afterEach(() => {
  pendingTempDirs.push(...sweep(tempRoots));
});

afterAll(() => {
  pendingTempDirs.push(...sweep(pendingTempDirs));
  for (const dir of pendingTempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* best-effort: the OS releases these locks moments later */
    }
  }
});

describe("osDefaultRoot", () => {
  test("windows uses USERPROFILE", () => {
    expect(osDefaultRoot({ USERPROFILE: "C:\\Users\\x" }, "win32")).toBe(
      path.win32.join("C:\\Users\\x", "repotruck"),
    );
  });

  test("macos and linux use HOME", () => {
    expect(osDefaultRoot({ HOME: "/Users/x" }, "darwin")).toBe("/Users/x/repotruck");
    expect(osDefaultRoot({ HOME: "/home/x" }, "linux")).toBe("/home/x/repotruck");
  });

  test("windows ignores HOME and prefers USERPROFILE", () => {
    expect(osDefaultRoot({ HOME: "/home/other", USERPROFILE: "C:\\Users\\x" }, "win32")).toBe(
      path.win32.join("C:\\Users\\x", "repotruck"),
    );
  });

  test("falls back to the injected homedir when the env is empty", () => {
    expect(osDefaultRoot({}, "linux", () => "/hd")).toBe("/hd/repotruck");
  });

  test("last resort is an explicit error when the homedir fallback throws (spec: no cwd fallback)", () => {
    expect(() =>
      homeDirFrom({}, "linux", () => {
        throw new Error("no home");
      }),
    ).toThrow("could not determine home directory");
    expect(() =>
      osDefaultRoot({}, "linux", () => {
        throw new Error("no home");
      }),
    ).toThrow("could not determine home directory");
  });

  test("an empty homedir fallback also raises the explicit error", () => {
    expect(() => homeDirFrom({}, "darwin", () => "")).toThrow(
      "could not determine home directory: set HOME or USERPROFILE",
    );
  });

  test("validateRootInput propagates the home directory error for ~ paths", () => {
    expect(() =>
      validateRootInput("~/repotruck", {}, "linux", () => {
        throw new Error("no home");
      }),
    ).toThrow("could not determine home directory");
  });

  test("homeDirFrom mirrors the same selection", () => {
    expect(homeDirFrom({ USERPROFILE: "C:\\u" }, "win32")).toBe("C:\\u");
    expect(homeDirFrom({ HOME: "/h" }, "linux")).toBe("/h");
    expect(homeDirFrom({}, "darwin", () => "/fallback")).toBe("/fallback");
  });
});

describe("settings read and write", () => {
  test("keeps the existing global preference and migrates workspace records and login beside it", async () => {
    const home = tempDir("rt-layout-home-");
    const env = {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, "legacy-xdg"),
      APPDATA: path.join(home, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(home, "AppData", "Local"),
    };
    const dataDir = appConfigDir(env);
    const legacyDir =
      process.platform === "win32"
        ? path.join(env.APPDATA, "repotruck")
        : process.platform === "darwin"
          ? dataDir
          : path.join(env.XDG_CONFIG_HOME, "repotruck");
    const splitDir = path.join(home, ".repotruck");
    const root = tempDir("rt-layout-workspace-");
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(splitDir, { recursive: true });
    writeFileSync(
      path.join(splitDir, "config.json"),
      JSON.stringify({ defaultRoot: root, theme: "contrast" }),
    );
    writeFileSync(path.join(legacyDir, "settings.json"), JSON.stringify({ theme: "light" }));
    const inventory = JSON.stringify({
      version: 1,
      workspaces: [
        { version: 1, root, preset: "flat", lastSync: null, lastUsed: "2026-11-20", repos: [] },
      ],
    });
    writeFileSync(path.join(legacyDir, CONFIG_FILENAME), inventory);
    writeFileSync(
      path.join(legacyDir, "auth.json"),
      JSON.stringify({ token: "synthetic-fixture" }),
    );

    const [settings, workspaces, loggedIn] = await Promise.all([
      readSettings(env),
      listWorkspaces(env),
      cachedLoginExists(env),
    ]);
    expect(settings).toEqual({ defaultRoot: root, theme: "contrast" });
    expect(settingsPath(env)).toBe(path.join(dataDir, "config.json"));
    expect(readFileSync(path.join(dataDir, CONFIG_FILENAME), "utf8")).toBe(inventory);
    expect(workspaces[0]).toMatchObject({ path: root, preset: "flat" });
    expect(loggedIn).toBe(true);
    expect(await logout(env)).toBe(true);
    expect(await cachedLoginExists(env)).toBe(false);
    if (legacyDir !== dataDir) expect(existsSync(path.join(legacyDir, "auth.json"))).toBe(true);
  });

  test("migrates settings.json once into the user data directory", async () => {
    const home = tempDir("rt-settings-home-");
    const env = { HOME: home, USERPROFILE: home };
    const legacyDir = appConfigDir(env);
    mkdirSync(legacyDir, { recursive: true });
    const legacy = path.join(legacyDir, "settings.json");
    writeFileSync(legacy, JSON.stringify({ theme: "light", sync: { concurrency: 8 } }));

    expect(await readSettings(env)).toEqual({ theme: "light", sync: { concurrency: 8 } });
    expect(settingsPath(env)).toBe(path.join(legacyDir, "config.json"));
    expect(JSON.parse(readFileSync(settingsPath(env), "utf8")).theme).toBe("light");
    await writeSettings(env, { theme: "contrast" });
    expect(await readSettings(env)).toEqual({ theme: "contrast" });
    expect(JSON.parse(readFileSync(legacy, "utf8")).theme).toBe("light");
  });

  test("missing file reads as empty settings", async () => {
    const env = { REPOTRUCK_CONFIG_DIR: tempDir("rt-settings-missing-") };
    expect(await readSettings(env)).toEqual({});
  });

  test("write then read round-trips defaultRoot", async () => {
    const configDir = tempDir("rt-settings-roundtrip-");
    const env = { REPOTRUCK_CONFIG_DIR: configDir };
    await writeSettings(env, { defaultRoot: "C:\\tmp\\repos" });
    expect(await readSettings(env)).toEqual({ defaultRoot: "C:\\tmp\\repos" });
    const raw = JSON.parse(readFileSync(path.join(configDir, SETTINGS_FILENAME), "utf8")) as {
      defaultRoot?: string;
    };
    expect(raw.defaultRoot).toBe("C:\\tmp\\repos");
  });

  test("write creates a missing config directory", async () => {
    const parent = tempDir("rt-settings-mkdir-");
    const env = { REPOTRUCK_CONFIG_DIR: path.join(parent, "nested", "cfg") };
    await writeSettings(env, {});
    expect(readFileSync(path.join(env.REPOTRUCK_CONFIG_DIR!, SETTINGS_FILENAME), "utf8")).toBe(
      "{}\n",
    );
  });

  test("corrupt settings fall back to empty", async () => {
    const configDir = tempDir("rt-settings-corrupt-");
    writeFileSync(path.join(configDir, SETTINGS_FILENAME), "{ corrupt json ]", "utf8");
    expect(await readSettings({ REPOTRUCK_CONFIG_DIR: configDir })).toEqual({});
  });

  test("non-object settings fall back to empty", async () => {
    const configDir = tempDir("rt-settings-array-");
    writeFileSync(path.join(configDir, SETTINGS_FILENAME), "[1, 2]", "utf8");
    expect(await readSettings({ REPOTRUCK_CONFIG_DIR: configDir })).toEqual({});
  });

  test("unknown keys survive a read-modify-write", async () => {
    const configDir = tempDir("rt-settings-future-");
    writeFileSync(
      path.join(configDir, SETTINGS_FILENAME),
      JSON.stringify({ defaultRoot: "/a", futureKey: 42 }),
      "utf8",
    );
    const env = { REPOTRUCK_CONFIG_DIR: configDir };
    const settings = await readSettings(env);
    await writeSettings(env, { ...settings, defaultRoot: "/b" });
    const raw = JSON.parse(readFileSync(path.join(configDir, SETTINGS_FILENAME), "utf8")) as {
      defaultRoot?: string;
      futureKey?: number;
    };
    expect(raw.defaultRoot).toBe("/b");
    expect(raw.futureKey).toBe(42);
  });
});

describe("validateRootInput", () => {
  test("empty input is rejected with an example", () => {
    const result = validateRootInput("   ", { HOME: "/h" }, "linux");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("path is required");
      expect(result.error).toContain("~/repotruck");
    }
  });

  test("relative input is rejected with an absolute hint", () => {
    const result = validateRootInput("repos/sub", { HOME: "/h" }, "linux");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("absolute");
      expect(result.error).toContain("repos/sub");
    }
  });

  test("~ expands to the platform home", () => {
    const result = validateRootInput("~/repotruck", { HOME: "/home/x" }, "linux");
    expect(result).toEqual({ ok: true, root: path.posix.resolve("/home/x/repotruck") });
    const bare = validateRootInput("~", { HOME: "/home/x" }, "linux");
    expect(bare).toEqual({ ok: true, root: path.posix.resolve("/home/x") });
  });

  test("~ on windows expands from USERPROFILE", () => {
    const result = validateRootInput("~\\repos", { USERPROFILE: "C:\\Users\\x" }, "win32");
    expect(result).toEqual({ ok: true, root: path.win32.resolve("C:\\Users\\x\\repos") });
  });

  test("absolute paths pass through resolved", () => {
    const result = validateRootInput("C:\\Users\\x\\repos", {}, "win32");
    expect(result).toEqual({ ok: true, root: path.win32.resolve("C:\\Users\\x\\repos") });
  });

  test("input is trimmed before validation", () => {
    const result = validateRootInput("  ~/repos  ", { HOME: "/home/x" }, "linux");
    expect(result).toEqual({ ok: true, root: path.posix.resolve("/home/x/repos") });
  });
});

describe("effectiveRoot", () => {
  test("with no settings the OS default applies", async () => {
    const env = { HOME: "/home/x", REPOTRUCK_CONFIG_DIR: tempDir("rt-eff-none-") };
    const result = await effectiveRoot(env, "linux");
    expect(result).toEqual({ root: osDefaultRoot(env, "linux"), fromOverride: false });
  });

  test("a valid override wins over the OS default", async () => {
    const configDir = tempDir("rt-eff-override-");
    const env = { HOME: "/home/x", REPOTRUCK_CONFIG_DIR: configDir };
    await writeSettings(env, { defaultRoot: "/tmp/chosen-root" });
    const result = await effectiveRoot(env, "linux");
    expect(result).toEqual({
      root: path.posix.resolve("/tmp/chosen-root"),
      fromOverride: true,
    });
  });

  test("an invalid override falls back to the OS default", async () => {
    const configDir = tempDir("rt-eff-invalid-");
    const env = { HOME: "/home/x", REPOTRUCK_CONFIG_DIR: configDir };
    await writeSettings(env, { defaultRoot: "relative/path" });
    const result = await effectiveRoot(env, "linux");
    expect(result).toEqual({ root: osDefaultRoot(env, "linux"), fromOverride: false });
  });
});

describe("resolveSyncSettings (flag > settings > default)", () => {
  test("defaults: concurrency 3, no depth, no blobless, no stash, divergence fail", () => {
    expect(resolveSyncSettings({})).toEqual({
      concurrency: 3,
      depth: undefined,
      blobless: false,
      stash: false,
      divergence: "fail",
    });
  });

  test("settings values fill in when the CLI passes nothing", () => {
    expect(
      resolveSyncSettings({
        sync: { concurrency: 5, depth: 1, blobless: true, stash: true, divergence: "rebase" },
      }),
    ).toEqual({
      concurrency: 5,
      depth: 1,
      blobless: true,
      stash: true,
      divergence: "rebase",
    });
  });

  test("CLI overrides beat settings", () => {
    expect(
      resolveSyncSettings(
        { sync: { concurrency: 5, divergence: "rebase", blobless: true } },
        { concurrency: 7, divergence: "skip", blobless: false },
      ),
    ).toEqual({
      concurrency: 7,
      depth: undefined,
      blobless: false,
      stash: false,
      divergence: "skip",
    });
  });

  test("invalid settings values raise a single-line error", () => {
    let message = "";
    try {
      resolveSyncSettings({ sync: { concurrency: 0 } });
      expect.unreachable();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("sync.concurrency");
    expect(message.split("\n").length).toBe(1);
    expect(() => resolveSyncSettings({ sync: { depth: -1 } })).toThrow("sync.depth");
    expect(() =>
      resolveSyncSettings({ sync: { divergence: "bogus" as unknown as "rebase" } }),
    ).toThrow("sync.divergence");
  });
});

describe("resolveRootForSession", () => {
  test("returns the configured workspace", async () => {
    const configDir = tempDir("rt-session-cfg-");
    const env = { HOME: "/home/x", REPOTRUCK_CONFIG_DIR: configDir };
    await writeSettings(env, { defaultRoot: "/tmp/elsewhere" });
    expect(await resolveRootForSession(env, "linux")).toBe("/tmp/elsewhere");
  });

  test("outside any workspace the settings override applies", async () => {
    const configDir = tempDir("rt-session-cfg2-");
    const env = { HOME: "/home/x", REPOTRUCK_CONFIG_DIR: configDir };
    await writeSettings(env, { defaultRoot: "/tmp/chosen" });
    expect(await resolveRootForSession(env, "linux")).toBe(path.posix.resolve("/tmp/chosen"));
  });

  test("outside any workspace with no settings the OS default applies", async () => {
    const configDir = tempDir("rt-session-cfg3-");
    const env = { HOME: "/home/x", REPOTRUCK_CONFIG_DIR: configDir };
    expect(await resolveRootForSession(env, "linux")).toBe(osDefaultRoot(env, "linux"));
  });
});

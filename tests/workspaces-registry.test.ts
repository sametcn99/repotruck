import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
import { writeWorkspaceSnapshot } from "../src/services/backups.ts";
import {
  CONFIG_FILENAME,
  defaultConfig,
  type EnvLike,
  type RepotruckConfig,
} from "../src/services/config.ts";
import {
  LEGACY_WORKSPACES_FILENAME,
  listWorkspaces,
  readLegacyWorkspaceConfig,
  readWorkspaceConfig,
  readWorkspaceEntries,
  removeWorkspace,
  resolveWorkspaceRoot,
  restoreWorkspaceSnapshot,
  writeWorkspaceConfig,
} from "../src/services/workspaceRegistry.ts";

const tempRoots: string[] = [];
let configDir: string;
let env: EnvLike;

function tempDir(prefix: string): string {
  const dir = (realpathSync.native ?? realpathSync)(mkdtempSync(path.join(tmpdir(), prefix)));
  tempRoots.push(dir);
  return dir;
}

beforeAll(() => {
  configDir = tempDir("repotruck-registry-cfg-");
  env = { REPOTRUCK_CONFIG_DIR: configDir };
});

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function findByResolvedPath<T extends { path: string }>(listing: T[], root: string): T[] {
  const resolved = (realpathSync.native ?? realpathSync)(root);
  return listing.filter((record) => {
    if (record.path.toLowerCase() === resolved.toLowerCase()) return true;
    try {
      const nr = (realpathSync.native ?? realpathSync)(record.path);
      return nr.toLowerCase() === resolved.toLowerCase();
    } catch {
      return false;
    }
  });
}

describe("workspace registry", () => {
  test("write then list round-trips a record in the central repotruck.json", async () => {
    const root = tempDir("repotruck-ws-roundtrip-");
    await writeWorkspaceConfig(root, defaultConfig(root, "categorized"), env);
    expect(existsSync(path.join(configDir, CONFIG_FILENAME))).toBe(true);
    const listing = await listWorkspaces(env);
    const matches = findByResolvedPath(listing, root);
    expect(matches.length).toBe(1);
    expect(matches[0]!.preset).toBe("categorized");
    expect(matches[0]!.repoCount).toBe(0);
    expect(matches[0]!.lastSync).toBeNull();
    expect(matches[0]!.missing).toBe(false);
  });

  test("upsert dedupes by resolved path and updates fields", async () => {
    const root = tempDir("repotruck-ws-upsert-");
    mkdirSync(path.join(root, "sub"), { recursive: true });
    await writeWorkspaceConfig(root, defaultConfig(root, "flat-by-owner"), env);
    const aliased = path.join(root, "sub", "..");
    const updated: RepotruckConfig = {
      ...defaultConfig(root, "flat-by-owner"),
      lastSync: "2026-10-23T00:00:00.000Z",
      repos: [
        {
          owner: "acme",
          name: "api",
          relativePath: "acme/api",
          category: "source",
          internal: true,
          language: "Go",
          updatedAt: null,
        },
      ],
    };
    await writeWorkspaceConfig(aliased, updated, env);
    const listing = await listWorkspaces(env);
    const matches = findByResolvedPath(listing, root);
    expect(matches.length).toBe(1);
    expect(matches[0]!.repoCount).toBe(1);
    expect(matches[0]!.lastSync).toBe("2026-10-23T00:00:00.000Z");
  });

  test("readWorkspaceConfig returns the central entry for the resolved root", async () => {
    const root = tempDir("repotruck-ws-read-");
    const config: RepotruckConfig = {
      ...defaultConfig(root, "topic-focused"),
      repos: [
        {
          owner: "acme",
          name: "api",
          relativePath: "acme/api",
          category: "source",
          internal: true,
          language: "Go",
          updatedAt: null,
        },
      ],
    };
    await writeWorkspaceConfig(root, config, env);
    const loaded = await readWorkspaceConfig(path.join(root, "sub", ".."), env);
    expect(loaded).not.toBeNull();
    expect(loaded!.preset).toBe("topic-focused");
    expect(loaded!.repos.length).toBe(1);
  });

  test("listWorkspaces sorts by lastUsed descending", async () => {
    const older = tempDir("repotruck-ws-older-");
    const newer = tempDir("repotruck-ws-newer-");
    await writeWorkspaceConfig(older, defaultConfig(older, "categorized"), env);
    await writeWorkspaceConfig(newer, defaultConfig(newer, "categorized"), env);
    const storePath = path.join(configDir, CONFIG_FILENAME);
    const store = JSON.parse(readFileSync(storePath, "utf8")) as {
      workspaces: Array<{ root: string; lastUsed: string }>;
    };
    const olderResolved = (realpathSync.native ?? realpathSync)(older).toLowerCase();
    const newerResolved = (realpathSync.native ?? realpathSync)(newer).toLowerCase();
    for (const entry of store.workspaces) {
      let normalized = entry.root.toLowerCase();
      try {
        normalized = (realpathSync.native ?? realpathSync)(entry.root).toLowerCase();
      } catch {
        /* fallback */
      }
      if (normalized === olderResolved) entry.lastUsed = "2020-01-01T00:00:00.000Z";
      if (normalized === newerResolved) entry.lastUsed = "2030-01-01T00:00:00.000Z";
    }
    writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
    const listing = await listWorkspaces(env);
    expect(listing[0]!.path.toLowerCase()).toBe(newerResolved);
    expect(listing[listing.length - 1]!.path.toLowerCase()).toBe(olderResolved);
  });

  test("removeWorkspace deletes the record", async () => {
    const root = tempDir("repotruck-ws-remove-");
    await writeWorkspaceConfig(root, defaultConfig(root, "categorized"), env);
    expect(findByResolvedPath(await listWorkspaces(env), root).length).toBe(1);
    const removed = await removeWorkspace(root, env);
    expect(removed).not.toBeNull();
    expect(findByResolvedPath(await listWorkspaces(env), root).length).toBe(0);
  });

  test("removeWorkspace without a match returns null and never writes the store", async () => {
    const root = tempDir("repotruck-ws-remove-miss-");
    await writeWorkspaceConfig(root, defaultConfig(root, "categorized"), env);
    const storePath = path.join(configDir, CONFIG_FILENAME);
    const before = readFileSync(storePath, "utf8");
    const removed = await removeWorkspace(path.join(root, "definitely-not-registered"), env);
    expect(removed).toBeNull();
    expect(readFileSync(storePath, "utf8")).toBe(before);
  });

  test("nonexistent workspace paths are flagged missing", async () => {
    const root = tempDir("repotruck-ws-missing-");
    await writeWorkspaceConfig(root, defaultConfig(root, "categorized"), env);
    const resolved = realpathSync(root);
    rmSync(root, { recursive: true, force: true });
    const record = (await listWorkspaces(env)).find(
      (item) => item.path.toLowerCase() === resolved.toLowerCase(),
    );
    expect(record).toBeDefined();
    expect(record!.missing).toBe(true);
  });

  test("corrupt central store rejects with an explicit error and a .bak backup (spec: no silent reset)", async () => {
    const cleanDir = tempDir("repotruck-registry-corrupt-");
    const corruptEnv: EnvLike = { REPOTRUCK_CONFIG_DIR: cleanDir };
    const storePath = path.join(cleanDir, CONFIG_FILENAME);
    const corruptBytes = "{ corrupt json ]";
    writeFileSync(storePath, corruptBytes, "utf8");
    let message = "";
    try {
      await listWorkspaces(corruptEnv);
      expect.unreachable();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("repotruck.json is corrupt");
    expect(message).toContain(`${storePath}.bak`);
    expect(message.split("\n").length).toBe(1);
    expect(readFileSync(storePath, "utf8")).toBe(corruptBytes);
    expect(readFileSync(`${storePath}.bak`, "utf8")).toBe(corruptBytes);
  });

  test("a second read of a corrupt store does not clobber the first .bak backup", async () => {
    const cleanDir = tempDir("repotruck-registry-corrupt2-");
    const corruptEnv: EnvLike = { REPOTRUCK_CONFIG_DIR: cleanDir };
    const storePath = path.join(cleanDir, CONFIG_FILENAME);
    writeFileSync(storePath, "{ first ]", "utf8");
    await expect(listWorkspaces(corruptEnv)).rejects.toThrow("repotruck.json is corrupt");
    writeFileSync(`${storePath}.bak`, "FIRST BACKUP", "utf8");
    writeFileSync(storePath, "{ second ]", "utf8");
    await expect(listWorkspaces(corruptEnv)).rejects.toThrow("repotruck.json is corrupt");
    expect(readFileSync(`${storePath}.bak`, "utf8")).toBe("FIRST BACKUP");
  });

  test("an invalid envelope (version missing / wrong types) rejects the same way", async () => {
    const _cleanDir = tempDir("repotruck-registry-envelope-");
    const cases: readonly string[] = [
      JSON.stringify({ workspaces: [] }),
      JSON.stringify({ version: "one", workspaces: [] }),
      JSON.stringify({ version: 1, workspaces: "nope" }),
    ];
    for (const payload of cases) {
      const caseDir = tempDir("repotruck-registry-envelope-case-");
      const caseEnv: EnvLike = { REPOTRUCK_CONFIG_DIR: caseDir };
      writeFileSync(path.join(caseDir, CONFIG_FILENAME), payload, "utf8");
      await expect(listWorkspaces(caseEnv)).rejects.toThrow("repotruck.json is corrupt");
      expect(existsSync(path.join(caseDir, `${CONFIG_FILENAME}.bak`))).toBe(true);
    }
  });

  test("a store written by a newer repotruck rejects with the newer-version error", async () => {
    const cleanDir = tempDir("repotruck-registry-newer-");
    const newerEnv: EnvLike = { REPOTRUCK_CONFIG_DIR: cleanDir };
    const storePath = path.join(cleanDir, CONFIG_FILENAME);
    writeFileSync(storePath, JSON.stringify({ version: 2, workspaces: [] }), "utf8");
    let message = "";
    try {
      await listWorkspaces(newerEnv);
      expect.unreachable();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("written by a newer repotruck");
    expect(message).toContain("version 2");
    expect(message).toContain(`${storePath}.bak`);
    expect(message.split("\n").length).toBe(1);
  });

  test("a store read error other than ENOENT raises a typed error instead of a silent fallback", async () => {
    const cleanDir = tempDir("repotruck-registry-readerr-");
    const env: EnvLike = { REPOTRUCK_CONFIG_DIR: cleanDir };
    const storePath = path.join(cleanDir, CONFIG_FILENAME);
    const failingRead = (async () => {
      const error = new Error("insufficient permissions");
      Object.assign(error, { code: "EACCES" });
      throw error;
    }) as typeof import("node:fs/promises").readFile;
    let message = "";
    try {
      await readWorkspaceEntries(env, { readFile: failingRead });
      expect.unreachable();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(`could not read ${CONFIG_FILENAME}`);
    expect(message).toContain("insufficient permissions");
    expect(message.split("\n").length).toBe(1);
    expect(existsSync(`${storePath}.bak`)).toBe(false);
  });

  test("an ENOENT read still falls back to the legacy manifest", async () => {
    const cleanDir = tempDir("repotruck-registry-enoent-");
    const env: EnvLike = { REPOTRUCK_CONFIG_DIR: cleanDir };
    const enoentRead = (async () => {
      const error = new Error("no such file");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    }) as typeof import("node:fs/promises").readFile;
    const entries = await readWorkspaceEntries(env, { readFile: enoentRead });
    expect(entries).toEqual([]);
  });

  test("a version 0 store raises StoreMigrationError without creating a .bak", async () => {
    const cleanDir = tempDir("repotruck-registry-v0-");
    const env: EnvLike = { REPOTRUCK_CONFIG_DIR: cleanDir };
    const storePath = path.join(cleanDir, CONFIG_FILENAME);
    writeFileSync(storePath, JSON.stringify({ version: 0, workspaces: [] }), "utf8");
    let message = "";
    try {
      await listWorkspaces(env);
      expect.unreachable();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("no migration path");
    expect(message).toContain("upgrade repotruck");
    expect(message.split("\n").length).toBe(1);
    expect(existsSync(`${storePath}.bak`)).toBe(false);
  });

  test("legacy workspaces.json records are still listed", async () => {
    const cleanDir = tempDir("repotruck-registry-legacy-");
    const legacyEnv: EnvLike = { REPOTRUCK_CONFIG_DIR: cleanDir };
    const root = tempDir("repotruck-ws-legacy-");
    writeFileSync(
      path.join(cleanDir, LEGACY_WORKSPACES_FILENAME),
      JSON.stringify([
        {
          path: root,
          preset: "categorized",
          lastSync: null,
          repoCount: 3,
          lastUsed: "2026-10-23T00:00:00.000Z",
        },
      ]),
      "utf8",
    );
    const listing = await listWorkspaces(legacyEnv);
    expect(listing.length).toBe(1);
    expect(listing[0]!.path).toBe(root);
    expect(listing[0]!.preset).toBe("categorized");
    expect(listing[0]!.repoCount).toBe(0);
  });
});

describe("resolveWorkspaceRoot", () => {
  test("walks up to the nearest registered workspace root", async () => {
    const parent = tempDir("repotruck-walk-parent-");
    const child = path.join(parent, "deep", "child");
    mkdirSync(child, { recursive: true });
    await writeWorkspaceConfig(parent, defaultConfig(parent, "categorized"), env);
    expect(await resolveWorkspaceRoot(child, env)).toEqual({ root: parent, found: true });
    expect(await resolveWorkspaceRoot(parent, env)).toEqual({ root: parent, found: true });
    await writeWorkspaceConfig(child, defaultConfig(child, "categorized"), env);
    expect(await resolveWorkspaceRoot(child, env)).toEqual({ root: child, found: true });
  });

  test("walks up to a legacy in-workspace repotruck.json when nothing is registered", async () => {
    const parent = tempDir("repotruck-walk-legacy-");
    const child = path.join(parent, "deep", "child");
    mkdirSync(child, { recursive: true });
    writeFileSync(path.join(parent, CONFIG_FILENAME), "{}", "utf8");
    expect(await resolveWorkspaceRoot(child, env)).toEqual({ root: parent, found: true });
  });

  test("falls back to the start dir when nothing is found", async () => {
    const empty = tempDir("repotruck-walk-empty-");
    expect(await resolveWorkspaceRoot(empty, env)).toEqual({ root: empty, found: false });
  });
});

describe("legacy per-root config", () => {
  test("readLegacyWorkspaceConfig parses and validates the old file", async () => {
    const root = tempDir("repotruck-legacy-file-");
    const config = defaultConfig(root, "flat-by-owner");
    writeFileSync(path.join(root, CONFIG_FILENAME), JSON.stringify(config), "utf8");
    expect(await readLegacyWorkspaceConfig(root)).toEqual(config);
    writeFileSync(path.join(root, CONFIG_FILENAME), "{ this is not json ]", "utf8");
    expect(await readLegacyWorkspaceConfig(root)).toBeNull();
  });
});

describe("restoreWorkspaceSnapshot", () => {
  test("restores a written snapshot and replaces the current inventory", async () => {
    const root = tempDir("repotruck-restore-");
    const original = defaultConfig(root, "categorized");
    original.repos = [
      {
        owner: "acme",
        name: "api",
        relativePath: "acme/source/api",
        category: "source",
        internal: true,
        language: "TypeScript",
        updatedAt: null,
      },
    ];
    await writeWorkspaceConfig(root, original, env);
    const snapshotFile = await writeWorkspaceSnapshot(root, original);

    const mutated = defaultConfig(root, "flat-by-owner");
    await writeWorkspaceConfig(root, mutated, env);
    expect((await readWorkspaceConfig(root, env))?.repos.length).toBe(0);

    const result = await restoreWorkspaceSnapshot(root, path.basename(snapshotFile), env);
    expect(result.ok).toBe(true);
    const restored = await readWorkspaceConfig(root, env);
    expect(restored?.repos.length).toBe(1);
    expect(restored?.repos[0]?.name).toBe("api");
  });

  test("unknown snapshots and invalid content fail cleanly", async () => {
    const root = tempDir("repotruck-restore2-");
    await writeWorkspaceConfig(root, defaultConfig(root), env);
    const missing = await restoreWorkspaceSnapshot(
      root,
      "repotruck-1999-01-01T00-00-00-000Z.json",
      env,
    );
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain("snapshot not found");
  });
});

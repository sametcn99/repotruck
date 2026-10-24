import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_BACKUP_GENERATIONS,
  listWorkspaceSnapshots,
  workspaceBackupsDir,
  writeWorkspaceSnapshot,
} from "../src/services/backups.ts";
import { appConfigDir, type RepotruckConfig } from "../src/services/config.ts";
import { writeWorkspaceConfig } from "../src/services/workspaceRegistry.ts";

const tempRoots: string[] = [];

let isolatedConfigDir: string;
let savedConfigDir: string | undefined;
let realStoreBefore: string | null = null;
const REAL_STORE = path.join(appConfigDir(process.env), "repotruck.json");

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  isolatedConfigDir = mkdtempSync(path.join(tmpdir(), "repotruck-backups-cfg-"));
  process.env.REPOTRUCK_CONFIG_DIR = isolatedConfigDir;
  try {
    realStoreBefore = readFileSync(REAL_STORE, "utf8");
  } catch {
    realStoreBefore = null;
  }
});

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  let realStoreAfter: string | null = null;
  try {
    realStoreAfter = readFileSync(REAL_STORE, "utf8");
  } catch {
    realStoreAfter = null;
  }
  expect(realStoreAfter).toBe(realStoreBefore);
  rmSync(isolatedConfigDir, { recursive: true, force: true });
});

function makeTempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "repotruck-backups-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* swept by the next run */
    }
  }
});

function makeConfig(root: string, repoCount: number): RepotruckConfig {
  return {
    version: 1,
    root,
    preset: "categorized",
    lastSync: `2026-10-23T10:00:0${repoCount}.000Z`,
    repos: Array.from({ length: repoCount }, (_, i) => ({
      owner: "monalisa",
      name: `repo-${i}`,
      relativePath: `monalisa/source/repo-${i}`,
      category: "source" as const,
      internal: true,
      language: "TypeScript",
      updatedAt: null,
    })),
    aliases: repoCount > 0 ? { api: "monalisa/source/repo-0" } : undefined,
  };
}

describe("writeWorkspaceSnapshot", () => {
  test("writes a Windows-safe snapshot under .repotruck/backups/", async () => {
    const root = makeTempRoot();
    const config = makeConfig(root, 2);
    const file = await writeWorkspaceSnapshot(root, config);
    expect(path.dirname(file)).toBe(workspaceBackupsDir(root));
    const name = path.basename(file);
    expect(name).toMatch(/^repotruck-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?\.json$/);
    expect(name).not.toContain(":");
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed.repos.length).toBe(2);
    expect(parsed.aliases).toEqual({ api: "monalisa/source/repo-0" });
  });

  test("rotates to the default of 5 generations", async () => {
    const root = makeTempRoot();
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 9, 23, 10, 0, 0, 500 * ++tick));
    for (let i = 0; i < 7; i += 1) {
      await writeWorkspaceSnapshot(root, makeConfig(root, i + 1), { now });
    }
    const remaining = readdirSync(workspaceBackupsDir(root)).filter((name) =>
      name.endsWith(".json"),
    );
    expect(remaining.length).toBe(DEFAULT_BACKUP_GENERATIONS);
    const listed = await listWorkspaceSnapshots(root);
    expect(listed.length).toBe(DEFAULT_BACKUP_GENERATIONS);
    expect(listed[0]!.repoCount).toBe(7);
    expect(listed[listed.length - 1]!.repoCount).toBe(3);
    expect(listed.map((entry) => entry.createdAt)).toEqual(
      [...listed.map((entry) => entry.createdAt)].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)),
    );
  });

  test("honors a custom generation count", async () => {
    const root = makeTempRoot();
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 9, 23, 11, 0, 0, 500 * ++tick));
    for (let i = 0; i < 4; i += 1) {
      await writeWorkspaceSnapshot(root, makeConfig(root, i + 1), { now, generations: 2 });
    }
    const listed = await listWorkspaceSnapshots(root);
    expect(listed.length).toBe(2);
    expect(listed[0]!.repoCount).toBe(4);
    expect(listed[1]!.repoCount).toBe(3);
  });

  test("disambiguates two snapshots inside the same millisecond", async () => {
    const root = makeTempRoot();
    const fixed = () => new Date(Date.UTC(2026, 9, 23, 12, 0, 0, 42));
    await writeWorkspaceSnapshot(root, makeConfig(root, 1), { now: fixed });
    await writeWorkspaceSnapshot(root, makeConfig(root, 2), { now: fixed });
    const listed = await listWorkspaceSnapshots(root);
    expect(listed.length).toBe(2);
    expect(new Set(listed.map((entry) => entry.file)).size).toBe(2);
  });
});

describe("writeWorkspaceConfig snapshot hook", () => {
  test("snapshots the previous generation on every save", async () => {
    const root = makeTempRoot();
    mkdirSync(path.join(root, "monalisa", "source", "repo-0"), { recursive: true });
    await writeWorkspaceConfig(root, makeConfig(root, 1));
    expect((await listWorkspaceSnapshots(root)).length).toBe(0);
    await writeWorkspaceConfig(root, makeConfig(root, 2));
    const afterSecond = await listWorkspaceSnapshots(root);
    expect(afterSecond.length).toBe(1);
    expect(afterSecond[0]!.repoCount).toBe(1);
    await writeWorkspaceConfig(root, makeConfig(root, 3));
    const afterThird = await listWorkspaceSnapshots(root);
    expect(afterThird.length).toBe(2);
    expect(afterThird[0]!.repoCount).toBe(2);
    expect(afterThird[1]!.repoCount).toBe(1);
  });

  test("does not create .bak files or interfere with the migration backup", async () => {
    const root = makeTempRoot();
    await writeWorkspaceConfig(root, makeConfig(root, 1));
    await writeWorkspaceConfig(root, makeConfig(root, 2));
    const names = readdirSync(workspaceBackupsDir(root));
    for (const name of names) {
      expect(name.endsWith(".bak")).toBe(false);
      expect(name.endsWith(".tmp")).toBe(false);
    }
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RepoInventoryEntry, RepotruckConfig } from "../src/services/config.ts";
import {
  calculateWorkspaceStats,
  computeCategoryCounts,
  computeLanguageDistribution,
  computeStaleRepos,
  formatDiskSize,
  MAX_WALK_DEPTH,
  STALE_DAYS,
  walkRepositoriesOnDisk,
} from "../src/services/stats.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "repotruck-stats-test-"));
  tempRoots.push(dir);
  return dir;
}

describe("stats computations", () => {
  const sampleRepos: RepoInventoryEntry[] = [
    {
      owner: "sametcn99",
      name: "repo1",
      relativePath: "sametcn99/source/repo1",
      category: "source",
      internal: true,
      language: "TypeScript",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      owner: "sametcn99",
      name: "repo2",
      relativePath: "sametcn99/forks/repo2",
      category: "forks",
      internal: true,
      language: "TypeScript",
      updatedAt: "2026-10-20T00:00:00.000Z",
    },
    {
      owner: "sametcn99",
      name: "repo3",
      relativePath: "sametcn99/archived/repo3",
      category: "archived",
      internal: true,
      language: "Go",
      updatedAt: null,
      custom: true,
    },
    {
      owner: "sametcn99",
      name: "repo4",
      relativePath: "custom/path",
      category: "source",
      internal: true,
      language: null,
      updatedAt: "2025-01-01T00:00:00.000Z",
      custom: true,
    },
  ];

  test("computeCategoryCounts counts categories and custom accurately", () => {
    const counts = computeCategoryCounts(sampleRepos);
    expect(counts.source).toBe(2);
    expect(counts.forks).toBe(1);
    expect(counts.archived).toBe(1);
    expect(counts.custom).toBe(2);
  });

  test("computeLanguageDistribution aggregates and sorts descending", () => {
    const langs = computeLanguageDistribution(sampleRepos);
    expect(langs).toEqual([
      { language: "TypeScript", count: 2 },
      { language: "Go", count: 1 },
      { language: "Unknown", count: 1 },
    ]);
  });

  test("computeStaleRepos flags repos older than STALE_DAYS", () => {
    const now = Date.parse("2026-10-23T00:00:00.000Z");
    const stale = computeStaleRepos(sampleRepos, now, STALE_DAYS);
    // repo1: Jan 1 2026 (~295 days) -> stale
    // repo2: Oct 20 2026 (3 days) -> not stale
    // repo3: null updatedAt -> not included
    // repo4: Jan 1 2025 (~660 days) -> stale
    expect(stale.totalStale).toBe(2);
    expect(stale.topStalest[0]?.key).toBe("sametcn99/repo4");
    expect(stale.topStalest[1]?.key).toBe("sametcn99/repo1");
  });

  test("formatDiskSize formats correctly", () => {
    expect(formatDiskSize(500)).toBe("500 B");
    expect(formatDiskSize(2048)).toBe("2.0 KB");
    expect(formatDiskSize(1024 * 1024 * 5)).toBe("5.0 MB");
    expect(formatDiskSize(1024 * 1024 * 1024 * 3.5)).toBe("3.5 GB");
  });

  test("calculateWorkspaceStats formats full output", () => {
    const now = Date.parse("2026-10-23T00:00:00.000Z");
    const config: RepotruckConfig = {
      version: 1,
      root: "/mock/workspace",
      preset: "categorized",
      lastSync: "2026-10-23T00:00:00.000Z",
      repos: sampleRepos,
    };
    const disk = { repoCount: 4, totalSizeBytes: 1024 * 1024 * 10 };
    const res = calculateWorkspaceStats(config, disk, now);
    expect(res.formatted).toContain("languages:");
    expect(res.formatted).toContain("TypeScript 2");
    expect(res.formatted).toContain("categories: source 2 • forks 1 • archived 1 • custom 2");
    expect(res.formatted).toContain("disk: 4 repositories • 10.0 MB");
  });
});

describe("walkRepositoriesOnDisk loop and depth protection (ST1 / T2'')", () => {
  test("walk stops at MAX_WALK_DEPTH", () => {
    expect(MAX_WALK_DEPTH).toBe(10);
    const root = tempDir();
    let current = root;
    for (let i = 0; i < 15; i++) {
      current = path.join(current, `level-${i}`);
      mkdirSync(current);
    }
    // Create a repo beyond max depth
    mkdirSync(path.join(current, ".git"));
    writeFileSync(path.join(current, "file.txt"), "hello");

    const disk = walkRepositoriesOnDisk(root, 10);
    // Depth > 10 should not be reached
    expect(disk.repoCount).toBe(0);
  });

  test("walk handles junction / symlink loops safely without infinite recursion", () => {
    const root = tempDir();
    const repoA = path.join(root, "repoA");
    mkdirSync(repoA);
    mkdirSync(path.join(repoA, ".git"));
    writeFileSync(path.join(repoA, "README.md"), "content");

    // Attempt to create a symlink / junction loop if supported
    try {
      const loopDir = path.join(root, "loop");
      symlinkSync(root, loopDir, "junction");
    } catch {
      /* symlink creation may require elevated privileges on older Windows versions */
    }

    const disk = walkRepositoriesOnDisk(root, 5);
    expect(disk.repoCount).toBe(1);
    expect(disk.totalSizeBytes).toBeGreaterThan(0);
  });
});

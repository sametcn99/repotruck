import { readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { RepoInventoryEntry, RepotruckConfig } from "./config.ts";
import { inspectGitDotEntry } from "./worktree.ts";

export const STALE_DAYS = 180;
export const MAX_WALK_DEPTH = 10;

export interface CategoryCounts {
  source: number;
  forks: number;
  archived: number;
  custom: number;
}

export function computeCategoryCounts(repos: readonly RepoInventoryEntry[]): CategoryCounts {
  const counts: CategoryCounts = { source: 0, forks: 0, archived: 0, custom: 0 };
  for (const repo of repos) {
    if (repo.category === "source") counts.source += 1;
    else if (repo.category === "forks") counts.forks += 1;
    else if (repo.category === "archived") counts.archived += 1;
    if (repo.custom === true) counts.custom += 1;
  }
  return counts;
}

export function computeLanguageDistribution(
  repos: readonly RepoInventoryEntry[],
): Array<{ language: string; count: number }> {
  const map = new Map<string, number>();
  for (const repo of repos) {
    const lang = repo.language ?? "Unknown";
    map.set(lang, (map.get(lang) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
}

export interface StaleRepo {
  key: string;
  days: number;
}

export function computeStaleRepos(
  repos: readonly RepoInventoryEntry[],
  now: number = Date.now(),
  staleDays: number = STALE_DAYS,
): { totalStale: number; topStalest: StaleRepo[] } {
  const list: StaleRepo[] = [];
  const msPerDay = 24 * 60 * 60 * 1000;

  for (const repo of repos) {
    if (repo.updatedAt === null || repo.updatedAt === undefined) continue;
    const updated = Date.parse(repo.updatedAt);
    if (Number.isNaN(updated)) continue;
    const diffDays = Math.floor((now - updated) / msPerDay);
    if (diffDays >= staleDays) {
      list.push({ key: `${repo.owner}/${repo.name}`, days: diffDays });
    }
  }

  list.sort((a, b) => b.days - a.days || a.key.localeCompare(b.key));
  return {
    totalStale: list.length,
    topStalest: list.slice(0, 5),
  };
}

export function formatDiskSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function computeDirSizeBytes(
  dir: string,
  visited: Set<string>,
  depth: number,
  maxDepth: number,
): number {
  if (depth > maxDepth) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".repotruck") continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        try {
          const real = realpathSync(full);
          if (visited.has(real)) continue;
          visited.add(real);
        } catch {
          continue;
        }
        total += computeDirSizeBytes(full, visited, depth + 1, maxDepth);
      } else if (entry.isFile()) {
        try {
          const s = statSync(full);
          total += s.size;
        } catch {
          /* ignore unreadable file */
        }
      }
    }
  } catch {
    /* ignore unreadable dir */
  }
  return total;
}

export interface DiskStats {
  repoCount: number;
  totalSizeBytes: number;
}

export function walkRepositoriesOnDisk(
  rootDir: string,
  maxDepth: number = MAX_WALK_DEPTH,
): DiskStats {
  let repoCount = 0;
  let totalSizeBytes = 0;
  const visited = new Set<string>();

  function walk(currentDir: string, depth: number): void {
    if (depth > maxDepth) return;
    try {
      const real = realpathSync(currentDir);
      if (visited.has(real)) return;
      visited.add(real);
    } catch {
      return;
    }

    const gitDot = inspectGitDotEntry(currentDir);
    if (gitDot.kind === "worktree") {
      return;
    }
    if (gitDot.kind === "repo") {
      repoCount += 1;
      const sizeVisited = new Set<string>();
      totalSizeBytes += computeDirSizeBytes(currentDir, sizeVisited, 0, maxDepth);
      return;
    }

    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        if (entry.name === ".repotruck" || entry.name === ".git") continue;
        if (entry.isDirectory()) {
          walk(path.join(currentDir, entry.name), depth + 1);
        }
      }
    } catch {
      /* ignore */
    }
  }

  walk(rootDir, 0);
  return { repoCount, totalSizeBytes };
}

export interface WorkspaceStatsOutput {
  languages: Array<{ language: string; count: number }>;
  categories: CategoryCounts;
  disk: DiskStats;
  stale: { totalStale: number; topStalest: StaleRepo[] };
  formatted: string;
}

export function calculateWorkspaceStats(
  config: RepotruckConfig,
  diskStats: DiskStats,
  now: number = Date.now(),
): WorkspaceStatsOutput {
  const languages = computeLanguageDistribution(config.repos);
  const categories = computeCategoryCounts(config.repos);
  const stale = computeStaleRepos(config.repos, now);

  const lines: string[] = [];
  lines.push("languages:");
  if (languages.length === 0) {
    lines.push("  (none)");
  } else {
    for (const lang of languages) {
      lines.push(`  ${lang.language} ${lang.count}`);
    }
  }

  lines.push(
    `categories: source ${categories.source} \u2022 forks ${categories.forks} \u2022 archived ${categories.archived} \u2022 custom ${categories.custom}`,
  );
  lines.push(
    `disk: ${diskStats.repoCount} repositories \u2022 ${formatDiskSize(diskStats.totalSizeBytes)}`,
  );
  lines.push(`stale (>=${STALE_DAYS}d): ${stale.totalStale}`);
  for (const item of stale.topStalest) {
    lines.push(`  ${item.key} (${item.days}d)`);
  }

  return {
    languages,
    categories,
    disk: diskStats,
    stale,
    formatted: lines.join("\n"),
  };
}

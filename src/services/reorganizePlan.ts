import path from "node:path";
import type { RepotruckConfig } from "./config.ts";
import type { ReorganizeResult } from "./reorganizer.ts";
import type { DiscoveredRepo } from "./scanner.ts";

export interface PlanEntry {
  key: string;
  owner: string;
  name: string;
  isArchived: boolean;
  isFork: boolean;
  forkSourceOwner?: string;
  language: string | null;
  internal: boolean;
  relativePath: string;
  custom: boolean;
  tracked: boolean;
}

export function occupiedParent(
  relativePath: string,
  occupied: ReadonlyMap<string, string>,
): string | undefined {
  let parent = path.posix.dirname(relativePath.toLowerCase());
  while (parent !== ".") {
    if (occupied.has(parent)) return parent;
    parent = path.posix.dirname(parent);
  }
}

export function buildPlanEntries(
  root: string,
  config: RepotruckConfig,
  discovered: DiscoveredRepo[],
  exists: (path: string) => boolean,
  result: ReorganizeResult,
): PlanEntry[] {
  const entries: PlanEntry[] = config.repos.map((entry) => ({
    key: `${entry.owner}/${entry.name}`,
    owner: entry.owner,
    name: entry.name,
    isArchived: entry.category === "archived",
    isFork: entry.category === "forks",
    forkSourceOwner: entry.forkSourceOwner,
    language: entry.language,
    internal: entry.internal,
    relativePath: entry.relativePath,
    custom: entry.custom === true,
    tracked: true,
  }));
  const found = new Map<string, DiscoveredRepo[]>();
  for (const item of discovered) {
    const key = `${item.owner}/${item.name}`.toLowerCase();
    const matches = found.get(key) ?? [];
    matches.push(item);
    found.set(key, matches);
  }
  const registered = new Map(entries.map((entry) => [entry.key.toLowerCase(), entry]));
  for (const [key, matches] of found) {
    const tracked = registered.get(key);
    if (tracked && exists(path.join(root, ...tracked.relativePath.split("/")))) continue;
    if (matches.length > 1) {
      if (!tracked) result.failed.push({ key, message: "multiple local clones found" });
      continue;
    }
    const item = matches[0]!;
    if (tracked) {
      tracked.relativePath = item.relativePath;
      continue;
    }
    entries.push({
      key: `${item.owner}/${item.name}`,
      owner: item.owner,
      name: item.name,
      isArchived: false,
      isFork: false,
      language: null,
      internal: item.internal,
      relativePath: item.relativePath,
      custom: false,
      tracked: false,
    });
  }
  return entries;
}

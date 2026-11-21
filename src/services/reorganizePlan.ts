import path from "node:path";
import { repoCategory } from "../presets/index.ts";
import { createCloneLimiter } from "./cloner.ts";
import type { RepoInventoryEntry, RepotruckConfig } from "./config.ts";
import { forkFromCheckoutPath, lookupRepoDetails, type RepoLookup } from "./forkSource.ts";
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

export async function resolveCategorizedForks(
  entries: PlanEntry[],
  getRepo: RepoLookup,
  keepCustom: boolean,
): Promise<void> {
  const limit = createCloneLimiter(4);
  await Promise.all(
    entries
      .filter(
        (entry) =>
          !(entry.custom && keepCustom) &&
          !entry.forkSourceOwner &&
          (entry.isFork || !entry.tracked),
      )
      .map((entry) =>
        limit(async () => {
          const remote = await lookupRepoDetails(entry, getRepo);
          if (!remote) return;
          if (!entry.tracked) {
            entry.isFork = remote.isFork;
            entry.isArchived = remote.isArchived;
          }
          entry.forkSourceOwner = remote.forkSourceOwner;
        }),
      ),
  );
}

export function adoptedEntry(entry: PlanEntry, relativePath: string): RepoInventoryEntry {
  const { owner, name, internal, language, forkSourceOwner } = entry;
  return {
    owner,
    name,
    internal,
    language,
    relativePath,
    category: repoCategory(entry),
    updatedAt: null,
    ...(forkSourceOwner ? { forkSourceOwner } : {}),
  };
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
  const entries: PlanEntry[] = config.repos.map((entry) => {
    const fork = entry.category === "archived" ? undefined : forkFromCheckoutPath(entry);
    return {
      key: `${entry.owner}/${entry.name}`,
      owner: entry.owner,
      name: entry.name,
      isArchived: entry.category === "archived",
      isFork: entry.category === "forks" || fork !== undefined,
      forkSourceOwner: entry.forkSourceOwner ?? fork?.forkSourceOwner,
      language: entry.language,
      internal: entry.internal,
      relativePath: entry.relativePath,
      custom: entry.custom === true,
      tracked: true,
    };
  });
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
      ...forkFromCheckoutPath(item),
    });
  }
  return entries;
}

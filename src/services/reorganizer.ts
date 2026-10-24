import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { simpleGit } from "simple-git";
import type { CustomPreset, PresetRef } from "../presets/index.ts";
import { targetSegmentsForPreset } from "../presets/index.ts";
import { firstErrorLine } from "./cloner.ts";
import type { EnvLike, RepotruckConfig } from "./config.ts";
import { repoKeyEquals } from "./fsUtils.ts";
import { moveDir } from "./mover.ts";
import { type ParsedGitUrl, parseGitUrl } from "./singleCloner.ts";
import { loadWorkspace, saveWorkspace, toPosixRelative, upsertInventory } from "./workspace.ts";

export interface ReorganizeOptions {
  scan?: boolean;
  dryRun?: boolean;
  keepCustom?: boolean;
  env?: EnvLike;
  customPresets?: readonly CustomPreset[];
}

export interface ReorganizeMove {
  key: string;
  from: string;
  to: string;
}

export interface ReorganizeSkip {
  key: string;
  reason: string;
}

export interface ReorganizeFailure {
  key: string;
  message: string;
}

export interface ReorganizeCollision {
  key: string;
  target: string;
  occupiedBy: string;
}

export interface ReorganizeResult {
  moved: ReorganizeMove[];
  skipped: ReorganizeSkip[];
  failed: ReorganizeFailure[];
  collisions: ReorganizeCollision[];
}

interface PlanEntry {
  key: string;
  owner: string;
  name: string;
  isArchived: boolean;
  isFork: boolean;
  language: string | null;
  internal: boolean;
  relativePath: string;
  custom: boolean;
  tracked: boolean;
}

interface DiscoveredRepo {
  owner: string;
  name: string;
  relativePath: string;
  internal: boolean;
}

const MAX_SCAN_DEPTH = 6;

async function scanForRepos(root: string): Promise<DiscoveredRepo[]> {
  const found: DiscoveredRepo[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH) return;
    let items: Dirent[];
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (!item.isDirectory()) continue;
      if (item.name === "node_modules" || item.name.startsWith(".")) continue;
      const full = path.join(dir, item.name);
      if (existsSync(path.join(full, ".git"))) {
        const relativePath = toPosixRelative(root, full);
        let parsed: ParsedGitUrl | null = null;
        try {
          const remote = await simpleGit(full).raw(["remote", "get-url", "origin"]);
          parsed = parseGitUrl(remote.trim());
        } catch {
          parsed = null;
        }
        if (parsed !== null) {
          found.push({
            owner: parsed.owner,
            name: parsed.name,
            relativePath,
            internal: !relativePath.toLowerCase().startsWith("community/"),
          });
        }
        continue;
      }
      await walk(full, depth + 1);
    }
  };
  await walk(root, 0);
  return found;
}

function buildPlanEntries(config: RepotruckConfig, discovered: DiscoveredRepo[]): PlanEntry[] {
  const entries: PlanEntry[] = config.repos.map((entry) => ({
    key: `${entry.owner}/${entry.name}`,
    owner: entry.owner,
    name: entry.name,
    isArchived: entry.category === "archived",
    isFork: entry.category === "forks",
    language: entry.language,
    internal: entry.internal,
    relativePath: entry.relativePath,
    custom: entry.custom === true,
    tracked: true,
  }));
  for (const item of discovered) {
    const exists = entries.some((entry) => repoKeyEquals(entry, item.owner, item.name));
    if (exists) continue;
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

export async function reorganizeWorkspace(
  root: string,
  newPreset: PresetRef,
  options: ReorganizeOptions = {},
): Promise<ReorganizeResult> {
  const config = await loadWorkspace(root, undefined, options.env);
  const entries = buildPlanEntries(config, options.scan === true ? await scanForRepos(root) : []);
  const result: ReorganizeResult = { moved: [], skipped: [], failed: [], collisions: [] };
  const occupied = new Map<string, string>();
  for (const entry of entries) {
    occupied.set(entry.relativePath.toLowerCase(), entry.key);
  }

  for (const entry of entries) {
    const segments = targetSegmentsForPreset(
      {
        owner: entry.owner,
        name: entry.name,
        isArchived: entry.isArchived,
        isFork: entry.isFork,
        language: entry.language,
      },
      newPreset,
      entry.internal,
      options.customPresets ?? [],
    );
    const targetRel = segments.join("/");
    const srcAbs = path.join(root, ...entry.relativePath.split("/"));
    const destAbs = path.join(root, ...segments);

    if (options.keepCustom === true && entry.custom) {
      result.skipped.push({ key: entry.key, reason: "custom placement kept" });
      continue;
    }
    if (entry.relativePath.toLowerCase() === targetRel.toLowerCase()) {
      result.skipped.push({ key: entry.key, reason: "already at target" });
      continue;
    }
    const occupant = occupied.get(targetRel.toLowerCase());
    if (occupant !== undefined && occupant !== entry.key) {
      result.collisions.push({ key: entry.key, target: targetRel, occupiedBy: occupant });
      continue;
    }
    if (existsSync(destAbs)) {
      result.collisions.push({ key: entry.key, target: targetRel, occupiedBy: "(on disk)" });
      continue;
    }
    if (!existsSync(srcAbs)) {
      result.failed.push({ key: entry.key, message: "not on disk" });
      continue;
    }
    if (options.dryRun === true) {
      result.moved.push({ key: entry.key, from: entry.relativePath, to: targetRel });
      continue;
    }

    try {
      moveDir(srcAbs, destAbs);
    } catch (error) {
      result.failed.push({ key: entry.key, message: firstErrorLine(error) });
      continue;
    }
    occupied.delete(entry.relativePath.toLowerCase());
    occupied.set(targetRel.toLowerCase(), entry.key);
    result.moved.push({ key: entry.key, from: entry.relativePath, to: targetRel });
  }

  if (options.dryRun !== true) {
    let working = config;
    const moveMap = new Map(result.moved.map((move) => [move.key.toLowerCase(), move.to] as const));
    const oldPathsByKey = new Map(
      entries.map((entry) => [entry.key.toLowerCase(), entry.relativePath] as const),
    );
    const aliases: Record<string, string> = { ...(working.aliases ?? {}) };
    for (const [alias, target] of Object.entries(aliases)) {
      for (const move of result.moved) {
        const oldPath = oldPathsByKey.get(move.key.toLowerCase());
        if (oldPath !== undefined && oldPath.toLowerCase() === target.toLowerCase()) {
          aliases[alias] = move.to;
        }
      }
    }
    const repos = working.repos.map((entry) => {
      const target = moveMap.get(`${entry.owner}/${entry.name}`.toLowerCase());
      if (target === undefined) return entry;
      return {
        ...entry,
        relativePath: target,
        ...(entry.custom === true ? { custom: false } : {}),
      };
    });
    working = {
      ...working,
      preset: newPreset,
      repos,
      ...(Object.keys(aliases).length > 0 ? { aliases } : {}),
    };
    for (const move of result.moved) {
      const entry = entries.find((item) => item.key === move.key);
      if (entry === undefined || entry.tracked) continue;
      working = upsertInventory(
        working,
        {
          owner: entry.owner,
          name: entry.name,
          isArchived: entry.isArchived,
          isFork: entry.isFork,
          language: entry.language,
          updatedAt: null,
        },
        move.to,
        entry.internal,
      );
    }
    await saveWorkspace(root, working, options.env);
  }
  return result;
}

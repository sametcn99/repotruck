import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { simpleGit } from "simple-git";
import type { CustomPreset, PresetRef } from "../presets/index.ts";
import { targetSegmentsForPreset } from "../presets/index.ts";
import { firstErrorLine } from "./cloner.ts";
import type { EnvLike, RepotruckConfig } from "./config.ts";
import { getActualCasingOnDisk, repoKeyEquals } from "./fsUtils.ts";
import { moveDir } from "./mover.ts";
import { type ParsedGitUrl, parseGitUrl } from "./singleCloner.ts";
import { loadWorkspace, toPosixRelative, updateWorkspace, upsertInventory } from "./workspace.ts";
import { inspectGitDotEntry, isLinkedWorktree } from "./worktree.ts";

export interface ReorganizeJournalMove {
  key: string;
  from: string;
  to: string;
  status: "pending" | "done";
  tmpPath?: string;
}

export interface ReorganizeJournal {
  version: 1;
  preset: PresetRef;
  timestamp: string;
  moves: ReorganizeJournalMove[];
}

export function reorganizeJournalPath(root: string): string {
  return path.join(root, ".repotruck", "reorganize-journal.json");
}

export function writeReorganizeJournalAtomically(root: string, journal: ReorganizeJournal): void {
  const dir = path.join(root, ".repotruck");
  mkdirSync(dir, { recursive: true });
  const journalPath = reorganizeJournalPath(root);
  const tmpPath = path.join(dir, `reorganize-journal.json.tmp-${randomUUID()}`);
  writeFileSync(tmpPath, JSON.stringify(journal, null, 2), "utf8");
  renameSync(tmpPath, journalPath);
}

export function readReorganizeJournal(root: string): ReorganizeJournal | null {
  const journalPath = reorganizeJournalPath(root);
  if (!existsSync(journalPath)) return null;
  const raw = readFileSync(journalPath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.moves)) {
      return parsed as ReorganizeJournal;
    }
    throw new Error(`corrupt reorganize journal; inspect or delete ${journalPath}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("corrupt reorganize journal")) {
      throw err;
    }
    throw new Error(
      `corrupt reorganize journal; inspect or delete ${journalPath} (${firstErrorLine(err)})`,
    );
  }
}

export function deleteReorganizeJournal(root: string): void {
  const journalPath = reorganizeJournalPath(root);
  if (existsSync(journalPath)) {
    try {
      unlinkSync(journalPath);
    } catch {
      /* best effort */
    }
  }
}

export interface ReorganizeOptions {
  scan?: boolean;
  dryRun?: boolean;
  keepCustom?: boolean;
  resume?: boolean;
  env?: EnvLike;
  customPresets?: readonly CustomPreset[];
  moveDirImpl?: typeof moveDir;
  existsSyncImpl?: (p: string) => boolean;
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
      const gitDot = inspectGitDotEntry(full);
      if (gitDot.kind === "worktree") {
        continue;
      }
      if (gitDot.kind === "repo") {
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

async function resumeReorganize(
  root: string,
  options: ReorganizeOptions,
): Promise<ReorganizeResult> {
  const existsFn = options.existsSyncImpl ?? existsSync;
  const moveFn = options.moveDirImpl ?? moveDir;
  const journal = readReorganizeJournal(root);
  if (journal === null) {
    throw new Error(`no unfinished reorganize journal found in ${root}`);
  }

  const result: ReorganizeResult = { moved: [], skipped: [], failed: [], collisions: [] };
  const successfulMoves: Array<{ key: string; from: string; to: string }> = [];

  for (const move of journal.moves) {
    const isCaseOnly = move.from.toLowerCase() === move.to.toLowerCase() && move.from !== move.to;

    if (move.tmpPath) {
      const tmpAbs = path.join(root, ...move.tmpPath.split("/"));
      if (existsFn(tmpAbs)) {
        const fromAbs = path.join(root, ...move.from.split("/"));
        try {
          moveFn(tmpAbs, fromAbs);
          result.skipped.push({ key: move.key, reason: "interrupted move rolled back to source" });
        } catch (err) {
          result.failed.push({
            key: move.key,
            message: `failed to roll back in-flight move from ${move.tmpPath} to ${move.from}: ${firstErrorLine(err)}`,
          });
        }
        continue;
      }
    }

    if (isCaseOnly) {
      const actual = getActualCasingOnDisk(root, move.to, undefined, existsFn);
      if (actual === move.to) {
        successfulMoves.push({ key: move.key, from: move.from, to: move.to });
        result.moved.push({ key: move.key, from: move.from, to: move.to });
      } else if (actual === move.from) {
        result.skipped.push({ key: move.key, reason: "pending move left at source" });
      } else {
        result.failed.push({ key: move.key, message: "source and destination both missing" });
      }
      continue;
    }

    const destAbs = path.join(root, ...move.to.split("/"));
    if (existsFn(destAbs)) {
      successfulMoves.push({ key: move.key, from: move.from, to: move.to });
      result.moved.push({ key: move.key, from: move.from, to: move.to });
      continue;
    }

    const srcAbs = path.join(root, ...move.from.split("/"));
    if (existsFn(srcAbs)) {
      result.skipped.push({ key: move.key, reason: "pending move left at source" });
    } else {
      result.failed.push({ key: move.key, message: "source and destination both missing" });
    }
  }

  const moveMap = new Map(successfulMoves.map((m) => [m.key.toLowerCase(), m.to] as const));
  const oldPathsByKey = new Map(journal.moves.map((m) => [m.key.toLowerCase(), m.from] as const));

  await updateWorkspace(
    root,
    (current) => {
      let currentWorking = { ...current };
      const currentAliases: Record<string, string> = { ...(currentWorking.aliases ?? {}) };
      for (const [alias, target] of Object.entries(currentAliases)) {
        for (const move of successfulMoves) {
          const oldPath = oldPathsByKey.get(move.key.toLowerCase());
          if (oldPath !== undefined && oldPath.toLowerCase() === target.toLowerCase()) {
            currentAliases[alias] = move.to;
          }
        }
      }
      const repos = currentWorking.repos.map((entry) => {
        const target = moveMap.get(`${entry.owner}/${entry.name}`.toLowerCase());
        if (target === undefined) return entry;
        return {
          ...entry,
          relativePath: target,
          ...(entry.custom === true ? { custom: false } : {}),
        };
      });
      currentWorking = {
        ...currentWorking,
        repos,
        ...(Object.keys(currentAliases).length > 0 ? { aliases: currentAliases } : {}),
      };
      return { config: currentWorking, result: undefined };
    },
    options.env,
  );

  const hasUnrecoveredTmp = journal.moves.some((m) => {
    if (!m.tmpPath) return false;
    const tmpAbs = path.join(root, ...m.tmpPath.split("/"));
    return existsFn(tmpAbs);
  });
  if (!hasUnrecoveredTmp) {
    deleteReorganizeJournal(root);
  }
  return result;
}

export async function reorganizeWorkspace(
  root: string,
  newPreset?: PresetRef,
  options: ReorganizeOptions = {},
): Promise<ReorganizeResult> {
  const existsFn = options.existsSyncImpl ?? existsSync;
  const moveFn = options.moveDirImpl ?? moveDir;

  if (options.resume === true) {
    return await resumeReorganize(root, options);
  }

  if (newPreset === undefined) {
    throw new Error("preset is required for reorganization");
  }

  if (existsFn(reorganizeJournalPath(root))) {
    throw new Error(
      `unfinished reorganize in progress in ${root}; run 'repotruck reorganize --resume' or 'repotruck doctor --fix'`,
    );
  }

  const config = await loadWorkspace(root, undefined, options.env);
  const entries = buildPlanEntries(config, options.scan === true ? await scanForRepos(root) : []);
  const result: ReorganizeResult = { moved: [], skipped: [], failed: [], collisions: [] };
  const occupied = new Map<string, string>();
  for (const entry of entries) {
    occupied.set(entry.relativePath.toLowerCase(), entry.key);
  }

  interface PlannedMove {
    entry: PlanEntry;
    targetRel: string;
    srcAbs: string;
    destAbs: string;
    isCaseOnly: boolean;
  }

  const plannedMoves: PlannedMove[] = [];

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

    if (options.existsSyncImpl === undefined && isLinkedWorktree(srcAbs)) {
      result.skipped.push({ key: entry.key, reason: "linked git worktree kept" });
      continue;
    }

    const isExactSame = entry.relativePath === targetRel;
    const isCaseOnly = entry.relativePath.toLowerCase() === targetRel.toLowerCase() && !isExactSame;

    if (isExactSame) {
      result.skipped.push({ key: entry.key, reason: "already at target" });
      continue;
    }

    if (!isCaseOnly) {
      const occupant = occupied.get(targetRel.toLowerCase());
      if (occupant !== undefined && occupant !== entry.key) {
        result.collisions.push({ key: entry.key, target: targetRel, occupiedBy: occupant });
        continue;
      }
      if (existsFn(destAbs)) {
        result.collisions.push({ key: entry.key, target: targetRel, occupiedBy: "(on disk)" });
        continue;
      }
    }

    if (!existsFn(srcAbs)) {
      result.failed.push({ key: entry.key, message: "not on disk" });
      continue;
    }

    plannedMoves.push({ entry, targetRel, srcAbs, destAbs, isCaseOnly });
  }

  if (options.dryRun === true) {
    for (const plan of plannedMoves) {
      result.moved.push({ key: plan.entry.key, from: plan.entry.relativePath, to: plan.targetRel });
    }
    return result;
  }

  const journal: ReorganizeJournal = {
    version: 1,
    preset: newPreset,
    timestamp: new Date().toISOString(),
    moves: plannedMoves.map((p) => ({
      key: p.entry.key,
      from: p.entry.relativePath,
      to: p.targetRel,
      status: "pending",
    })),
  };
  writeReorganizeJournalAtomically(root, journal);

  for (const plan of plannedMoves) {
    const journalEntry = journal.moves.find((m) => m.key === plan.entry.key);
    try {
      if (plan.isCaseOnly) {
        const tmpRel = `${plan.entry.relativePath}.tmp-${randomUUID().slice(0, 8)}`;
        const tmpAbs = path.join(root, ...tmpRel.split("/"));
        if (journalEntry) {
          journalEntry.tmpPath = tmpRel;
          writeReorganizeJournalAtomically(root, journal);
        }

        moveFn(plan.srcAbs, tmpAbs);

        try {
          moveFn(tmpAbs, plan.destAbs);
        } catch (phase2Error) {
          try {
            moveFn(tmpAbs, plan.srcAbs);
            if (journalEntry) {
              journalEntry.tmpPath = undefined;
              writeReorganizeJournalAtomically(root, journal);
            }
          } catch (rollbackError) {
            throw new Error(
              `phase 2 failed (${firstErrorLine(phase2Error)}); rollback failed (${firstErrorLine(rollbackError)})`,
            );
          }
          throw phase2Error;
        }

        if (journalEntry) {
          journalEntry.tmpPath = undefined;
          journalEntry.status = "done";
          writeReorganizeJournalAtomically(root, journal);
        }
      } else {
        moveFn(plan.srcAbs, plan.destAbs);
        if (journalEntry) {
          journalEntry.status = "done";
          writeReorganizeJournalAtomically(root, journal);
        }
      }
    } catch (error) {
      result.failed.push({ key: plan.entry.key, message: firstErrorLine(error) });
      continue;
    }

    occupied.delete(plan.entry.relativePath.toLowerCase());
    occupied.set(plan.targetRel.toLowerCase(), plan.entry.key);
    result.moved.push({ key: plan.entry.key, from: plan.entry.relativePath, to: plan.targetRel });
  }

  const moveMap = new Map(result.moved.map((move) => [move.key.toLowerCase(), move.to] as const));
  const oldPathsByKey = new Map(
    entries.map((entry) => [entry.key.toLowerCase(), entry.relativePath] as const),
  );

  await updateWorkspace(
    root,
    (current) => {
      let currentWorking = { ...current };
      const currentAliases: Record<string, string> = { ...(currentWorking.aliases ?? {}) };
      for (const [alias, target] of Object.entries(currentAliases)) {
        for (const move of result.moved) {
          const oldPath = oldPathsByKey.get(move.key.toLowerCase());
          if (oldPath !== undefined && oldPath.toLowerCase() === target.toLowerCase()) {
            currentAliases[alias] = move.to;
          }
        }
      }
      const repos = currentWorking.repos.map((entry) => {
        const target = moveMap.get(`${entry.owner}/${entry.name}`.toLowerCase());
        if (target === undefined) return entry;
        return {
          ...entry,
          relativePath: target,
          ...(entry.custom === true ? { custom: false } : {}),
        };
      });
      currentWorking = {
        ...currentWorking,
        preset: newPreset,
        repos,
        ...(Object.keys(currentAliases).length > 0 ? { aliases: currentAliases } : {}),
      };
      for (const move of result.moved) {
        const entry = entries.find((item) => item.key === move.key);
        if (entry === undefined || entry.tracked) continue;
        currentWorking = upsertInventory(
          currentWorking,
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
      return { config: currentWorking, result: undefined };
    },
    options.env,
  );

  const hasUnrecoveredTmp = journal.moves.some((m) => {
    if (!m.tmpPath) return false;
    const tmpAbs = path.join(root, ...m.tmpPath.split("/"));
    return existsFn(tmpAbs);
  });
  if (!hasUnrecoveredTmp) {
    deleteReorganizeJournal(root);
  }
  return result;
}

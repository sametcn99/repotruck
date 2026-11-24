import { randomUUID } from "node:crypto";
import { existsSync, rmdirSync } from "node:fs";
import path from "node:path";
import type { CustomPreset, PresetRef } from "../presets/index.ts";
import { isPresetId, targetSegmentsForPreset } from "../presets/index.ts";
import { firstErrorLine } from "./cloner.ts";
import type { EnvLike } from "./config.ts";
import type { RepoLookup } from "./forkSource.ts";
import { getActualCasingOnDisk, repoKeyEquals } from "./fsUtils.ts";
import { moveDir } from "./mover.ts";
import {
  deleteReorganizeJournal,
  type ReorganizeJournal,
  readReorganizeJournal,
  reorganizeJournalPath,
  writeReorganizeJournalAtomically,
} from "./reorganizeJournal.ts";
import {
  adoptedEntry,
  buildPlanEntries,
  occupiedParent,
  type PlanEntry,
  resolveCategorizedForks,
} from "./reorganizePlan.ts";
import {
  directoryIdentity,
  isRecordedDestination,
  sameDirectoryIdentity,
} from "./reorganizeRecovery.ts";
import { scanForRepos } from "./scanner.ts";
import { loadWorkspace, updateWorkspace } from "./workspace.ts";
import { workspacePath } from "./workspacePaths.ts";
import { repositoryMoveProblem } from "./worktree.ts";

export {
  deleteReorganizeJournal,
  type ReorganizeJournal,
  type ReorganizeJournalMove,
  readReorganizeJournal,
  reorganizeJournalPath,
  writeReorganizeJournalAtomically,
} from "./reorganizeJournal.ts";

export interface ReorganizeOptions {
  scan?: boolean;
  dryRun?: boolean;
  keepCustom?: boolean;
  resume?: boolean;
  env?: EnvLike;
  customPresets?: readonly CustomPreset[];
  getRepo?: RepoLookup;
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

function restoreStagedMove(
  move: typeof moveDir,
  temp: string,
  source: string,
  destination: string,
): void {
  if (path.dirname(destination).toLowerCase() === source.toLowerCase() && existsSync(source)) {
    rmdirSync(source);
  }
  move(temp, source);
}

function addOccupiedTargetCollision(
  result: ReorganizeResult,
  move: ReorganizeJournal["moves"][number],
) {
  result.collisions.push({ key: move.key, target: move.to, occupiedBy: "(on disk)" });
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

  if (
    !isPresetId(journal.preset) &&
    !options.customPresets?.some((preset) => preset.id === journal.preset)
  )
    throw new Error(
      `unknown preset in reorganize journal: ${journal.preset}; restore the preset definition before resuming`,
    );

  const result: ReorganizeResult = { moved: [], skipped: [], failed: [], collisions: [] };
  const successfulMoves: Array<{ key: string; from: string; to: string }> = [];

  for (const move of journal.moves) {
    const isCaseOnly = move.from.toLowerCase() === move.to.toLowerCase() && move.from !== move.to;

    if (move.tmpPath) {
      const tmpAbs = path.join(root, ...move.tmpPath.split("/"));
      if (existsFn(tmpAbs)) {
        const fromAbs = path.join(root, ...move.from.split("/"));
        try {
          restoreStagedMove(moveFn, tmpAbs, fromAbs, path.join(root, ...move.to.split("/")));
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
      const fromAbs = path.join(root, ...move.from.split("/"));
      const toAbs = path.join(root, ...move.to.split("/"));
      const bothDistinctPathsExist =
        existsFn(fromAbs) && existsFn(toAbs) && !sameDirectoryIdentity(fromAbs, toAbs);
      if (bothDistinctPathsExist) {
        addOccupiedTargetCollision(result, move);
      } else if (actual === move.to && isRecordedDestination(move, toAbs)) {
        successfulMoves.push({ key: move.key, from: move.from, to: move.to });
        result.moved.push({ key: move.key, from: move.from, to: move.to });
      } else if (actual === move.from) {
        result.skipped.push({ key: move.key, reason: "pending move left at source" });
      } else if (actual === move.to) {
        addOccupiedTargetCollision(result, move);
      } else {
        result.failed.push({ key: move.key, message: "source and destination both missing" });
      }
      continue;
    }

    const srcAbs = path.join(root, ...move.from.split("/"));
    const destAbs = path.join(root, ...move.to.split("/"));
    const sourceExists = existsFn(srcAbs);
    const destinationExists = existsFn(destAbs);
    if (sourceExists && destinationExists) {
      addOccupiedTargetCollision(result, move);
      continue;
    }
    if (destinationExists && !sourceExists && isRecordedDestination(move, destAbs)) {
      successfulMoves.push({ key: move.key, from: move.from, to: move.to });
      result.moved.push({ key: move.key, from: move.from, to: move.to });
      continue;
    }

    if (destinationExists) {
      addOccupiedTargetCollision(result, move);
    } else if (sourceExists) {
      result.skipped.push({ key: move.key, reason: "pending move left at source" });
    } else {
      result.failed.push({ key: move.key, message: "source and destination both missing" });
    }
  }

  const moveMap = new Map(successfulMoves.map((m) => [m.key.toLowerCase(), m.to] as const));
  const oldPathsByKey = new Map(journal.moves.map((m) => [m.key.toLowerCase(), m.from] as const));
  const forkOwners = new Map(
    journal.moves.map((move) => [move.key.toLowerCase(), move.forkSourceOwner]),
  );

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
        const key = `${entry.owner}/${entry.name}`.toLowerCase();
        const target = moveMap.get(key);
        if (target === undefined) return entry;
        const forkSourceOwner = forkOwners.get(key);
        return {
          ...entry,
          relativePath: target,
          ...(forkSourceOwner ? { forkSourceOwner } : {}),
          ...(forkSourceOwner && entry.category === "source" ? { category: "forks" as const } : {}),
          ...(entry.custom === true ? { custom: false } : {}),
        };
      });
      for (const move of journal.moves) {
        const adopted = move.adopted;
        if (
          adopted &&
          moveMap.has(move.key.toLowerCase()) &&
          !repos.some((entry) => repoKeyEquals(entry, adopted.owner, adopted.name))
        ) {
          repos.push(adopted);
        }
      }
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
  const journalMoveKeys = new Set(journal.moves.map((move) => move.key.toLowerCase()));
  const hasFailedJournalMove = result.failed.some((failure) =>
    journalMoveKeys.has(failure.key.toLowerCase()),
  );
  const hasCollidingJournalMove = result.collisions.some((collision) =>
    journalMoveKeys.has(collision.key.toLowerCase()),
  );
  if (!hasUnrecoveredTmp && !hasFailedJournalMove && !hasCollidingJournalMove) {
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
  const result: ReorganizeResult = { moved: [], skipped: [], failed: [], collisions: [] };
  const discovered = options.scan === true ? await scanForRepos(root) : [];
  const entries = buildPlanEntries(root, config, discovered, existsFn, result);
  if (newPreset === "categorized" && options.getRepo !== undefined) {
    await resolveCategorizedForks(entries, options.getRepo, options.keepCustom === true);
  }
  const occupied = new Map<string, string>();
  for (const entry of entries) {
    occupied.set(entry.relativePath.toLowerCase(), entry.key);
  }

  interface PlannedMove {
    entry: PlanEntry;
    targetRel: string;
    srcAbs: string;
    destAbs: string;
    needsTemp: boolean;
  }

  const plannedMoves: PlannedMove[] = [];
  const reservedTargets = new Map<string, string>();
  const settled = new Map<string, string>();

  for (const entry of entries) {
    const srcAbs = path.join(root, ...entry.relativePath.split("/"));
    if (options.keepCustom === true && entry.custom) {
      settled.set(entry.key.toLowerCase(), entry.relativePath);
      result.skipped.push({ key: entry.key, reason: "custom placement kept" });
      continue;
    }

    if (
      newPreset === "categorized" &&
      entry.isFork &&
      !entry.isArchived &&
      !entry.forkSourceOwner
    ) {
      if (existsFn(srcAbs)) settled.set(entry.key.toLowerCase(), entry.relativePath);
      result.skipped.push({ key: entry.key, reason: "fork source owner unavailable" });
      continue;
    }

    const segments = targetSegmentsForPreset(
      entry,
      newPreset,
      entry.internal,
      options.customPresets,
    );
    const targetRel = segments.join("/");
    const destAbs = path.join(root, ...segments);
    try {
      workspacePath(root, entry.relativePath);
      workspacePath(root, targetRel);
    } catch (error) {
      result.failed.push({ key: entry.key, message: firstErrorLine(error) });
      continue;
    }

    if (options.existsSyncImpl === undefined && repositoryMoveProblem(srcAbs)) {
      result.skipped.push({ key: entry.key, reason: "linked git worktree kept" });
      continue;
    }

    const isExactSame = entry.relativePath === targetRel;
    const isCaseOnly = entry.relativePath.toLowerCase() === targetRel.toLowerCase() && !isExactSame;

    if (isExactSame) {
      if (existsFn(srcAbs)) settled.set(entry.key.toLowerCase(), targetRel);
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

    const belowSource = targetRel.toLowerCase().startsWith(`${entry.relativePath.toLowerCase()}/`);
    const reserved = reservedTargets.get(targetRel.toLowerCase());
    if (reserved !== undefined) {
      result.collisions.push({ key: entry.key, target: targetRel, occupiedBy: reserved });
      continue;
    }
    reservedTargets.set(targetRel.toLowerCase(), entry.key);
    plannedMoves.push({ entry, targetRel, srcAbs, destAbs, needsTemp: isCaseOnly || belowSource });
  }

  // A former fork checkout can occupy the directory that will become a source-owner group.
  const pending = [...plannedMoves];
  plannedMoves.length = 0;
  const futureOccupied = new Map(occupied);
  while (pending.length > 0) {
    const index = pending.findIndex(({ entry, targetRel }) => {
      const blocker = occupiedParent(targetRel, futureOccupied);
      return blocker === undefined || blocker === entry.relativePath.toLowerCase();
    });
    if (index < 0) break;
    const [next] = pending.splice(index, 1) as [PlannedMove];
    plannedMoves.push(next);
    futureOccupied.delete(next.entry.relativePath.toLowerCase());
    futureOccupied.set(next.targetRel.toLowerCase(), next.entry.key);
  }
  for (const { entry, targetRel } of pending) {
    const blocker = occupiedParent(targetRel, futureOccupied)!;
    result.collisions.push({
      key: entry.key,
      target: targetRel,
      occupiedBy: futureOccupied.get(blocker)!,
    });
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
      sourceIdentity: directoryIdentity(p.srcAbs) ?? undefined,
      ...(p.entry.forkSourceOwner ? { forkSourceOwner: p.entry.forkSourceOwner } : {}),
      ...(!p.entry.tracked ? { adopted: adoptedEntry(p.entry, p.targetRel) } : {}),
    })),
  };
  writeReorganizeJournalAtomically(root, journal);

  for (const plan of plannedMoves) {
    const blocker = occupiedParent(plan.targetRel, occupied);
    if (blocker !== undefined && blocker !== plan.entry.relativePath.toLowerCase()) {
      result.collisions.push({
        key: plan.entry.key,
        target: plan.targetRel,
        occupiedBy: occupied.get(blocker)!,
      });
      continue;
    }
    const journalEntry = journal.moves.find((m) => m.key === plan.entry.key);
    try {
      if (plan.needsTemp) {
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
            restoreStagedMove(moveFn, tmpAbs, plan.srcAbs, plan.destAbs);
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
  const updatedPaths = new Map([...settled, ...moveMap]);
  const entriesByKey = new Map(entries.map((entry) => [entry.key.toLowerCase(), entry]));
  const oldPathsByKey = new Map(
    config.repos.map(
      (entry) => [`${entry.owner}/${entry.name}`.toLowerCase(), entry.relativePath] as const,
    ),
  );

  await updateWorkspace(
    root,
    (current) => {
      let currentWorking = { ...current };
      const currentAliases: Record<string, string> = { ...(currentWorking.aliases ?? {}) };
      for (const [alias, target] of Object.entries(currentAliases)) {
        for (const [key, relativePath] of updatedPaths) {
          const oldPath = oldPathsByKey.get(key);
          if (oldPath !== undefined && oldPath.toLowerCase() === target.toLowerCase()) {
            currentAliases[alias] = relativePath;
          }
        }
      }
      const repos = currentWorking.repos.map((entry) => {
        const key = `${entry.owner}/${entry.name}`.toLowerCase();
        const target = updatedPaths.get(key);
        const planned = entriesByKey.get(key);
        const forkSourceOwner = entry.forkSourceOwner ?? planned?.forkSourceOwner;
        const category = planned?.isFork && entry.category === "source" ? "forks" : entry.category;
        if (
          (target === undefined || target === entry.relativePath) &&
          category === entry.category &&
          forkSourceOwner === entry.forkSourceOwner
        )
          return entry;
        return {
          ...entry,
          relativePath: target ?? entry.relativePath,
          category,
          ...(forkSourceOwner ? { forkSourceOwner } : {}),
          ...(entry.custom === true && moveMap.has(key) ? { custom: false } : {}),
        };
      });
      currentWorking = {
        ...currentWorking,
        preset: newPreset,
        repos,
        ...(Object.keys(currentAliases).length > 0 ? { aliases: currentAliases } : {}),
      };
      for (const entry of entries) {
        const relativePath = updatedPaths.get(entry.key.toLowerCase());
        if (
          !entry.tracked &&
          relativePath !== undefined &&
          !repos.some((repo) => repoKeyEquals(repo, entry.owner, entry.name))
        ) {
          repos.push(adoptedEntry(entry, relativePath));
        }
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
  const journalMoveKeys = new Set(journal.moves.map((move) => move.key.toLowerCase()));
  const hasFailedJournalMove = result.failed.some((failure) =>
    journalMoveKeys.has(failure.key.toLowerCase()),
  );
  const hasCollidingJournalMove = result.collisions.some((collision) =>
    journalMoveKeys.has(collision.key.toLowerCase()),
  );
  if (!hasUnrecoveredTmp && !hasFailedJournalMove && !hasCollidingJournalMove) {
    deleteReorganizeJournal(root);
  }
  return result;
}

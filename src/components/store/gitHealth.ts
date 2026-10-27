import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { simpleGit } from "simple-git";
import { createCloneLimiter } from "../../services/cloner.ts";
import type { RepotruckConfig } from "../../services/config.ts";
import { runDoctor } from "../../services/doctor.ts";
import { collectDetailedGitStatus, parsePorcelainV2 } from "../../services/gitState.ts";
import { calculateWorkspaceStats, walkRepositoriesOnDisk } from "../../services/stats.ts";
import { listTrashEntries } from "../../services/trash.ts";
import { isLinkedWorktree } from "../../services/worktree.ts";
import type { HealthPanelData, InspectorState, RepoLocalHealth } from "./types.ts";

const execFileAsync = promisify(execFile);

export function buildFastLocalHealthMap(
  root: string,
  config: RepotruckConfig,
): { map: Map<string, RepoLocalHealth>; pinnedCount: number } {
  const aliasByPath = new Map<string, string>();
  for (const [alias, target] of Object.entries(config.aliases ?? {})) {
    if (!aliasByPath.has(target.toLowerCase())) {
      aliasByPath.set(target.toLowerCase(), alias);
    }
  }
  const pinnedSet = new Set((config.pinned ?? []).map((k) => k.toLowerCase()));
  const map = new Map<string, RepoLocalHealth>();

  for (const entry of config.repos) {
    const keyLower = `${entry.owner}/${entry.name}`.toLowerCase();
    const absDir = path.join(root, ...entry.relativePath.split("/"));
    const onDisk = existsSync(absDir);
    const worktree = onDisk ? isLinkedWorktree(absDir) : false;
    map.set(keyLower, {
      tracked: true,
      relativePath: entry.relativePath,
      alias: aliasByPath.get(entry.relativePath.toLowerCase()) ?? null,
      pinned: pinnedSet.has(keyLower),
      custom: entry.custom === true,
      missing: !onDisk,
      dirty: false,
      ahead: 0,
      behind: 0,
      branch: null,
      worktree,
    });
  }

  return { map, pinnedCount: pinnedSet.size };
}

export async function hydrateAsyncGitHealth(
  root: string,
  config: RepotruckConfig,
  initialMap: ReadonlyMap<string, RepoLocalHealth>,
  isCancelled: () => boolean,
): Promise<Map<string, RepoLocalHealth> | null> {
  const next = new Map(initialMap);
  const limit = createCloneLimiter(4);
  let changed = false;

  await Promise.all(
    config.repos.map((entry) =>
      limit(async () => {
        if (isCancelled()) return;
        const keyLower = `${entry.owner}/${entry.name}`.toLowerCase();
        const existing = next.get(keyLower);
        if (!existing || existing.missing) return;
        const absDir = path.join(root, ...entry.relativePath.split("/"));
        if (!existsSync(path.join(absDir, ".git"))) return;
        try {
          // Use `git -C <absDir>` without setting child `cwd = absDir` so Windows
          // never locks the repository directory during concurrent move/delete.
          const { stdout } = await execFileAsync(
            "git",
            ["-C", absDir, "status", "--porcelain=v2", "--branch", "--untracked-files=normal"],
            { timeout: 5000, windowsHide: true },
          );
          if (isCancelled()) return;
          const parsed = parsePorcelainV2(stdout);
          const dirty = parsed.modifiedPaths.length > 0 || parsed.untrackedPaths.length > 0;
          const branch = parsed.branch || null;
          if (dirty || parsed.ahead > 0 || parsed.behind > 0 || branch !== null) {
            changed = true;
            next.set(keyLower, {
              ...existing,
              dirty,
              ahead: parsed.ahead,
              behind: parsed.behind,
              branch,
            });
          }
        } catch {
          /* ignore non-git or unreadable directories */
        }
      }),
    ),
  );

  if (isCancelled()) return null;
  return changed ? next : null;
}

export async function loadRepoInspectorDetails(
  root: string,
  config: RepotruckConfig,
  key: string,
): Promise<InspectorState> {
  const keyLower = key.toLowerCase();
  const entry = config.repos.find((r) => `${r.owner}/${r.name}`.toLowerCase() === keyLower);
  const pinnedSet = new Set((config.pinned ?? []).map((k) => k.toLowerCase()));
  if (entry === undefined) {
    return {
      key,
      loading: false,
      tracked: false,
      relativePath: null,
      alias: null,
      pinned: pinnedSet.has(keyLower),
      missing: false,
      worktree: false,
      details: null,
    };
  }

  const alias =
    Object.entries(config.aliases ?? {}).find(
      ([, target]) => target.toLowerCase() === entry.relativePath.toLowerCase(),
    )?.[0] ?? null;
  const absDir = path.join(root, ...entry.relativePath.split("/"));
  if (!existsSync(absDir)) {
    return {
      key,
      loading: false,
      tracked: true,
      relativePath: entry.relativePath,
      alias,
      pinned: pinnedSet.has(keyLower),
      missing: true,
      worktree: false,
      details: null,
    };
  }

  const worktree = isLinkedWorktree(absDir);
  let details = null;
  if (existsSync(path.join(absDir, ".git"))) {
    try {
      details = await collectDetailedGitStatus(simpleGit(absDir));
    } catch {
      details = null;
    }
  }

  return {
    key,
    loading: false,
    tracked: true,
    relativePath: entry.relativePath,
    alias,
    pinned: pinnedSet.has(keyLower),
    missing: false,
    worktree,
    details,
  };
}

export async function loadWorkspaceHealthData(
  root: string,
  config: RepotruckConfig,
): Promise<HealthPanelData> {
  const disk = walkRepositoriesOnDisk(root);
  const stats = calculateWorkspaceStats(config, disk);
  const trashed = listTrashEntries(root);
  const trashBytes = trashed.reduce((sum, item) => sum + item.sizeBytes, 0);
  const doctor = await runDoctor();
  return {
    loading: false,
    stats,
    trashCount: trashed.length,
    trashBytes,
    checks: doctor.checks,
  };
}

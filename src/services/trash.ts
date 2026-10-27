import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { EnvLike } from "./config.ts";
import { workspaceTrashDir } from "./lifecycle.ts";
import { moveDir } from "./mover.ts";
import { parseGitUrl } from "./singleCloner.ts";
import {
  loadWorkspace,
  targetDirFor,
  toPosixRelative,
  updateWorkspace,
  upsertInventory,
} from "./workspace.ts";

export interface TrashEntry {
  id: string;
  dirName: string;
  absPath: string;
  owner: string;
  name: string;
  trashedAt: string;
  timestampMs: number;
  sizeBytes: number;
}

function computeDirSize(dir: string, depth = 0): number {
  if (depth > 12) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += computeDirSize(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
          /* ignore unreadable file */
        }
      }
    }
  } catch {
    /* ignore unreadable directory */
  }
  return total;
}

function readGitOriginOwnerName(repoDir: string): { owner: string; name: string } | null {
  try {
    const gitConfigPath = path.join(repoDir, ".git", "config");
    if (!existsSync(gitConfigPath)) return null;
    const raw = readFileSync(gitConfigPath, "utf8");
    const remoteSection = raw.match(/\[remote\s+"origin"\]([\s\S]*?)(?:\n\[|$)/);
    const body = remoteSection ? remoteSection[1]! : raw;
    const urlMatch = body.match(/^\s*url\s*=\s*(.+)$/m);
    if (!urlMatch) return null;
    const parsed = parseGitUrl(urlMatch[1]!.trim());
    return parsed ? { owner: parsed.owner, name: parsed.name } : null;
  } catch {
    return null;
  }
}

export function parseTrashDirName(
  dirName: string,
  absPath?: string,
  fallbackMtimeMs: number = Date.now(),
): { owner: string; name: string; timestampMs: number } {
  const tsMatch = dirName.match(/^(.+)-(\d{10,})$/);
  const timestampMs = tsMatch ? Number.parseInt(tsMatch[2]!, 10) : Math.floor(fallbackMtimeMs);
  const stem = tsMatch ? tsMatch[1]! : dirName;

  if (absPath !== undefined) {
    const fromGit = readGitOriginOwnerName(absPath);
    if (fromGit !== null) {
      return { owner: fromGit.owner, name: fromGit.name, timestampMs };
    }
  }

  const dashIdx = stem.indexOf("-");
  if (dashIdx > 0 && dashIdx < stem.length - 1) {
    return {
      owner: stem.slice(0, dashIdx),
      name: stem.slice(dashIdx + 1),
      timestampMs,
    };
  }
  return {
    owner: "unknown",
    name: stem,
    timestampMs,
  };
}

export function listTrashEntries(root: string): TrashEntry[] {
  const trashRoot = workspaceTrashDir(path.resolve(root));
  if (!existsSync(trashRoot)) return [];

  let items: Dirent<string>[];
  try {
    items = readdirSync(trashRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const entries: TrashEntry[] = [];
  for (const item of items) {
    if (!item.isDirectory() || item.isSymbolicLink()) continue;
    const dirName = item.name;
    const absPath = path.join(trashRoot, dirName);
    let mtimeMs = Date.now();
    try {
      mtimeMs = statSync(absPath).mtimeMs;
    } catch {
      /* ignore */
    }
    const parsed = parseTrashDirName(dirName, absPath, mtimeMs);
    entries.push({
      id: dirName,
      dirName,
      absPath,
      owner: parsed.owner,
      name: parsed.name,
      trashedAt: new Date(parsed.timestampMs).toISOString(),
      timestampMs: parsed.timestampMs,
      sizeBytes: computeDirSize(absPath),
    });
  }

  entries.sort((a, b) => b.timestampMs - a.timestampMs || a.dirName.localeCompare(b.dirName));
  return entries;
}

export interface RestoreTrashOptions {
  internal?: boolean;
  env?: EnvLike;
  moveImpl?: (src: string, dest: string) => void;
}

export interface RestoreTrashResult {
  ok: boolean;
  entry?: TrashEntry;
  restoredTo?: string;
  message: string;
}

export async function restoreTrashEntry(
  root: string,
  selector: string,
  options: RestoreTrashOptions = {},
): Promise<RestoreTrashResult> {
  const resolvedRoot = path.resolve(root);
  const trimmed = selector.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "selector is required (use <id> or <owner/name>)" };
  }

  const entries = listTrashEntries(resolvedRoot);
  const lower = trimmed.toLowerCase();
  const match =
    entries.find((e) => e.id.toLowerCase() === lower) ??
    entries.find((e) => `${e.owner}/${e.name}`.toLowerCase() === lower) ??
    entries.find((e) => e.name.toLowerCase() === lower);

  if (match === undefined) {
    return { ok: false, message: `no matching trashed repository found for '${trimmed}'` };
  }

  const config = await loadWorkspace(resolvedRoot, undefined, options.env);
  const internal = options.internal ?? true;
  const targetAbs = targetDirFor(
    resolvedRoot,
    {
      owner: match.owner,
      name: match.name,
      isArchived: false,
      isFork: false,
      language: null,
    },
    config.preset,
    internal,
  );
  const targetRel = toPosixRelative(resolvedRoot, targetAbs);

  if (existsSync(targetAbs)) {
    return {
      ok: false,
      entry: match,
      message: `cannot restore ${match.owner}/${match.name}: destination already exists (${targetRel})`,
    };
  }

  const move = options.moveImpl ?? moveDir;
  move(match.absPath, targetAbs);

  await updateWorkspace(
    resolvedRoot,
    (current) => ({
      config: upsertInventory(
        current,
        {
          owner: match.owner,
          name: match.name,
          isArchived: false,
          isFork: false,
          language: null,
          updatedAt: new Date().toISOString(),
        },
        targetRel,
        internal,
      ),
      result: undefined,
    }),
    options.env,
  );

  return {
    ok: true,
    entry: match,
    restoredTo: targetRel,
    message: `restored ${match.owner}/${match.name} to ${targetRel}`,
  };
}

export interface EmptyTrashOptions {
  olderThanDays?: number;
  now?: number;
  rmImpl?: (target: string) => void;
}

export interface EmptyTrashResult {
  removed: TrashEntry[];
  kept: TrashEntry[];
  freedBytes: number;
}

export function emptyTrash(root: string, options: EmptyTrashOptions = {}): EmptyTrashResult {
  const resolvedRoot = path.resolve(root);
  const entries = listTrashEntries(resolvedRoot);
  const now = options.now ?? Date.now();
  const minAgeMs =
    options.olderThanDays !== undefined ? Math.max(0, options.olderThanDays) * 86_400_000 : null;
  const rm =
    options.rmImpl ?? ((target: string) => rmSync(target, { recursive: true, force: true }));

  const removed: TrashEntry[] = [];
  const kept: TrashEntry[] = [];
  let freedBytes = 0;

  for (const entry of entries) {
    if (minAgeMs !== null && now - entry.timestampMs < minAgeMs) {
      kept.push(entry);
      continue;
    }
    rm(entry.absPath);
    removed.push(entry);
    freedBytes += entry.sizeBytes;
  }

  return { removed, kept, freedBytes };
}

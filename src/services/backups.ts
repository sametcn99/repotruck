import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RepotruckConfig } from "./config.ts";

export const DEFAULT_BACKUP_GENERATIONS = 5;
export const WORKSPACE_STATE_DIRNAME = ".repotruck";
export const BACKUPS_DIRNAME = "backups";

export function workspaceBackupsDir(root: string): string {
  return path.join(root, WORKSPACE_STATE_DIRNAME, BACKUPS_DIRNAME);
}

const BACKUP_FILENAME_PATTERN =
  /^repotruck-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?\.json$/;

function backupStamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 19)}-${iso.slice(20, 23)}Z`.replace(/:/g, "-");
}

export interface WorkspaceBackupEntry {
  file: string;
  absPath: string;
  createdAt: string;
  repoCount: number;
}

function isBackupFilename(name: string): boolean {
  return BACKUP_FILENAME_PATTERN.test(name);
}

export async function listWorkspaceSnapshots(root: string): Promise<WorkspaceBackupEntry[]> {
  let names: string[];
  try {
    names = (await readdir(workspaceBackupsDir(root))).filter(isBackupFilename);
  } catch {
    return [];
  }
  const entries: WorkspaceBackupEntry[] = [];
  for (const name of names) {
    const absPath = path.join(workspaceBackupsDir(root), name);
    try {
      const parsed: unknown = JSON.parse(await readFile(absPath, "utf8"));
      const repoCount =
        parsed !== null &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { repos?: unknown }).repos)
          ? (parsed as { repos: unknown[] }).repos.length
          : 0;
      entries.push({ file: name, absPath, createdAt: createdAtFromName(name), repoCount });
    } catch {
      entries.push({ file: name, absPath, createdAt: createdAtFromName(name), repoCount: 0 });
    }
  }
  entries.sort((a, b) => compareBackupFilenames(b.file, a.file));
  return entries;
}

function counterFromName(name: string): number {
  const match = name.match(/-(\d+)\.json$/);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

function compareBackupFilenames(a: string, b: string): number {
  const stampA = createdAtFromName(a);
  const stampB = createdAtFromName(b);
  if (stampA !== stampB) {
    return stampA < stampB ? -1 : 1;
  }
  return counterFromName(a) - counterFromName(b);
}

function createdAtFromName(name: string): string {
  const core = name.replace(/^repotruck-/, "").replace(/(?:-\d+)?\.json$/, "");
  const stamp = `${core.slice(0, 10)}T${core.slice(11, 13)}:${core.slice(14, 16)}:${core.slice(17, 19)}.${core.slice(20, 23)}Z`;
  return stamp;
}

let backupWriteCounter = 0;

export interface WriteWorkspaceSnapshotOptions {
  generations?: number;
  now?: () => Date;
}

export async function writeWorkspaceSnapshot(
  root: string,
  config: RepotruckConfig,
  options?: WriteWorkspaceSnapshotOptions,
): Promise<string> {
  const generations = Math.max(1, options?.generations ?? DEFAULT_BACKUP_GENERATIONS);
  const dir = workspaceBackupsDir(root);
  await mkdir(dir, { recursive: true });

  const base = backupStamp((options?.now ?? (() => new Date()))());
  let name = `repotruck-${base}.json`;
  let target = path.join(dir, name);
  let counter = 0;
  for (;;) {
    try {
      await readFile(target);
      counter += 1;
      name = `repotruck-${base}-${counter}.json`;
      target = path.join(dir, name);
    } catch {
      break;
    }
  }

  backupWriteCounter += 1;
  const tmp = `${target}.tmp-${process.pid}-${backupWriteCounter}`;
  try {
    await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  } catch (error) {
    try {
      await rm(tmp, { force: true });
    } catch {
      /* best effort cleanup */
    }
    throw error;
  }

  const existing = (await readdir(dir)).filter(isBackupFilename).sort(compareBackupFilenames);
  const excess = existing.length - generations;
  for (let i = 0; i < excess; i += 1) {
    try {
      await rm(path.join(dir, existing[i]!), { force: true });
    } catch {
      /* a stale backup lingering is harmless */
    }
  }

  return target;
}

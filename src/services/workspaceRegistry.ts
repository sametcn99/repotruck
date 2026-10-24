import { existsSync, realpathSync } from "node:fs";
import { copyFile, mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isPresetRef, type PresetRef } from "../presets/index.ts";
import { parsePresetFromAgentsMd } from "./agentsMd.ts";
import { listWorkspaceSnapshots, writeWorkspaceSnapshot } from "./backups.ts";
import {
  appConfigDir,
  CONFIG_FILENAME,
  type EnvLike,
  isRepotruckConfig,
  type RepotruckConfig,
  readAgentsMd,
} from "./config.ts";
import { writeFileAtomic } from "./fsUtils.ts";
import {
  applyStoreMigrations,
  CorruptStoreError,
  LATEST_STORE_VERSION,
  NewerStoreVersionError,
  validateStoreEnvelope,
} from "./storeMigrations.ts";
import { withWorkspaceLock } from "./workspaceLock.ts";

export const LEGACY_WORKSPACES_FILENAME = "workspaces.json";

export interface WorkspaceEntry extends RepotruckConfig {
  lastUsed: string;
}

export interface WorkspaceRecord {
  path: string;
  preset: PresetRef;
  lastSync: string | null;
  repoCount: number;
  lastUsed: string;
}

export type WorkspaceListing = WorkspaceRecord & { missing: boolean };

interface CentralStore {
  version: number;
  workspaces: WorkspaceEntry[];
}

export function centralStorePath(env?: EnvLike): string {
  return path.join(appConfigDir(env ?? process.env), CONFIG_FILENAME);
}

function pathsEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (process.platform === "win32") {
    if (a.toLowerCase() === b.toLowerCase()) return true;
    try {
      const na = realpathSync.native ? realpathSync.native(a).toLowerCase() : a.toLowerCase();
      const nb = realpathSync.native ? realpathSync.native(b).toLowerCase() : b.toLowerCase();
      return na === nb;
    } catch {
      return false;
    }
  }
  return false;
}

async function realpathSafe(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
}

function isWorkspaceEntry(value: unknown): value is WorkspaceEntry {
  if (!isRepotruckConfig(value)) return false;
  return typeof (value as Partial<WorkspaceEntry>).lastUsed === "string";
}

async function readLegacyManifestEntries(env?: EnvLike): Promise<WorkspaceEntry[]> {
  try {
    const file = path.join(appConfigDir(env ?? process.env), LEGACY_WORKSPACES_FILENAME);
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    const entries: WorkspaceEntry[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== "object") continue;
      const record = item as Partial<WorkspaceRecord>;
      if (typeof record.path !== "string" || !isPresetRef(record.preset)) continue;
      if (typeof record.lastUsed !== "string") continue;
      entries.push({
        version: 1,
        root: record.path,
        preset: record.preset,
        lastSync: record.lastSync === undefined ? null : record.lastSync,
        repos: [],
        lastUsed: record.lastUsed,
      });
    }
    return entries;
  } catch {
    return [];
  }
}

function firstLine(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  const [line = ""] = text.split(/\r?\n/);
  return line;
}

async function backupStoreFile(file: string): Promise<string> {
  const backup = `${file}.bak`;
  // The first corruption's forensic copy is kept: a later write of the .bak
  // must not clobber the preserved bytes users may still recover from.
  if (!existsSync(backup)) {
    await copyFile(file, backup);
  }
  return backup;
}

export class CentralStoreReadError extends Error {
  readonly storePath: string;

  constructor(reason: string, storePath: string) {
    super(`could not read ${path.basename(storePath)} (${reason})`);
    this.name = "CentralStoreReadError";
    this.storePath = storePath;
  }
}

export interface ReadWorkspaceEntriesDeps {
  readFile?: typeof readFile;
}

/**
 * In-process read cache for the central store. Parsing the whole multi-
 * workspace JSON is the dominant cost of every command, so completed reads
 * are cached keyed on the file's mtime and invalidated by writes (our own or
 * another process's). Skipped entirely when a test injects readFile.
 */
let storeReadCache: { file: string; mtimeMs: number; entries: WorkspaceEntry[] } | null = null;

async function storeMtimeMs(file: string): Promise<number> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return -1;
  }
}

export async function readWorkspaceEntries(
  env?: EnvLike,
  deps?: ReadWorkspaceEntriesDeps,
): Promise<WorkspaceEntry[]> {
  const file = centralStorePath(env);
  if (deps?.readFile === undefined && storeReadCache?.file === file) {
    const mtimeMs = await storeMtimeMs(file);
    if (mtimeMs >= 0 && mtimeMs === storeReadCache.mtimeMs) {
      return [...storeReadCache.entries];
    }
    storeReadCache = null;
  }
  const readFileImpl = deps?.readFile ?? readFile;
  let raw: string | undefined;
  try {
    raw = (await readFileImpl(file, "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code !== "ENOENT") {
      throw new CentralStoreReadError(firstLine(error), file);
    }
    /* missing central store: fall through to the legacy manifest */
  }
  const entries: WorkspaceEntry[] = [];
  if (raw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const backup = await backupStoreFile(file);
      throw new CorruptStoreError(`invalid JSON (${firstLine(error)})`, file, backup);
    }
    const envelope = validateStoreEnvelope(parsed);
    if (!envelope.ok) {
      const backup = await backupStoreFile(file);
      throw new CorruptStoreError(envelope.reason, file, backup);
    }
    if (envelope.store.version > LATEST_STORE_VERSION) {
      const backup = await backupStoreFile(file);
      throw new NewerStoreVersionError(envelope.store.version, LATEST_STORE_VERSION, file, backup);
    }
    const store = applyStoreMigrations(envelope.store);
    entries.push(...store.workspaces.filter(isWorkspaceEntry));
  }
  for (const legacy of await readLegacyManifestEntries(env)) {
    if (!entries.some((entry) => pathsEqual(entry.root, legacy.root))) {
      entries.push(legacy);
    }
  }
  if (deps?.readFile === undefined) {
    storeReadCache = { file, mtimeMs: await storeMtimeMs(file), entries: [...entries] };
  }
  return entries;
}

async function writeWorkspaceEntries(
  entries: readonly WorkspaceEntry[],
  env?: EnvLike,
): Promise<void> {
  const file = centralStorePath(env);
  await mkdir(path.dirname(file), { recursive: true });
  const store: CentralStore = { version: LATEST_STORE_VERSION, workspaces: [...entries] };
  await writeFileAtomic(file, `${JSON.stringify(store, null, 2)}\n`);
  storeReadCache = { file, mtimeMs: await storeMtimeMs(file), entries: [...entries] };
}

export async function readWorkspaceConfig(
  root: string,
  env?: EnvLike,
): Promise<RepotruckConfig | null> {
  const resolved = await realpathSafe(root);
  const entries = await readWorkspaceEntries(env);
  const entry = entries.find((item) => pathsEqual(item.root, resolved));
  return entry === undefined ? null : entry;
}

export async function writeWorkspaceConfig(
  root: string,
  config: RepotruckConfig,
  env?: EnvLike,
): Promise<void> {
  await withWorkspaceLock(
    async () => {
      const resolved = await realpathSafe(root);
      const entry: WorkspaceEntry = {
        ...config,
        root: resolved,
        lastUsed: new Date().toISOString(),
      };
      const entries = await readWorkspaceEntries(env);
      const index = entries.findIndex((item) => pathsEqual(item.root, resolved));
      if (index >= 0) {
        try {
          await writeWorkspaceSnapshot(resolved, entries[index]!);
        } catch {
          /* a missing snapshot must never block the save */
        }
      }
      const next =
        index >= 0 ? entries.map((item, i) => (i === index ? entry : item)) : [...entries, entry];
      await writeWorkspaceEntries(next, env);
    },
    { env },
  );
}

export async function listWorkspaces(env?: EnvLike): Promise<WorkspaceListing[]> {
  const entries = await readWorkspaceEntries(env);
  const sorted = [...entries].sort((a, b) =>
    a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : 0,
  );
  return sorted.map((entry) => ({
    path: entry.root,
    preset: entry.preset,
    lastSync: entry.lastSync,
    repoCount: entry.repos.length,
    lastUsed: entry.lastUsed,
    missing: !existsSync(entry.root),
  }));
}

export async function removeWorkspace(
  rootToRemove: string,
  env?: EnvLike,
): Promise<WorkspaceEntry | null> {
  const resolved = await realpathSafe(rootToRemove);
  return withWorkspaceLock(
    async () => {
      const entries = await readWorkspaceEntries(env);
      const index = entries.findIndex((item) => pathsEqual(item.root, resolved));
      if (index < 0) return null;
      const removed = entries[index]!;
      await writeWorkspaceEntries(
        entries.filter((_, entryIndex) => entryIndex !== index),
        env,
      );
      return removed;
    },
    { env },
  );
}

export async function isRegisteredWorkspace(root: string, env?: EnvLike): Promise<boolean> {
  return (await readWorkspaceConfig(root, env)) !== null;
}

export interface SnapshotRestoreResult {
  ok: boolean;
  message: string;
  restored?: RepotruckConfig;
}

/** Restores a workspace config from one of its timestamped snapshots. */
export async function restoreWorkspaceSnapshot(
  root: string,
  file: string,
  env?: EnvLike,
): Promise<SnapshotRestoreResult> {
  const snapshots = await listWorkspaceSnapshots(root);
  const match = snapshots.find((entry) => entry.file === file || entry.file === `${file}.json`);
  if (match === undefined) {
    return {
      ok: false,
      message: `snapshot not found: ${file} (${snapshots.length} snapshots available — see 'repotruck backup list')`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(match.absPath, "utf8"));
  } catch (error) {
    return { ok: false, message: `snapshot is not valid JSON: ${firstLine(error)}` };
  }
  if (!isRepotruckConfig(parsed)) {
    return { ok: false, message: `snapshot is not a valid workspace config: ${match.file}` };
  }
  await writeWorkspaceConfig(root, parsed, env);
  const restored = await readWorkspaceConfig(root, env);
  if (restored === null) {
    return {
      ok: false,
      message: `restore wrote the snapshot but the record is missing: ${match.file}`,
    };
  }
  return {
    ok: true,
    message: `restored ${restored.repos.length} repositories from ${match.file}`,
    restored,
  };
}

export async function resolveWorkspaceRoot(
  startDir: string,
  env?: EnvLike,
): Promise<{ root: string; found: boolean }> {
  const entries = await readWorkspaceEntries(env);
  let dir = await realpathSafe(startDir);
  for (;;) {
    const match = entries.find((entry) => pathsEqual(entry.root, dir));
    if (match !== undefined) {
      return { root: match.root, found: true };
    }
    if (existsSync(path.join(dir, CONFIG_FILENAME))) {
      return { root: dir, found: true };
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return { root: path.resolve(startDir), found: false };
    }
    dir = parent;
  }
}

export async function readLegacyWorkspaceConfig(root: string): Promise<RepotruckConfig | null> {
  try {
    const raw = (await readFile(path.join(root, CONFIG_FILENAME), "utf8")).replace(/^\uFEFF/, "");
    const parsed: unknown = JSON.parse(raw);
    return isRepotruckConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function deleteLegacyWorkspaceConfig(root: string): Promise<void> {
  try {
    await rm(path.join(root, CONFIG_FILENAME), { force: true });
  } catch {
    /* best effort: a leftover legacy file is harmless */
  }
}

export async function resolveWorkspacePreset(
  root: string,
  fallback: PresetRef,
  env?: EnvLike,
): Promise<PresetRef> {
  const config = await readWorkspaceConfig(root, env);
  if (config !== null) return config.preset;
  const legacy = await readLegacyWorkspaceConfig(root);
  if (legacy !== null) return legacy.preset;
  const agentsMd = await readAgentsMd(root);
  if (agentsMd !== null) {
    const parsed = parsePresetFromAgentsMd(agentsMd);
    if (parsed !== null) return parsed;
  }
  return fallback;
}

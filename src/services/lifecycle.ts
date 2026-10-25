import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { aheadBehindCount, createCloneLimiter, firstErrorLine } from "./cloner.ts";
import type { EnvLike, RepoInventoryEntry, RepotruckConfig } from "./config.ts";
import { repoKeyEquals } from "./fsUtils.ts";
import type { RepoInfo } from "./github.ts";
import { collectDetailedGitStatus, type DetailedGitStatus } from "./gitState.ts";
import { resolveRepoRef } from "./launcher.ts";
import { moveDir } from "./mover.ts";
import { targetDirFor, toPosixRelative, updateWorkspace } from "./workspace.ts";
import { centralStorePath } from "./workspaceRegistry.ts";

function notTrackedMessage(ref: string, env?: EnvLike): string {
  return `not tracked by repotruck: ${ref} (records: ${centralStorePath(env)})`;
}

export interface LifecycleResult {
  ok: boolean;
  message: string;
  lines?: string[];
  /** Set when the delete was parked in the trash dir (DeleteOptions.trash). */
  trashPath?: string;
}

export interface LifecycleGithub {
  getRepo(owner: string, name: string): Promise<RepoInfo>;
  archiveRepo(owner: string, name: string): Promise<RepoInfo>;
}

function entryKey(entry: RepoInventoryEntry): string {
  return `${entry.owner}/${entry.name}`;
}

function removeEntry(
  config: RepotruckConfig,
  entry: RepoInventoryEntry,
): { repos: RepoInventoryEntry[]; aliases: Record<string, string> } {
  const repos = config.repos.filter((item) => !repoKeyEquals(item, entry.owner, entry.name));
  const aliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(config.aliases ?? {})) {
    if (target.toLowerCase() !== entry.relativePath.toLowerCase()) {
      aliases[alias] = target;
    }
  }
  return { repos, aliases };
}

export async function forgetRepository(
  root: string,
  config: RepotruckConfig,
  ref: string,
  env?: EnvLike,
): Promise<LifecycleResult> {
  const match = resolveRepoRef(config, ref);
  if (match === null) {
    return { ok: false, message: notTrackedMessage(ref, env) };
  }
  await updateWorkspace(
    root,
    (current) => {
      const { repos, aliases } = removeEntry(current, match.entry);
      return { config: { ...current, repos, aliases }, result: undefined };
    },
    env,
  );
  return {
    ok: true,
    message: `forgot ${entryKey(match.entry)} (kept on disk at ${match.entry.relativePath})`,
  };
}

function httpStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

export interface PruneOptions {
  dryRun?: boolean;
  concurrency?: number;
}

export async function pruneWorkspace(
  root: string,
  config: RepotruckConfig,
  github: LifecycleGithub,
  options: PruneOptions = {},
  env?: EnvLike,
): Promise<LifecycleResult> {
  const limit = createCloneLimiter(options.concurrency ?? 5);
  const results = await Promise.all(
    config.repos.map((entry) =>
      limit(async () => {
        try {
          await github.getRepo(entry.owner, entry.name);
          return { entry, state: "alive" as const };
        } catch (error) {
          if (httpStatus(error) === 404) {
            return { entry, state: "gone" as const };
          }
          return { entry, state: "unclear" as const, error: firstErrorLine(error) };
        }
      }),
    ),
  );
  const gone = results.filter((item) => item.state === "gone").map((item) => item.entry);
  const unclear = results.filter((item) => item.state === "unclear");
  if (gone.length === 0 && unclear.length === 0) {
    return {
      ok: true,
      message: `nothing to prune (${config.repos.length} tracked)`,
    };
  }
  const lines: string[] = [];
  if (unclear.length > 0) {
    // Repositories with an unclear answer are never untracked; they are
    // reported so a permission or network problem cannot masquerade as a
    // deletion.
    lines.push(
      ...unclear.map(
        (item) => `[prune] ${entryKey(item.entry)} kept (${item.error}) — unclear answer`,
      ),
    );
  }
  if (gone.length === 0) {
    return {
      ok: false,
      message: `prune failed: ${entryKey(unclear[0]!.entry)} (${unclear[0]!.error}) — ${
        config.repos.length > 1 ? `${unclear.length} unclear answers, ` : ""
      }nothing untracked, inventory unchanged`,
      lines,
    };
  }
  if (options.dryRun === true) {
    lines.push(
      ...gone.map(
        (entry) =>
          `[prune] ${entryKey(entry)} (deleted or inaccessible on GitHub) -> would untrack`,
      ),
    );
    const summary = `${gone.length} of ${config.repos.length} tracked repositories would be pruned`;
    return {
      ok: unclear.length === 0,
      message:
        unclear.length > 0
          ? `${summary}; ${unclear.length} kept (unclear GitHub answers)`
          : summary,
      lines,
    };
  }
  await updateWorkspace(
    root,
    (current) => {
      let next = current;
      for (const entry of gone) {
        next = { ...next, ...removeEntry(next, entry) };
      }
      return { config: next, result: undefined };
    },
    env,
  );
  lines.push(...gone.map((entry) => `[prune] ${entryKey(entry)} untracked`));
  const prunedSummary = `pruned ${gone.length} of ${config.repos.length} tracked`;
  if (unclear.length > 0) {
    return {
      ok: false,
      message: `${prunedSummary}; ${unclear.length} kept with unclear answers (see lines)`,
      lines,
    };
  }
  return {
    ok: true,
    message: prunedSummary,
    lines,
  };
}

export interface DeleteOptions {
  yes?: boolean;
  rmImpl?: (target: string) => void;
  /**
   * Move the directory into <root>/.repotruck/trash instead of removing it,
   * so an accidental dashboard delete can be undone. The result carries the
   * trash path.
   */
  trash?: boolean;
}

/** Where dashboard deletes park directories before they are really gone. */
export function workspaceTrashDir(root: string): string {
  return path.join(root, ".repotruck", "trash");
}

export async function deleteRepository(
  root: string,
  config: RepotruckConfig,
  ref: string,
  options: DeleteOptions = {},
  env?: EnvLike,
): Promise<LifecycleResult> {
  const match = resolveRepoRef(config, ref);
  if (match === null) {
    return { ok: false, message: notTrackedMessage(ref, env) };
  }
  const entry = match.entry;
  const segments = entry.relativePath.split("/").filter((segment) => segment.length > 0);
  const resolvedRoot = path.resolve(root);
  const absDir = segments.length > 0 ? path.join(resolvedRoot, ...segments) : resolvedRoot;
  if (segments.length === 0 || segments.includes(".") || segments.includes("..")) {
    return {
      ok: false,
      message: `refusing to delete the workspace root (${entry.relativePath})`,
    };
  }
  const withSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (absDir === resolvedRoot || !absDir.startsWith(withSep)) {
    return {
      ok: false,
      message: `refusing to delete outside the workspace root: ${absDir}`,
    };
  }
  if (options.yes !== true) {
    return {
      ok: false,
      message: `delete requires --yes (this permanently removes ${absDir} from disk)`,
    };
  }
  const onDisk = existsSync(absDir);
  let trashPath: string | undefined;
  if (onDisk) {
    try {
      if (options.trash === true) {
        trashPath = path.join(
          workspaceTrashDir(resolvedRoot),
          `${entry.owner}-${entry.name}-${Date.now()}`,
        );
        moveDir(absDir, trashPath);
      } else {
        const rm =
          options.rmImpl ?? ((target: string) => rmSync(target, { recursive: true, force: true }));
        rm(absDir);
      }
    } catch (error) {
      return {
        ok: false,
        message: `failed to delete ${entry.relativePath} (${firstErrorLine(error)}) — partial removal possible, inventory unchanged, retry the command`,
      };
    }
  }
  await updateWorkspace(
    root,
    (current) => {
      const { repos, aliases } = removeEntry(current, entry);
      return { config: { ...current, repos, aliases }, result: undefined };
    },
    env,
  );
  return {
    ok: true,
    ...(trashPath !== undefined ? { trashPath } : {}),
    message: onDisk
      ? trashPath !== undefined
        ? `deleted ${entryKey(entry)} (moved ${entry.relativePath} to ${toPosixRelative(resolvedRoot, trashPath)} — press z in the dashboard to undo)`
        : `deleted ${entryKey(entry)} (removed ${entry.relativePath})`
      : `deleted ${entryKey(entry)} (directory was already missing)`,
  };
}

export interface ArchiveOptions {
  moveImpl?: (source: string, dest: string) => void;
}

export async function archiveRepository(
  root: string,
  config: RepotruckConfig,
  ref: string,
  github: LifecycleGithub,
  options: ArchiveOptions = {},
  env?: EnvLike,
): Promise<LifecycleResult> {
  const match = resolveRepoRef(config, ref);
  if (match === null) {
    return { ok: false, message: notTrackedMessage(ref, env) };
  }
  const entry = match.entry;
  let info: RepoInfo;
  try {
    info = await github.archiveRepo(entry.owner, entry.name);
  } catch (error) {
    return {
      ok: false,
      message: `archiving ${entryKey(entry)} on GitHub failed (${firstErrorLine(error)}) — nothing changed locally`,
    };
  }
  const updated: RepoInventoryEntry = {
    ...entry,
    category: "archived",
    updatedAt: info.updatedAt,
  };
  const targetDir = targetDirFor(
    root,
    {
      owner: entry.owner,
      name: entry.name,
      isArchived: true,
      isFork: false,
      language: entry.language,
    },
    config.preset,
    entry.internal,
  );
  const currentDir = path.join(root, ...entry.relativePath.split("/"));
  const targetRel = toPosixRelative(root, targetDir);
  const needsMove = targetRel.toLowerCase() !== entry.relativePath.toLowerCase();

  if (needsMove) {
    if (existsSync(currentDir)) {
      const move = options.moveImpl ?? moveDir;
      try {
        move(currentDir, targetDir);
      } catch (error) {
        await updateWorkspace(
          root,
          (current) => ({
            config: {
              ...current,
              repos: current.repos.map((item) =>
                repoKeyEquals(item, entry.owner, entry.name) ? updated : item,
              ),
            },
            result: undefined,
          }),
          env,
        );
        return {
          ok: false,
          message: `archive succeeded on GitHub but moving to ${targetRel} failed (${firstErrorLine(error)}) — run 'repotruck archive ${entryKey(entry)}' again to retry the move`,
        };
      }
    }
    await updateWorkspace(
      root,
      (current) => {
        const aliases: Record<string, string> = { ...(current.aliases ?? {}) };
        for (const [alias, target] of Object.entries(aliases)) {
          if (target.toLowerCase() === entry.relativePath.toLowerCase()) {
            aliases[alias] = targetRel;
          }
        }
        const repos = current.repos.map((item) =>
          repoKeyEquals(item, entry.owner, entry.name)
            ? { ...updated, relativePath: targetRel }
            : item,
        );
        return { config: { ...current, repos, aliases }, result: undefined };
      },
      env,
    );
    return {
      ok: true,
      message: `archived ${entryKey(entry)} (category: ${entry.category} -> archived, moved to ${targetRel})`,
    };
  }

  await updateWorkspace(
    root,
    (current) => ({
      config: {
        ...current,
        repos: current.repos.map((item) =>
          repoKeyEquals(item, entry.owner, entry.name) ? updated : item,
        ),
      },
      result: undefined,
    }),
    env,
  );
  return {
    ok: true,
    message: `archived ${entryKey(entry)} (category: ${entry.category} -> archived, already at ${entry.relativePath})`,
  };
}

export interface RepoStatusLine {
  key: string;
  line: string;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  missing?: boolean;
  details?: DetailedGitStatus;
}

export interface WorkspaceStatusOptions {
  concurrency?: number;
  detail?: boolean;
}

export interface WorkspaceStatus {
  lastSync: string | null;
  repos: RepoStatusLine[];
}

export async function workspaceStatus(
  root: string,
  config: RepotruckConfig,
  options: WorkspaceStatusOptions = {},
): Promise<WorkspaceStatus> {
  const aliasByPath = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(config.aliases ?? {})) {
    const list = aliasByPath.get(target.toLowerCase()) ?? [];
    list.push(alias);
    aliasByPath.set(target.toLowerCase(), list);
  }
  const limit = createCloneLimiter(options.concurrency ?? 5);
  const repos = await Promise.all(
    config.repos.map((entry) =>
      limit(async (): Promise<RepoStatusLine> => {
        const key = entryKey(entry);
        const dir = path.join(root, ...entry.relativePath.split("/"));
        if (!existsSync(dir)) {
          return { key, line: `${key} — MISSING on disk`, missing: true };
        }
        const git = simpleGit(dir);
        let inside: string;
        try {
          inside = (await git.raw(["rev-parse", "--is-inside-work-tree"])).trim();
        } catch {
          inside = "";
        }
        const parts: string[] = [];
        let isDirty = false;
        let aheadNum = 0;
        let behindNum = 0;
        if (inside !== "true") {
          parts.push("not a git repository");
        } else {
          try {
            const status = await git.raw(["status", "--porcelain"]);
            isDirty = status.trim().length > 0;
            parts.push(isDirty ? "dirty" : "clean");
          } catch {
            parts.push("unknown git status");
          }
          try {
            const { ahead, behind } = await aheadBehindCount(git);
            aheadNum = ahead;
            behindNum = behind;
            parts.push(`ahead ${ahead}`, `behind ${behind}`);
          } catch {
            parts.push("no upstream");
          }
        }
        parts.push(`category ${entry.category}`);
        if (entry.custom === true) parts.push("custom");
        const aliases = aliasByPath.get(entry.relativePath.toLowerCase());
        if (aliases !== undefined && aliases.length > 0) {
          parts.push(`alias ${aliases.join(", ")}`);
        }
        let details: DetailedGitStatus | undefined;
        if (options.detail && inside === "true") {
          try {
            details = await collectDetailedGitStatus(git);
          } catch {
            // ignore detail collection failure
          }
        }
        return {
          key,
          line: `${key} — ${parts.join(", ")}`,
          dirty: isDirty,
          ahead: aheadNum,
          behind: behindNum,
          missing: false,
          details,
        };
      }),
    ),
  );
  return { lastSync: config.lastSync ?? null, repos };
}

import type { Dirent } from "node:fs";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { simpleGit } from "simple-git";
import { firstErrorLine } from "./cloner.ts";

export type GitDotInspection =
  | { kind: "none" }
  | { kind: "repo" }
  | { kind: "worktree"; gitDir: string; mainRepoDir: string | null };

/**
 * Inspects `<repoDir>/.git` to distinguish standalone repositories (`.git` is
 * a directory) from linked `git worktree` checkouts (`.git` is a pointer file
 * containing `gitdir: ...`). Moving a linked worktree breaks its bidirectional
 * path pointer inside the parent `.git/worktrees/<id>` directory.
 */
export function inspectGitDotEntry(repoDir: string): GitDotInspection {
  const dotGit = path.join(repoDir, ".git");
  if (!existsSync(dotGit)) return { kind: "none" };
  try {
    const stat = lstatSync(dotGit);
    if (stat.isDirectory()) return { kind: "repo" };
    if (!stat.isFile()) return { kind: "none" };
    const raw = readFileSync(dotGit, "utf8").trim();
    const match = /^gitdir:\s*(.+)$/im.exec(raw);
    if (!match?.[1]) return { kind: "none" };
    const target = match[1].trim();
    const resolvedGitDir = path.isAbsolute(target) ? target : path.resolve(repoDir, target);
    const normalized = resolvedGitDir.replace(/\\/g, "/");
    const worktreesMarker = "/.git/worktrees/";
    const idx = normalized.toLowerCase().lastIndexOf(worktreesMarker);
    const mainRepoDir = idx > 0 ? path.resolve(normalized.slice(0, idx)) : null;
    return {
      kind: "worktree",
      gitDir: resolvedGitDir,
      mainRepoDir,
    };
  } catch {
    return { kind: "none" };
  }
}

export function isLinkedWorktree(repoDir: string): boolean {
  return inspectGitDotEntry(repoDir).kind === "worktree";
}

export interface LinkedWorktreeEntry {
  relativePath: string;
  absolutePath: string;
  gitDir: string;
  mainRepoDir: string | null;
}

export interface RepoWorktreeDetail {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  locked: boolean;
  isMain: boolean;
}

/**
 * Parses `git worktree list --porcelain` output.
 */
export function parseWorktreeListPorcelain(raw: string): RepoWorktreeDetail[] {
  const items: RepoWorktreeDetail[] = [];
  const blocks = raw.trim().split(/\r?\n\r?\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    let worktreePath = "";
    let head = "";
    let branch: string | null = null;
    let bare = false;
    let locked = false;

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) {
        worktreePath = line.slice("worktree ".length).trim();
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length).trim();
      } else if (line.startsWith("branch ")) {
        const fullBranch = line.slice("branch ".length).trim();
        branch = fullBranch.replace(/^refs\/heads\//, "");
      } else if (line === "bare") {
        bare = true;
      } else if (line.startsWith("locked")) {
        locked = true;
      } else if (line === "detached") {
        branch = null;
      }
    }
    if (worktreePath) {
      items.push({
        path: path.normalize(worktreePath),
        head,
        branch,
        bare,
        locked,
        isMain: items.length === 0,
      });
    }
  }
  return items;
}

/** Lists worktrees belonging to a git repository using `git worktree list --porcelain`. */
export async function listRepoWorktrees(repoDir: string): Promise<RepoWorktreeDetail[]> {
  const git = simpleGit(repoDir);
  try {
    const raw = await git.raw(["worktree", "list", "--porcelain"]);
    return parseWorktreeListPorcelain(raw);
  } catch (error) {
    throw new Error(`failed to list worktrees in ${repoDir}: ${firstErrorLine(error)}`);
  }
}

/** Creates a new git worktree for a branch. */
export async function createRepoWorktree(
  repoDir: string,
  branch: string,
  targetPath: string,
  options: { newBranch?: boolean; commitOrBranch?: string } = {},
): Promise<{ ok: boolean; message: string; path: string }> {
  const git = simpleGit(repoDir);
  const resolved = path.resolve(targetPath);
  const args = ["worktree", "add"];
  if (options.newBranch === true) {
    args.push("-b", branch, resolved);
    if (options.commitOrBranch) args.push(options.commitOrBranch);
  } else {
    args.push(resolved, branch);
  }
  try {
    await git.raw(args);
    return { ok: true, message: `created worktree at ${resolved} for ${branch}`, path: resolved };
  } catch (error) {
    return { ok: false, message: firstErrorLine(error), path: resolved };
  }
}

/** Removes an existing git worktree. */
export async function removeRepoWorktree(
  repoDir: string,
  targetPath: string,
  force = false,
): Promise<{ ok: boolean; message: string }> {
  const git = simpleGit(repoDir);
  const resolved = path.resolve(targetPath);
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(resolved);
  try {
    await git.raw(args);
    return { ok: true, message: `removed worktree ${resolved}` };
  } catch (error) {
    return { ok: false, message: firstErrorLine(error) };
  }
}

const SKIP_WALK_DIRS = new Set([
  "node_modules",
  "vendor",
  "bower_components",
  "target",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".svn",
  ".hg",
  ".git",
  ".repotruck",
]);

/** Discovers linked git worktrees under `root` up to `maxDepth`. */
export async function findLinkedWorktrees(
  root: string,
  maxDepth = 6,
): Promise<LinkedWorktreeEntry[]> {
  const resolvedRoot = path.resolve(root);
  const found: LinkedWorktreeEntry[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let items: Dirent[];
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (!item.isDirectory()) continue;
      if (SKIP_WALK_DIRS.has(item.name) || item.name.startsWith(".")) continue;
      const full = path.join(dir, item.name);
      const inspected = inspectGitDotEntry(full);
      if (inspected.kind === "worktree") {
        const relativePath = path.relative(resolvedRoot, full).split(path.sep).join("/");
        found.push({
          relativePath,
          absolutePath: full,
          gitDir: inspected.gitDir,
          mainRepoDir: inspected.mainRepoDir,
        });
        continue;
      }
      if (inspected.kind === "repo") {
        continue;
      }
      await walk(full, depth + 1);
    }
  };

  await walk(resolvedRoot, 0);
  found.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return found;
}

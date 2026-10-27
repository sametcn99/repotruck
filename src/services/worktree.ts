import type { Dirent } from "node:fs";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

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

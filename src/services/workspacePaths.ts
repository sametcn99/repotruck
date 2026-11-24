import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

/** Paths below a workspace must never traverse symlinks or junctions. */
export function workspacePath(root: string, relative: string): string {
  if (!relative || relative.includes("\0") || /^[\\/]/.test(relative) || /^[a-z]:/i.test(relative))
    throw new Error(`invalid workspace-relative path: ${relative}`);
  const segments = relative.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`invalid workspace-relative path: ${relative}`);
  }
  const base = path.resolve(root);
  let current = base;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`refusing workspace path through a symbolic link: ${relative}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  // realpath also handles platform-specific junctions and a symlink workspace root.
  if (existsSync(base)) {
    const canonicalRoot = realpathSync(base);
    let existing = current;
    while (!existsSync(existing) && existing !== base) existing = path.dirname(existing);
    const resolved = realpathSync(existing);
    const rel = path.relative(canonicalRoot, resolved);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`refusing path outside the workspace root: ${relative}`);
    }
  }
  return current;
}

export function assertWorkspacePath(root: string, absolute: string): string {
  return workspacePath(
    root,
    path.relative(path.resolve(root), path.resolve(absolute)).split(path.sep).join("/"),
  );
}

import { existsSync, readdirSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

let atomicWriteCounter = 0;

/**
 * Writes a file through a temp file + rename so readers never observe a
 * half-written state file, cleaning the temp file up on failure.
 */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  atomicWriteCounter += 1;
  const tmp = `${file}.tmp-${process.pid}-${atomicWriteCounter}`;
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, file);
  } catch (error) {
    try {
      await rm(tmp, { force: true });
    } catch {
      /* best effort cleanup */
    }
    throw error;
  }
}

/** Case-insensitive owner/name match used for every repository lookup. */
export function repoKeyEquals(
  entry: { owner: string; name: string },
  owner: string,
  name: string,
): boolean {
  return (
    entry.owner.toLowerCase() === owner.toLowerCase() &&
    entry.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Resolves the actual casing of a relative path on disk starting from root.
 * Returns null if any segment does not exist.
 */
export function getActualCasingOnDisk(
  root: string,
  relPath: string,
  readdirSyncFn: (dir: string) => string[] = readdirSync,
  existsSyncFn: (p: string) => boolean = existsSync,
): string | null {
  const normalized = relPath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  let currentAbs = root;
  const actualSegments: string[] = [];

  for (const seg of segments) {
    if (!existsSyncFn(currentAbs)) return null;
    let entries: string[];
    try {
      entries = readdirSyncFn(currentAbs);
    } catch {
      return null;
    }
    const match = entries.find((e) => e.toLowerCase() === seg.toLowerCase());
    if (!match) return null;
    actualSegments.push(match);
    currentAbs = path.join(currentAbs, match);
  }
  return actualSegments.join("/");
}

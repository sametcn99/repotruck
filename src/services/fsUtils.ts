import { existsSync, readdirSync } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";

let atomicWriteCounter = 0;

/**
 * Writes a file through a temp file + rename so readers never observe a
 * half-written state file, cleaning the temp file up on failure.
 */
export async function writeFileAtomic(
  file: string,
  content: string | Uint8Array,
  mode?: number,
  deps: { open?: typeof open; rename?: typeof rename; rm?: typeof rm } = {},
): Promise<void> {
  atomicWriteCounter += 1;
  const tmp = `${file}.tmp-${process.pid}-${atomicWriteCounter}`;
  try {
    const handle = await (deps.open ?? open)(tmp, "wx", mode);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await (deps.rename ?? rename)(tmp, file);
  } catch (error) {
    try {
      await (deps.rm ?? rm)(tmp, { force: true });
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

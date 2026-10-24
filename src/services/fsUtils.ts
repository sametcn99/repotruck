import { rename, rm, writeFile } from "node:fs/promises";

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

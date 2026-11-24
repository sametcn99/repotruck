import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isPresetRef, type PresetRef } from "../presets/index.ts";
import { firstErrorLine } from "./cloner.ts";
import { isRepoInventoryEntry, type RepoInventoryEntry } from "./config.ts";
import { workspacePath } from "./workspacePaths.ts";

export interface ReorganizeJournalMove {
  key: string;
  from: string;
  to: string;
  status: "pending" | "done";
  /** Directory identity captured before the move; optional for v1 journal compatibility. */
  sourceIdentity?: { dev: string; ino: string; birthtimeNs: string };
  tmpPath?: string;
  forkSourceOwner?: string;
  adopted?: RepoInventoryEntry;
}

export interface ReorganizeJournal {
  version: 1;
  preset: PresetRef;
  timestamp: string;
  moves: ReorganizeJournalMove[];
}

export function reorganizeJournalPath(root: string): string {
  return workspacePath(root, ".repotruck/reorganize-journal.json");
}

export function writeReorganizeJournalAtomically(root: string, journal: ReorganizeJournal): void {
  const dir = workspacePath(root, ".repotruck");
  mkdirSync(dir, { recursive: true });
  const journalPath = reorganizeJournalPath(root);
  const tmpPath = path.join(dir, `reorganize-journal.json.tmp-${randomUUID()}`);
  try {
    writeFileSync(tmpPath, JSON.stringify(journal, null, 2), "utf8");
    renameSync(tmpPath, journalPath);
  } finally {
    rmSync(tmpPath, { force: true });
  }
}

export function readReorganizeJournal(root: string): ReorganizeJournal | null {
  const journalPath = reorganizeJournalPath(root);
  if (!existsSync(journalPath)) return null;
  const raw = readFileSync(journalPath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.version === 1 &&
      isPresetRef(parsed.preset) &&
      typeof parsed.timestamp === "string" &&
      Number.isFinite(Date.parse(parsed.timestamp)) &&
      Array.isArray(parsed.moves)
    ) {
      for (const move of parsed.moves) {
        if (
          !move ||
          typeof move !== "object" ||
          typeof move.key !== "string" ||
          !/^[^/]+\/[^/]+$/.test(move.key) ||
          (move.status !== "pending" && move.status !== "done") ||
          typeof move.from !== "string" ||
          typeof move.to !== "string" ||
          (move.sourceIdentity !== undefined &&
            (!move.sourceIdentity ||
              typeof move.sourceIdentity.dev !== "string" ||
              typeof move.sourceIdentity.ino !== "string" ||
              typeof move.sourceIdentity.birthtimeNs !== "string")) ||
          (move.tmpPath !== undefined && typeof move.tmpPath !== "string") ||
          (move.forkSourceOwner !== undefined &&
            (typeof move.forkSourceOwner !== "string" || !move.forkSourceOwner.length)) ||
          (move.adopted !== undefined && !isRepoInventoryEntry(move.adopted))
        ) {
          throw new Error(`corrupt reorganize journal; invalid move in ${journalPath}`);
        }
        workspacePath(root, move.from);
        workspacePath(root, move.to);
        if (move.tmpPath) workspacePath(root, move.tmpPath);
      }
      return parsed as ReorganizeJournal;
    }
    throw new Error(`corrupt reorganize journal; inspect or delete ${journalPath}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("corrupt reorganize journal")) {
      throw err;
    }
    throw new Error(
      `corrupt reorganize journal; inspect or delete ${journalPath} (${firstErrorLine(err)})`,
    );
  }
}

export function deleteReorganizeJournal(root: string): void {
  const journalPath = reorganizeJournalPath(root);
  if (existsSync(journalPath)) {
    try {
      unlinkSync(journalPath);
    } catch {
      /* best effort */
    }
  }
}

import { lstatSync } from "node:fs";
import type { ReorganizeJournalMove } from "./reorganizeJournal.ts";

export function directoryIdentity(directory: string) {
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory()) return null;
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  };
}

export function sameDirectoryIdentity(first: string, second: string): boolean {
  try {
    const firstIdentity = directoryIdentity(first);
    const secondIdentity = directoryIdentity(second);
    return (
      firstIdentity !== null &&
      secondIdentity !== null &&
      firstIdentity.dev === secondIdentity.dev &&
      firstIdentity.ino === secondIdentity.ino &&
      firstIdentity.birthtimeNs === secondIdentity.birthtimeNs
    );
  } catch {
    return false;
  }
}

export function matchesRecordedIdentity(
  journalMove: ReorganizeJournalMove,
  destination: string,
): boolean {
  if (!journalMove.sourceIdentity) return false;
  try {
    const actual = directoryIdentity(destination);
    return (
      actual !== null &&
      actual.dev === journalMove.sourceIdentity.dev &&
      actual.ino === journalMove.sourceIdentity.ino &&
      actual.birthtimeNs === journalMove.sourceIdentity.birthtimeNs
    );
  } catch {
    return false;
  }
}

export function isRecordedDestination(
  journalMove: ReorganizeJournalMove,
  destination: string,
): boolean {
  return journalMove.status === "done" || matchesRecordedIdentity(journalMove, destination);
}

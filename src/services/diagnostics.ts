import { firstErrorLine } from "./cloner.ts";
import type { EnvLike } from "./config.ts";

export function verboseEnabled(env: EnvLike = process.env): boolean {
  const flag = env.REPOTRUCK_VERBOSE;
  return flag === "1" || flag === "true";
}

// ---- central diagnostics log -------------------------------------------------
// A process-wide ring buffer every layer can record into (runtime handlers,
// Octokit, warnQuiet, FAILED activity statuses). The TUI Log view renders it
// and the store raises error entries as transient toasts.

export type DiagLevel = "error" | "warn" | "info";

export interface DiagLogEntry {
  id: number;
  /** ISO timestamp of when the entry was recorded. */
  ts: string;
  level: DiagLevel;
  /** Origin tag: "[runtime]", "[octokit]", "[auth]", or a status key. */
  source: string;
  message: string;
  /** Recorded on behalf of a FAILED activity status; toasts skip these. */
  fromStatus?: boolean;
}

export const DIAG_LOG_CAP = 500;

let diagEntries: DiagLogEntry[] = [];
let diagNextId = 1;
const diagListeners = new Set<() => void>();

function diagMessage(message: string | unknown): string {
  if (typeof message === "string") return message;
  if (message === undefined || message === null) return "";
  const line = firstErrorLine(message);
  return line === "undefined" ? "" : line;
}

/**
 * Records one entry and notifies subscribers (Log view re-render, store
 * toast). Errors from FAILED statuses pass `fromStatus` so the listener does
 * not toast what the status mirror already surfaced.
 */
export function logDiag(
  level: DiagLevel,
  source: string,
  message: string | unknown,
  options: { fromStatus?: boolean } = {},
): DiagLogEntry {
  const entry: DiagLogEntry = {
    id: diagNextId++,
    ts: new Date().toISOString(),
    level,
    source,
    message: diagMessage(message),
    ...(options.fromStatus === true ? { fromStatus: true } : {}),
  };
  diagEntries = [...diagEntries, entry].slice(-DIAG_LOG_CAP);
  for (const listener of diagListeners) listener();
  return entry;
}

/** Stable snapshot reference for `useSyncExternalStore`; a new array per record. */
export function diagSnapshot(): readonly DiagLogEntry[] {
  return diagEntries;
}

export function diagSubscribe(listener: () => void): () => void {
  diagListeners.add(listener);
  return () => {
    diagListeners.delete(listener);
  };
}

export function diagClear(): void {
  diagEntries = [];
  for (const listener of diagListeners) listener();
}

/** Test helper: reset the module-level buffer between test files. */
export function diagResetForTest(): void {
  diagEntries = [];
  diagNextId = 1;
}

/**
 * Reports a swallowed error when verbose mode is on (--verbose or
 * REPOTRUCK_VERBOSE=1); silent otherwise. The entry is always captured in
 * the diagnostics log so the Log view shows what was swallowed. Behavior
 * never changes — only visibility does.
 */
export function warnQuiet(label: string, error: unknown, env: EnvLike = process.env): void {
  logDiag("warn", label, error);
  if (!verboseEnabled(env)) return;
  process.stderr.write(`warning: ${label} (${firstErrorLine(error)})\n`);
}

import type { CloneProgress } from "./cloner.ts";

export interface RepoProgressEvent extends CloneProgress {
  index?: number;
  total?: number;
}

export interface SyncSummaryEvent {
  kind: "sync-summary";
  done: number;
  failed: number;
  skipped: number;
}

export type ProgressEvent = RepoProgressEvent | SyncSummaryEvent;

function isSyncSummary(value: ProgressEvent): value is SyncSummaryEvent {
  return (value as SyncSummaryEvent).kind === "sync-summary";
}

export interface ProgressHub {
  publish(event: ProgressEvent): void;
  subscribe(listener: (event: ProgressEvent) => void): () => void;
  snapshot(): ProgressEvent[];
}

/** Bounds replayed history so long syncs cannot flood late subscribers. */
export const MAX_HUB_EVENTS = 500;

export function createProgressHub(): ProgressHub {
  const events: ProgressEvent[] = [];
  const listeners = new Set<(event: ProgressEvent) => void>();
  return {
    publish(event: ProgressEvent): void {
      events.push(event);
      if (events.length > MAX_HUB_EVENTS) {
        events.splice(0, events.length - MAX_HUB_EVENTS);
      }
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener: (event: ProgressEvent) => void): () => void {
      listeners.add(listener);
      for (const event of events) {
        listener(event);
      }
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot(): ProgressEvent[] {
      return [...events];
    },
  };
}

export function isRepoProgressEvent(event: ProgressEvent): event is RepoProgressEvent {
  return !isSyncSummary(event);
}

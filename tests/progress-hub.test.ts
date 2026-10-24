import { describe, expect, test } from "bun:test";
import { createProgressHub, isRepoProgressEvent } from "../src/services/progressHub.ts";

describe("progressHub", () => {
  test("subscribers receive published events in order", () => {
    const hub = createProgressHub();
    const received: string[] = [];
    hub.subscribe((event) => {
      if (isRepoProgressEvent(event)) received.push(`${event.key}:${event.phase}`);
    });
    hub.publish({ key: "a/b", owner: "a", name: "b", phase: "cloning" });
    hub.publish({ key: "a/b", owner: "a", name: "b", phase: "done", message: "cloned" });
    expect(received).toEqual(["a/b:cloning", "a/b:done"]);
  });

  test("unsubscribe stops delivery", () => {
    const hub = createProgressHub();
    const received: string[] = [];
    const unsubscribe = hub.subscribe((event) => {
      if (isRepoProgressEvent(event)) received.push(event.key);
    });
    hub.publish({ key: "a/b", owner: "a", name: "b", phase: "cloning" });
    unsubscribe();
    hub.publish({ key: "c/d", owner: "c", name: "d", phase: "cloning" });
    expect(received).toEqual(["a/b"]);
  });

  test("late subscribers get the full replay from snapshot history", () => {
    const hub = createProgressHub();
    hub.publish({ key: "a/b", owner: "a", name: "b", phase: "cloning", index: 1, total: 2 });
    hub.publish({
      key: "a/b",
      owner: "a",
      name: "b",
      phase: "done",
      message: "cloned",
      index: 1,
      total: 2,
    });
    hub.publish({ kind: "sync-summary", done: 1, failed: 0, skipped: 0 });
    const replay: string[] = [];
    hub.subscribe((event) => {
      if (isRepoProgressEvent(event)) replay.push(event.phase);
      else replay.push(event.kind);
    });
    expect(replay).toEqual(["cloning", "done", "sync-summary"]);
    expect(hub.snapshot()).toHaveLength(3);
  });

  test("sync summary events are distinguishable from repo events", () => {
    const hub = createProgressHub();
    hub.publish({ kind: "sync-summary", done: 2, failed: 1, skipped: 3 });
    const event = hub.snapshot()[0]!;
    expect(isRepoProgressEvent(event)).toBe(false);
  });
});

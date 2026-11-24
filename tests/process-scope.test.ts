import { describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { closeProcessScope, trackChild } from "../src/services/processScope.ts";

function childProcess(pid: number): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  }) as unknown as ChildProcess;
}

describe("process scope shutdown", () => {
  test("waits for both Windows tree-killer completion and tracked child close", async () => {
    const signal = new AbortController().signal;
    const child = childProcess(4101);
    trackChild(child, signal);
    let releaseKiller!: () => void;
    let announceKiller!: () => void;
    let announceClose!: () => void;
    const killerGate = new Promise<void>((resolve) => (releaseKiller = resolve));
    const killerStarted = new Promise<void>((resolve) => (announceKiller = resolve));
    const childClosed = new Promise<void>((resolve) => (announceClose = resolve));
    child.once("close", announceClose);
    let settled = false;

    const closing = closeProcessScope(signal, {
      platform: "win32",
      terminate: async (_child, force) => {
        expect(force).toBe(true);
        announceKiller();
        await killerGate;
        child.emit("close", null, "SIGKILL");
      },
      reapTimeoutMs: 100,
    }).then(() => {
      settled = true;
    });

    await killerStarted;
    expect(settled).toBe(false);
    releaseKiller();
    await childClosed;
    await closing;
    expect(settled).toBe(true);
  });

  test("reports a child that remains open after the forced-reap deadline", async () => {
    const signal = new AbortController().signal;
    const child = childProcess(4102);
    trackChild(child, signal);

    await expect(
      closeProcessScope(signal, {
        platform: "win32",
        terminate: async () => {},
        reapTimeoutMs: 5,
      }),
    ).rejects.toThrow("did not reap child process(es) before deadline: 4102");
    child.emit("close", null, "SIGKILL");
  });

  test("shares abort and repeated close calls while the process tree is closing", async () => {
    const controller = new AbortController();
    const child = childProcess(4104);
    trackChild(child, controller.signal);
    let releaseKiller!: () => void;
    let announceKiller!: () => void;
    const killerGate = new Promise<void>((resolve) => (releaseKiller = resolve));
    const killerStarted = new Promise<void>((resolve) => (announceKiller = resolve));
    let calls = 0;
    const options = {
      platform: "win32" as const,
      terminate: async () => {
        calls += 1;
        announceKiller();
        await killerGate;
        child.emit("close", null, "SIGKILL");
      },
    };
    const closing = closeProcessScope(controller.signal, options);
    controller.abort();
    const repeated = closeProcessScope(controller.signal, options);
    expect(repeated).toBe(closing);
    await killerStarted;
    releaseKiller();
    await closing;
    expect(calls).toBe(1);
  });

  test("drains children registered while an abort-driven close is in flight", async () => {
    const controller = new AbortController();
    const first = childProcess(4105);
    const second = childProcess(4106);
    trackChild(first, controller.signal);
    let releaseFirst!: () => void;
    let announceFirst!: () => void;
    let announceSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
    const firstStarted = new Promise<void>((resolve) => (announceFirst = resolve));
    const secondStarted = new Promise<void>((resolve) => (announceSecond = resolve));
    let calls = 0;
    const options = {
      platform: "win32" as const,
      terminate: async (child: ChildProcess) => {
        calls += 1;
        if (child.pid === first.pid) {
          announceFirst();
          await firstGate;
          first.emit("close", null, "SIGKILL");
        } else {
          announceSecond();
          second.emit("close", null, "SIGKILL");
        }
      },
    };
    const closing = closeProcessScope(controller.signal, options);
    controller.abort();
    await firstStarted;
    trackChild(second, controller.signal);
    expect(calls).toBe(1);
    releaseFirst();
    await secondStarted;
    await closing;
    expect(calls).toBe(2);
  });

  test("keeps POSIX TERM grace before forcing a child that ignores TERM", async () => {
    const signal = new AbortController().signal;
    const child = childProcess(4103);
    trackChild(child, signal);
    const requests: boolean[] = [];
    await closeProcessScope(signal, {
      platform: "linux",
      graceMs: 5,
      reapTimeoutMs: 100,
      terminate: async (_child, force) => {
        requests.push(force);
        if (force) child.emit("close", null, "SIGKILL");
      },
    });
    expect(requests).toEqual([false, true]);
  });
});

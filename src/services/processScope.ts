import { type ChildProcess, spawn } from "node:child_process";

const scopes = new Map<AbortSignal, Set<ChildProcess>>();
const closingScopes = new Map<AbortSignal, Promise<void>>();
const closedChildren = new WeakSet<ChildProcess>();

export interface ProcessScopeCloseOptions {
  /** Internal seam for deterministic process-tree lifecycle tests. */
  platform?: NodeJS.Platform;
  terminate?: (child: ChildProcess, force: boolean) => Promise<void>;
  graceMs?: number;
  reapTimeoutMs?: number;
}

function terminate(
  child: ChildProcess,
  force: boolean,
  platform = process.platform,
): Promise<void> {
  if (
    !child.pid ||
    (platform === "win32" && (child.exitCode !== null || child.signalCode !== null))
  )
    return Promise.resolve();
  if (platform === "win32") {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.once("error", () => {
          child.kill(force ? "SIGKILL" : "SIGTERM");
          done();
        });
        // taskkill's close event means the process-tree request and its stdio
        // handles are finished. closeProcessScope separately waits for the
        // tracked child close event, which includes its stdio drain.
        killer.once("close", done);
      } catch {
        child.kill(force ? "SIGKILL" : "SIGTERM");
        done();
      }
    });
  }
  try {
    process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
  return Promise.resolve();
}

export function trackChild(child: ChildProcess, signal?: AbortSignal): void {
  if (!signal) return;
  const children = scopes.get(signal) ?? new Set<ChildProcess>();
  children.add(child);
  scopes.set(signal, children);
  const aborted = () => {
    void closeProcessScope(signal).catch((error: unknown) => {
      process.stderr.write(
        `process scope: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
  };
  signal.addEventListener("abort", aborted, { once: true });
  child.once("close", () => {
    closedChildren.add(child);
    signal.removeEventListener("abort", aborted);
    children.delete(child);
    if (!children.size) scopes.delete(signal);
  });
  if (signal.aborted) aborted();
}

function waitForChildren(children: ChildProcess[], timeoutMs: number): Promise<boolean> {
  if (children.every((child) => closedChildren.has(child))) return Promise.resolve(true);
  return new Promise((resolve) => {
    let remaining = children.filter((child) => !closedChildren.has(child)).length;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (closed: boolean) => {
      clearTimeout(timer);
      for (const child of children) child.off("close", onClose);
      resolve(closed);
    };
    const onClose = () => {
      remaining -= 1;
      if (remaining === 0) finish(true);
    };
    timer = setTimeout(() => finish(false), timeoutMs);
    for (const child of children) {
      if (!closedChildren.has(child)) child.once("close", onClose);
    }
  });
}

async function closeChildren(
  children: ChildProcess[],
  options: ProcessScopeCloseOptions,
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const terminateChild = options.terminate ?? ((child, force) => terminate(child, force, platform));
  const graceMs = options.graceMs ?? 120;
  const reapTimeoutMs = options.reapTimeoutMs ?? 900;
  const active = () => children.filter((child) => !closedChildren.has(child));
  const request = async (items: ChildProcess[], force: boolean) => {
    const outcomes = await Promise.allSettled(items.map((child) => terminateChild(child, force)));
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
  };
  const boundedRequest = async (items: ChildProcess[], force: boolean) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        request(items, force),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const pids = items.map((child) => child.pid ?? "unknown").join(", ");
            reject(
              new Error(`process-tree termination request did not finish before deadline: ${pids}`),
            );
          }, reapTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  const initial = active();
  await boundedRequest(initial, platform === "win32");
  if (platform !== "win32" && active().length > 0) {
    const gracefullyClosed = await waitForChildren(active(), graceMs);
    if (!gracefullyClosed) await boundedRequest(active(), true);
  }

  const remaining = active();
  if (remaining.length > 0) {
    const reaped = await waitForChildren(remaining, reapTimeoutMs);
    if (!reaped) {
      const pids = active()
        .map((child) => child.pid ?? "unknown")
        .join(", ");
      throw new Error(`process scope did not reap child process(es) before deadline: ${pids}`);
    }
  }
}

async function drainProcessScope(
  signal: AbortSignal,
  options: ProcessScopeCloseOptions,
): Promise<void> {
  while (true) {
    const children = [...(scopes.get(signal) ?? [])];
    if (!children.length) return;
    await closeChildren(children, options);
  }
}

/** Drain this server's process tree; reject if forced termination is not reaped. */
export function closeProcessScope(
  signal: AbortSignal,
  options: ProcessScopeCloseOptions = {},
): Promise<void> {
  const existing = closingScopes.get(signal);
  if (existing) return existing;
  if (!scopes.get(signal)?.size) return Promise.resolve();
  const closing = drainProcessScope(signal, options).finally(() => closingScopes.delete(signal));
  closingScopes.set(signal, closing);
  return closing;
}

import { type ChildProcess, spawn } from "node:child_process";

const scopes = new Map<AbortSignal, Set<ChildProcess>>();
function terminate(child: ChildProcess, force = false): void {
  if (
    !child.pid ||
    (process.platform === "win32" && (child.exitCode !== null || child.signalCode !== null))
  )
    return;
  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("error", () => child.kill());
    } else process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
}

export function trackChild(child: ChildProcess, signal?: AbortSignal): void {
  if (!signal) return;
  const children = scopes.get(signal) ?? new Set<ChildProcess>();
  children.add(child);
  scopes.set(signal, children);
  const aborted = () => terminate(child);
  signal.addEventListener("abort", aborted, { once: true });
  child.once("close", () => {
    signal.removeEventListener("abort", aborted);
    children.delete(child);
    if (!children.size) scopes.delete(signal);
  });
  if (signal.aborted) aborted();
}

/** Drain this server's children only; force a process group that ignores TERM. */
export async function closeProcessScope(signal: AbortSignal): Promise<void> {
  const children = [...(scopes.get(signal) ?? [])];
  if (!children.length) return;
  const closed = Promise.all(
    children.map((child) => new Promise<void>((resolve) => child.once("close", () => resolve()))),
  );
  for (const child of children) terminate(child);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      closed,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 120);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  for (const child of children) terminate(child, true);
}

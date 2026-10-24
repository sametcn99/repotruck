import { spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { firstErrorLine } from "./cloner.ts";
import { appConfigDir, type EnvLike } from "./config.ts";
import { warnQuiet } from "./diagnostics.ts";
import { writeFileAtomic } from "./fsUtils.ts";
import { quoteForShell } from "./shellQuote.ts";
import { isNewerVersion, readVersion } from "./version.ts";

export const UPDATE_STATE_FILENAME = "update.json";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateState {
  lastCheck: string | null;
  latestVersion: string | null;
  dismissedVersion: string | null;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  disabled?: boolean;
  fromCache?: boolean;
}

export function defaultUpdateState(): UpdateState {
  return { lastCheck: null, latestVersion: null, dismissedVersion: null };
}

function isUpdateState(value: unknown): value is UpdateState {
  if (value === null || typeof value !== "object") return false;
  const state = value as Partial<UpdateState>;
  return (
    (state.lastCheck === null || typeof state.lastCheck === "string") &&
    (state.latestVersion === null || typeof state.latestVersion === "string") &&
    (state.dismissedVersion === null || typeof state.dismissedVersion === "string")
  );
}

export function updateStatePath(env: EnvLike): string {
  return path.join(appConfigDir(env), UPDATE_STATE_FILENAME);
}

export async function readUpdateState(env: EnvLike): Promise<UpdateState> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = (await readFile(updateStatePath(env), "utf8")).replace(/^\uFEFF/, "");
    const parsed: unknown = JSON.parse(raw);
    if (!isUpdateState(parsed)) return defaultUpdateState();
    return parsed;
  } catch (error) {
    warnQuiet("update state: read failed, using defaults", error, env);
    return defaultUpdateState();
  }
}

export async function writeUpdateState(env: EnvLike, state: UpdateState): Promise<void> {
  const file = updateStatePath(env);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`);
}

export interface FetchLatestVersionOptions {
  fetchImpl?: typeof fetch;
  registry?: string;
  timeoutMs?: number;
}

export async function fetchLatestVersion(
  options: FetchLatestVersionOptions = {},
): Promise<string | null> {
  const doFetch = options.fetchImpl ?? fetch;
  const registry = options.registry ?? "https://registry.npmjs.org";
  const timeoutMs = options.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(`${registry}/repotruck/latest`, {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (data === null || typeof data !== "object") return null;
    const version = (data as { version?: unknown }).version;
    return typeof version === "string" && version.length > 0 ? version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function shouldCheckForUpdate(state: UpdateState, now: number = Date.now()): boolean {
  if (state.lastCheck === null) return true;
  const last = Date.parse(state.lastCheck);
  if (Number.isNaN(last)) return true;
  return now - last >= UPDATE_CHECK_INTERVAL_MS;
}

export interface CheckForUpdateOptions {
  fetchImpl?: typeof fetch;
  now?: () => string;
  force?: boolean;
}

export async function checkForUpdate(
  env: EnvLike,
  options: CheckForUpdateOptions = {},
): Promise<UpdateCheckResult> {
  const currentVersion = await readVersion();
  if (env.REPOTRUCK_NO_UPDATE_CHECK) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      disabled: true,
    };
  }
  const state = await readUpdateState(env);
  if (options.force !== true && !shouldCheckForUpdate(state)) {
    return {
      currentVersion,
      latestVersion: state.latestVersion,
      updateAvailable: isNewerVersion(state.latestVersion, currentVersion),
      fromCache: true,
    };
  }
  const latestVersion = await fetchLatestVersion({ fetchImpl: options.fetchImpl });
  if (latestVersion === null) {
    // A failed registry lookup must not open the 24h throttle window; keep the
    // previous state so the next run retries the check.
    return {
      currentVersion,
      latestVersion: state.latestVersion,
      updateAvailable: isNewerVersion(state.latestVersion, currentVersion),
    };
  }
  const timestamp = (options.now ?? (() => new Date().toISOString()))();
  await writeUpdateState(env, {
    ...state,
    lastCheck: timestamp,
    latestVersion,
  });
  return {
    currentVersion,
    latestVersion,
    updateAvailable: isNewerVersion(latestVersion, currentVersion),
  };
}

export interface SelfUpdateResult {
  updated: boolean;
  message: string;
}

export type ExecImpl = (command: string, args: string[]) => Promise<void>;

export function defaultExecImpl(command: string, args: string[]): Promise<void> {
  const useShell = process.platform === "win32";
  return new Promise((resolve, reject) => {
    const child = useShell
      ? spawn(quoteForShell(command, args), { stdio: "inherit", shell: true, windowsHide: true })
      : spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
      }
    });
  });
}

export type WhichImpl = (command: string) => Promise<string | null>;

export const defaultWhichImpl: WhichImpl = async (command: string): Promise<string | null> => {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "where" : "which";
  return new Promise((resolve) => {
    const child = spawn(cmd, [command], {
      windowsHide: true,
      shell: isWin,
    });
    let out = "";
    child.stdout?.on("data", (d) => {
      out += String(d);
    });
    child.on("error", () => resolve(null));
    child.on("exit", (code) => {
      if (code === 0) {
        const line = out
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l.length > 0);
        resolve(line ?? null);
      } else {
        resolve(null);
      }
    });
  });
};

const NPX_MARKERS = ["_npx", "npm-cache", "/.bun/install/cache/"];
const BUN_GLOBAL_MARKERS = ["/.bun/install/global/", "/.bun/bin/"];
const GLOBAL_MARKERS = [
  "appdata/roaming/npm",
  "/usr/local/lib/node_modules",
  "/usr/lib/node_modules",
  "/opt/homebrew/lib/node_modules",
  "/opt/homebrew/bin",
];

export interface PerformSelfUpdateOptions {
  execImpl?: ExecImpl;
  entryPath?: string;
  whichImpl?: WhichImpl;
  realpathImpl?: (p: string) => Promise<string>;
}

export async function performSelfUpdate(
  options: PerformSelfUpdateOptions = {},
): Promise<SelfUpdateResult> {
  const exec = options.execImpl ?? defaultExecImpl;
  const which = options.whichImpl ?? defaultWhichImpl;
  const realpathFn = options.realpathImpl ?? realpath;

  let entry: string;
  try {
    entry = options.entryPath ?? (await realpathFn(process.argv[1] ?? ""));
  } catch {
    entry = options.entryPath ?? process.argv[1] ?? "";
  }
  const normalized = entry.split(path.sep).join("/").toLowerCase();

  if (
    NPX_MARKERS.some((marker) => normalized.includes(marker)) ||
    normalized.includes("/node_modules/.bin/")
  ) {
    return {
      updated: false,
      message:
        "running via npx/bunx (not a global install). Run `npx repotruck@latest` to use the latest version.",
    };
  }

  const runGlobalUpdate = async (): Promise<SelfUpdateResult> => {
    const useBun = BUN_GLOBAL_MARKERS.some((marker) => normalized.includes(marker));
    const command = useBun ? "bun" : "npm";
    const updateArgs = useBun ? ["add", "-g", "repotruck@latest"] : ["i", "-g", "repotruck@latest"];
    try {
      await exec(command, updateArgs);
      return {
        updated: true,
        message: `self-update complete (${command} ${updateArgs.join(" ")})`,
      };
    } catch (error) {
      return { updated: false, message: firstErrorLine(error) };
    }
  };

  let whichResolved: string | null = null;
  try {
    whichResolved = await which("repotruck");
  } catch {
    whichResolved = null;
  }

  if (whichResolved !== null) {
    let whichReal = whichResolved;
    try {
      whichReal = await realpathFn(whichResolved);
    } catch {
      whichReal = whichResolved;
    }
    const normWhich = whichReal.split(path.sep).join("/").toLowerCase();
    if (normWhich === normalized) {
      return runGlobalUpdate();
    }
  }

  if (!normalized.includes("/node_modules/")) {
    return {
      updated: false,
      message: "running from source — no self-update attempted",
    };
  }

  if (BUN_GLOBAL_MARKERS.some((marker) => normalized.includes(marker))) {
    return runGlobalUpdate();
  }

  if (GLOBAL_MARKERS.some((marker) => normalized.includes(marker))) {
    return runGlobalUpdate();
  }

  return {
    updated: false,
    message:
      "repotruck is not installed globally. Run `npx repotruck@latest` to use the latest version, or `npm i -g repotruck` to install it.",
  };
}

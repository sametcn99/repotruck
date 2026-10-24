import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { type AuthProbe, probeAuth } from "./auth.ts";
import type { EnvLike } from "./config.ts";
import { readWorkspaceEntries, type WorkspaceEntry } from "./workspaceRegistry.ts";

const execFileAsync = promisify(execFile);

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  status: DoctorStatus;
  check: string;
  detail: string;
  suggestion?: string;
  formatted: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorDeps {
  env?: EnvLike;
  whichImpl?: (cmd: string) => Promise<string | null>;
  execImpl?: (cmd: string, args: string[]) => Promise<{ stdout: string }>;
  probeAuthImpl?: (env: EnvLike) => Promise<AuthProbe>;
  readEntriesImpl?: (env?: EnvLike) => Promise<WorkspaceEntry[]>;
  existsSyncImpl?: (p: string) => boolean;
}

export async function defaultWhich(cmd: string): Promise<string | null> {
  const isWin = process.platform === "win32";
  const runner = isWin ? "where" : "which";
  try {
    const res = await execFileAsync(runner, [cmd], { timeout: 5000, windowsHide: true });
    const first = res.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

export async function defaultExec(cmd: string, args: string[]): Promise<{ stdout: string }> {
  return execFileAsync(cmd, args, { timeout: 5000, windowsHide: true });
}

function makeCheck(
  status: DoctorStatus,
  check: string,
  detail: string,
  suggestion?: string,
): DoctorCheck {
  let formatted = `[${status}] ${check}: ${detail}`;
  if (suggestion !== undefined && suggestion.length > 0) {
    formatted += `\n  -> ${suggestion}`;
  }
  return { status, check, detail, suggestion, formatted };
}

export async function runDoctor(deps: DoctorDeps = {}): Promise<DoctorResult> {
  const env = deps.env ?? process.env;
  const which = deps.whichImpl ?? defaultWhich;
  const exec = deps.execImpl ?? defaultExec;
  const probeAuthFn = deps.probeAuthImpl ?? probeAuth;
  const readEntriesFn = deps.readEntriesImpl ?? readWorkspaceEntries;
  const existsFn = deps.existsSyncImpl ?? existsSync;

  const checks: DoctorCheck[] = [];

  // 1. git check
  const gitPath = await which("git");
  if (gitPath === null) {
    checks.push(
      makeCheck("fail", "git", "git not found in PATH", "install git and add it to PATH"),
    );
  } else {
    try {
      const ver = await exec("git", ["--version"]);
      const versionStr = ver.stdout.trim();
      checks.push(makeCheck("ok", "git", versionStr));
    } catch (error) {
      checks.push(
        makeCheck(
          "fail",
          "git",
          `git found at ${gitPath} but execution failed: ${String(error)}`,
          "check your git installation",
        ),
      );
    }
  }

  // 2. gh check
  const ghPath = await which("gh");
  if (ghPath === null) {
    checks.push(
      makeCheck(
        "warn",
        "gh",
        "GitHub CLI (gh) not found in PATH",
        "install gh for seamless authentication, or use REPOTRUCK_TOKEN / repotruck auth login",
      ),
    );
  } else {
    checks.push(makeCheck("ok", "gh", `found at ${ghPath}`));
  }

  // 3. token check
  const auth = await probeAuthFn(env);
  if (auth.method === "none") {
    checks.push(
      makeCheck(
        "fail",
        "token",
        "no GitHub token found",
        "run 'repotruck auth login' or install gh and run 'gh auth login' or set REPOTRUCK_TOKEN",
      ),
    );
  } else {
    checks.push(makeCheck("ok", "token", `authenticated via ${auth.method}`));
  }

  // 4. config check
  let entries: WorkspaceEntry[] | null = null;
  try {
    entries = await readEntriesFn(env);
    const count = entries.length;
    checks.push(makeCheck("ok", "config", `central registry valid (${count} workspaces)`));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    checks.push(
      makeCheck(
        "fail",
        "config",
        `central store corrupt (${msg})`,
        "restore from repotruck.json.bak or remove the corrupt file",
      ),
    );
  }

  // 5. disk check
  if (entries !== null) {
    const paths = entries.map((e) => e.root);
    const missing: string[] = [];
    for (const p of paths) {
      if (!existsFn(p)) missing.push(p);
    }
    if (missing.length > 0) {
      checks.push(
        makeCheck(
          "warn",
          "disk",
          `missing workspace root(s): ${missing.join(", ")}`,
          "run 'repotruck workspaces remove <path>' to clean up records",
        ),
      );
    } else {
      checks.push(
        makeCheck(
          "ok",
          "disk",
          paths.length === 0
            ? "0 workspaces registered"
            : `all ${paths.length} workspace roots exist on disk`,
        ),
      );
    }
  }

  const ok = !checks.some((c) => c.status === "fail");
  return { ok, checks };
}

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { detectTuiRuntimeError } from "../cliSupport.ts";
import { type AuthProbe, probeAuth } from "./auth.ts";
import { firstErrorLine } from "./cloner.ts";
import type { EnvLike } from "./config.ts";
import { defaultGrammarCacheDir, GRAMMAR_FILES } from "./grammarStore.ts";
import { workspaceTrashDir } from "./lifecycle.ts";
import {
  type ReorganizeJournal,
  readReorganizeJournal,
  reorganizeJournalPath,
  reorganizeWorkspace,
} from "./reorganizer.ts";
import { formatDiskSize } from "./stats.ts";
import { listTrashEntries, type TrashEntry } from "./trash.ts";
import { readWorkspaceEntries, type WorkspaceEntry } from "./workspaceRegistry.ts";

const execFileAsync = promisify(execFile);

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  status: DoctorStatus;
  check: string;
  detail: string;
  suggestion?: string;
  formatted: string;
  workspaceRoot?: string;
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
  tuiRuntimeImpl?: () => string | null;
  readJournalImpl?: (root: string) => ReorganizeJournal | null;
  listTrashImpl?: (root: string) => TrashEntry[];
  grammarCacheDirImpl?: (env?: EnvLike) => string;
  onFixProgress?: (message: string) => void;
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
  workspaceRoot?: string,
): DoctorCheck {
  let formatted = `[${status}] ${check}: ${detail}`;
  if (suggestion !== undefined && suggestion.length > 0) {
    formatted += `\n  -> ${suggestion}`;
  }
  return { status, check, detail, suggestion, formatted, workspaceRoot };
}

export async function runDoctor(deps: DoctorDeps = {}): Promise<DoctorResult> {
  const env = deps.env ?? process.env;
  const which = deps.whichImpl ?? defaultWhich;
  const exec = deps.execImpl ?? defaultExec;
  const probeAuthFn = deps.probeAuthImpl ?? probeAuth;
  const readEntriesFn = deps.readEntriesImpl ?? readWorkspaceEntries;
  const existsFn = deps.existsSyncImpl ?? existsSync;
  const readJournalFn = deps.readJournalImpl ?? readReorganizeJournal;
  const listTrashFn = deps.listTrashImpl ?? listTrashEntries;
  const tuiRuntimeImpl = deps.tuiRuntimeImpl ?? detectTuiRuntimeError;

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

  // 5. disk, reorganize & trash checks
  if (entries !== null) {
    const paths = entries.map((e) => e.root);
    const missing: string[] = [];
    for (const p of paths) {
      if (!existsFn(p)) missing.push(p);
    }
    if (missing.length > 0) {
      const listed =
        missing.length <= 3
          ? missing.join(", ")
          : `${missing.slice(0, 3).join(", ")} (+${missing.length - 3} more)`;
      checks.push(
        makeCheck(
          "warn",
          "disk",
          `missing workspace root(s): ${listed}`,
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

    // Check for unfinished or corrupt reorganize journals and accumulated trash across workspace roots
    for (const p of paths) {
      const journalPath = reorganizeJournalPath(p);
      const hasJournal = deps.readJournalImpl !== undefined || existsFn(journalPath);
      if (hasJournal) {
        try {
          const journal = readJournalFn(p);
          if (journal !== null) {
            checks.push(
              makeCheck(
                "fail",
                "reorganize",
                `unfinished reorganize in progress: ${p}`,
                "run 'repotruck reorganize --resume' or 'repotruck doctor --fix' to recover",
                p,
              ),
            );
          }
        } catch {
          checks.push(
            makeCheck(
              "fail",
              "reorganize",
              `corrupt reorganize journal in ${p}`,
              `repair or delete ${journalPath}`,
              p,
            ),
          );
        }
      }

      const trashDir = workspaceTrashDir(p);
      const hasTrashDir = deps.listTrashImpl !== undefined || existsFn(trashDir);
      if (hasTrashDir) {
        try {
          const trashed = listTrashFn(p);
          if (trashed.length > 0) {
            const bytes = trashed.reduce((sum, item) => sum + item.sizeBytes, 0);
            checks.push(
              makeCheck(
                "warn",
                "trash",
                `${trashed.length} trashed repo(s) in ${p} (${formatDiskSize(bytes)})`,
                "run 'repotruck trash list' to inspect or 'repotruck trash empty --yes' to reclaim disk space",
                p,
              ),
            );
          }
        } catch {
          /* ignore unreadable trash directory */
        }
      }
    }
  }

  // 6. grammars check (Sprint 05b)
  const shouldCheckGrammars =
    deps.grammarCacheDirImpl !== undefined ||
    deps.env !== undefined ||
    deps.whichImpl === undefined;

  if (shouldCheckGrammars) {
    const cacheDir =
      deps.grammarCacheDirImpl !== undefined
        ? deps.grammarCacheDirImpl(env)
        : (env.REPOTRUCK_GRAMMARS_DIR ?? defaultGrammarCacheDir(env));

    const totalGrammars = Object.keys(GRAMMAR_FILES).length;
    let cachedCount = 0;
    for (const file of Object.values(GRAMMAR_FILES)) {
      if (existsFn(path.join(cacheDir, file))) {
        cachedCount += 1;
      }
    }

    if (cachedCount === totalGrammars) {
      checks.push(makeCheck("ok", "grammars", `${cachedCount}/${totalGrammars} grammars cached`));
    } else if (cachedCount > 0) {
      checks.push(
        makeCheck(
          "warn",
          "grammars",
          `${cachedCount}/${totalGrammars} grammars cached`,
          "run 'repotruck search-code' without --offline to download missing grammars or set REPOTRUCK_GRAMMARS_DIR",
        ),
      );
    } else {
      checks.push(
        makeCheck(
          "warn",
          "grammars",
          `0/${totalGrammars} grammars cached`,
          "run 'repotruck search-code' to download grammars on demand, or set REPOTRUCK_GRAMMARS_DIR",
        ),
      );
    }
  }

  // 7. TUI runtime check (Sprint 8a) — warning level: the headless commands
  // work regardless; only the interactive dashboard needs the newer runtime.
  const tuiProblem = tuiRuntimeImpl();
  if (tuiProblem !== null) {
    checks.push(
      makeCheck(
        "warn",
        "tui-runtime",
        tuiProblem,
        "headless subcommands (sync, clone, status, ...) are unaffected; the interactive dashboard needs the newer runtime",
      ),
    );
  }

  const ok = !checks.some((c) => c.status === "fail");
  return { ok, checks };
}

export async function fixDoctor(deps: DoctorDeps = {}): Promise<DoctorResult> {
  const result = await runDoctor(deps);
  if (result.ok) return result;

  const existsFn = deps.existsSyncImpl ?? existsSync;
  const reorgFails = result.checks.filter(
    (c) =>
      c.check === "reorganize" &&
      c.status === "fail" &&
      c.workspaceRoot !== undefined &&
      c.detail.startsWith("unfinished reorganize in progress: "),
  );

  for (const failCheck of reorgFails) {
    const root = failCheck.workspaceRoot!;
    deps.onFixProgress?.(`fix: resuming unfinished reorganize in ${root}`);
    try {
      await reorganizeWorkspace(root, undefined, {
        resume: true,
        env: deps.env,
        existsSyncImpl: existsFn,
      });
      deps.onFixProgress?.(`\u2713 reconciled and cleaned up journal in ${root}`);
    } catch (err) {
      deps.onFixProgress?.(`failed to resume reorganize in ${root}: ${firstErrorLine(err)}`);
    }
  }

  return await runDoctor(deps);
}

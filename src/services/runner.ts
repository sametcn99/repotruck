import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createCloneLimiter, DEFAULT_CONCURRENCY, firstErrorLine } from "./cloner.ts";
import type { RepoInventoryEntry, RepotruckConfig } from "./config.ts";
import { resolveRepoRef } from "./launcher.ts";
import { isCmdShim, quoteForShell } from "./shellQuote.ts";

/** Caps buffered per-repo output so runaway commands cannot exhaust memory. */
export const MAX_CAPTURED_OUTPUT_CHARS = 200_000;

export interface RunCommandRequest {
  command: string;
  args: readonly string[];
  cwd: string;
}

export interface RunCommandOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  message?: string;
}

export type RunCommandImpl = (request: RunCommandRequest) => Promise<RunCommandOutcome>;

export function defaultRunCommandImpl(request: RunCommandRequest): Promise<RunCommandOutcome> {
  const run = (useShell: boolean): Promise<RunCommandOutcome> =>
    new Promise((resolve, reject) => {
      const command = useShell
        ? quoteForShell(request.command, request.args, { cmdShim: isCmdShim(request.command) })
        : request.command;
      const args = useShell ? [] : [...request.args];
      const child = spawn(command, args, {
        cwd: request.cwd,
        shell: useShell,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdout.length < MAX_CAPTURED_OUTPUT_CHARS) stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < MAX_CAPTURED_OUTPUT_CHARS) stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ exitCode: code, stdout, stderr }));
    });
  return run(false).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return run(true);
    }
    throw error;
  });
}

export interface RunInReposOptions {
  root: string;
  config: RepotruckConfig;
  refs: readonly string[];
  command: string;
  args?: readonly string[];
  concurrency?: number;
  runImpl?: RunCommandImpl;
  exists?: (dir: string) => boolean;
}

export interface RunRepoResult {
  key: string;
  relativePath: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  message?: string;
}

export interface RunInReposResult {
  results: RunRepoResult[];
  skipped: Array<{ key: string; message: string }>;
}

export function selectRunTargets(
  config: RepotruckConfig,
  refs: readonly string[],
): { entries: RepoInventoryEntry[]; skipped: RunInReposResult["skipped"] } {
  const skipped: RunInReposResult["skipped"] = [];
  if (refs.length === 0) {
    return { entries: [...config.repos], skipped };
  }
  const entries: RepoInventoryEntry[] = [];
  for (const ref of refs) {
    const match = resolveRepoRef(config, ref);
    if (match === null) {
      skipped.push({ key: ref, message: `not tracked by repotruck: ${ref}` });
    } else if (!entries.some((item) => item === match.entry)) {
      entries.push(match.entry);
    }
  }
  return { entries, skipped };
}

export async function runInRepos(options: RunInReposOptions): Promise<RunInReposResult> {
  const runImpl = options.runImpl ?? defaultRunCommandImpl;
  const exists = options.exists ?? existsSync;
  const limit = createCloneLimiter(options.concurrency ?? DEFAULT_CONCURRENCY);
  const args = options.args ?? [];
  const { entries, skipped } = selectRunTargets(options.config, options.refs);
  const results: RunRepoResult[] = [];

  await Promise.all(
    entries.map((entry) =>
      limit(async () => {
        const key = `${entry.owner}/${entry.name}`;
        const repoDir = path.join(options.root, ...entry.relativePath.split("/"));
        if (!exists(repoDir)) {
          skipped.push({ key, message: `${entry.relativePath} is not on disk` });
          return;
        }
        const startedAt = Date.now();
        try {
          const outcome = await runImpl({ command: options.command, args, cwd: repoDir });
          results.push({
            key,
            relativePath: entry.relativePath,
            ok: outcome.exitCode === 0,
            exitCode: outcome.exitCode,
            durationMs: Date.now() - startedAt,
            stdout: outcome.stdout,
            stderr: outcome.stderr,
            message: outcome.message,
          });
        } catch (error) {
          results.push({
            key,
            relativePath: entry.relativePath,
            ok: false,
            exitCode: null,
            durationMs: Date.now() - startedAt,
            stdout: "",
            stderr: "",
            message: firstErrorLine(error),
          });
        }
      }),
    ),
  );

  results.sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  );
  skipped.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { results, skipped };
}

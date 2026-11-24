import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createCloneLimiter, DEFAULT_CONCURRENCY, firstErrorLine } from "./cloner.ts";
import type { RepoInventoryEntry, RepotruckConfig } from "./config.ts";
import { resolveRepoRef } from "./launcher.ts";
import { trackChild } from "./processScope.ts";
import { isCmdShim, quoteForShell, resolveWindowsCommand } from "./shellQuote.ts";
import { workspacePath } from "./workspacePaths.ts";

/** Caps buffered per-repo output so runaway commands cannot exhaust memory. */
export const MAX_CAPTURED_OUTPUT_CHARS = 200_000;

export interface RunCommandRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  signal?: AbortSignal;
}

export interface RunCommandOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  message?: string;
}

export type RunCommandImpl = (request: RunCommandRequest) => Promise<RunCommandOutcome>;

export function defaultRunCommandImpl(request: RunCommandRequest): Promise<RunCommandOutcome> {
  const executable = resolveWindowsCommand(request.command, request.cwd);
  const run = (useShell: boolean): Promise<RunCommandOutcome> =>
    new Promise((resolve, reject) => {
      const command = useShell
        ? quoteForShell(executable, request.args, { cmdShim: isCmdShim(executable) })
        : executable;
      const args = useShell ? [] : [...request.args];
      const child = spawn(command, args, {
        cwd: request.cwd,
        shell: useShell,
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      trackChild(child, request.signal);
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk.slice(0, Math.max(0, MAX_CAPTURED_OUTPUT_CHARS - stdout.length));
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk.slice(0, Math.max(0, MAX_CAPTURED_OUTPUT_CHARS - stderr.length));
      });
      child.on("error", reject);
      child.on("close", (code, signal) =>
        resolve({
          exitCode: code,
          stdout,
          stderr,
          ...(signal ? { message: `terminated by ${signal}` } : {}),
        }),
      );
    });
  return run(process.platform === "win32" && isCmdShim(executable)).catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return run(true);
      }
      throw error;
    },
  );
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
  signal?: AbortSignal;
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
        let repoDir: string;
        try {
          repoDir = workspacePath(options.root, entry.relativePath);
        } catch (error) {
          skipped.push({ key, message: firstErrorLine(error) });
          return;
        }
        if (!exists(repoDir)) {
          skipped.push({ key, message: `${entry.relativePath} is not on disk` });
          return;
        }
        const startedAt = Date.now();
        try {
          options.signal?.throwIfAborted();
          const outcome = await runImpl({
            command: options.command,
            args,
            cwd: repoDir,
            ...(options.signal ? { signal: options.signal } : {}),
          });
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

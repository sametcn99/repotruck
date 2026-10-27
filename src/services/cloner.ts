import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pLimit from "p-limit";
import { simpleGit } from "simple-git";
import type { EnvLike } from "./config.ts";
import { warnQuiet } from "./diagnostics.ts";

const execFileAsync = promisify(execFile);

export const DEFAULT_CONCURRENCY = 3;

export type LimitFunction = ReturnType<typeof pLimit>;

export function createCloneLimiter(concurrency: number): LimitFunction {
  return pLimit(Math.max(1, concurrency));
}

export type ClonePhase = "cloning" | "pulling" | "done" | "failed" | "skipped";

export type DivergenceStrategy = "fail" | "rebase" | "reset" | "skip";

export const DIVERGENCE_STRATEGIES: readonly DivergenceStrategy[] = [
  "fail",
  "rebase",
  "reset",
  "skip",
];

export function isDivergenceStrategy(value: string): value is DivergenceStrategy {
  return (DIVERGENCE_STRATEGIES as readonly string[]).includes(value);
}

export interface CloneProgress {
  key: string;
  owner: string;
  name: string;
  phase: ClonePhase;
  message?: string;
}

export interface CloneTarget {
  owner: string;
  name: string;
  httpsUrl: string;
  sshUrl: string;
  destDir: string;
}

export type EmitProgress = (progress: CloneProgress) => void;

export function tokenizedUrl(httpsUrl: string, token: string): string {
  const url = new URL(httpsUrl);
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}

export function basicAuthExtraHeader(token: string): string {
  const encoded = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return `AUTHORIZATION: basic ${encoded}`;
}

const EXTRAHEADER_CONFIG_KEY = "http.https://github.com/.extraheader";

/** Derives the git extraheader config key from a remote URL's origin. */
export function extraHeaderKeyForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `http.${parsed.origin}/.extraheader`;
  } catch {
    return EXTRAHEADER_CONFIG_KEY;
  }
}

const TOKEN_ENV_KEYS = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"] as const;

type EnvCarrier = { env: (values: NodeJS.ProcessEnv) => unknown };

/**
 * Git env-based config (git >= 2.31) so the auth token reaches git through the
 * child process environment instead of its command line, where process lists
 * could read it.
 */
export function tokenAuthEnv(url: string, token: string): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: extraHeaderKeyForUrl(url),
    GIT_CONFIG_VALUE_0: basicAuthExtraHeader(token),
  };
}

/**
 * Creates a simple-git instance that carries the GitHub token via
 * `GIT_CONFIG_*` environment variables (never via `-c` argv). Exported for
 * other flows (create/push) that need authenticated git too.
 */
export function gitWithTokenAuth(
  baseDir: string | undefined,
  url: string,
  token: string | null | undefined,
  preferSsh?: boolean,
): ReturnType<typeof simpleGit> {
  const options = {
    allowEnvironment: [...TOKEN_ENV_KEYS],
    unsafe: { allowUnsafeConfigEnvCount: true },
  };
  const git = baseDir === undefined ? simpleGit(options) : simpleGit(baseDir, options);
  if (token !== undefined && token !== null && token.length > 0 && preferSsh !== true) {
    (git as unknown as EnvCarrier).env(tokenAuthEnv(url, token));
  }
  return git;
}

const authedGit = gitWithTokenAuth;

const GIT_TRANSIENT_PATTERN =
  /(could not resolve host|connection|timed out|timeout|early eof|rpc failed|unable to access|reset by peer|network is unreachable|temporary)/i;

/** Retries a pure-network git operation once on transient failures. */
async function withGitRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!GIT_TRANSIENT_PATTERN.test(message)) throw error;
    return await operation();
  }
}

/**
 * Checks that an existing repository's origin really points at the expected
 * repository, so repotruck never fetches/pulls an unrelated checkout that
 * happens to sit at the destination path.
 */
export function originMatchesRepo(remoteUrl: string, owner: string, name: string): boolean {
  let url = remoteUrl.trim().toLowerCase().replace(/\/+$/, "");
  if (url.endsWith(".git")) url = url.slice(0, -".git".length).replace(/\/+$/, "");
  const suffix = `/${owner.toLowerCase()}/${name.toLowerCase()}`;
  if (url.endsWith(suffix)) return true;
  const colon = url.indexOf(":");
  if (colon >= 0 && !url.startsWith("http")) {
    return url.slice(colon + 1) === `${owner.toLowerCase()}/${name.toLowerCase()}`;
  }
  return false;
}

function originMatchesTarget(remoteUrl: string, target: CloneTarget): boolean {
  const url = remoteUrl.trim();
  if (url.length === 0) return false;
  return (
    url === target.httpsUrl ||
    url === target.sshUrl ||
    originMatchesRepo(url, target.owner, target.name)
  );
}

export interface SshProbeDeps {
  env?: EnvLike;
  homeDir?: string;
  readHomeSshDir?: (homeDir: string) => Promise<string[]>;
  runProbe?: () => Promise<boolean>;
}

let cachedSshAvailability: boolean | null = null;

async function readHomeSshDirDefault(homeDir: string): Promise<string[]> {
  try {
    return await readdir(path.join(homeDir, ".ssh"));
  } catch {
    return [];
  }
}

async function sshConfigMentionsGithub(homeDir: string): Promise<boolean> {
  try {
    const raw = await readFile(path.join(homeDir, ".ssh", "config"), "utf8");
    return raw.includes("github.com");
  } catch {
    return false;
  }
}

async function runRealSshProbe(env: EnvLike = process.env): Promise<boolean> {
  try {
    await execFileAsync(
      "ssh",
      [
        "-T",
        "git@github.com",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=5",
      ],
      { timeout: 10_000, windowsHide: true },
    );
    return true;
  } catch (error) {
    const err = error as { code?: unknown; stderr?: unknown };
    if (
      err.code === 1 &&
      typeof err.stderr === "string" &&
      err.stderr.includes("successfully authenticated")
    ) {
      return true;
    }
    warnQuiet("ssh: github.com probe failed", error, env);
    return false;
  }
}

async function probeSsh(deps: SshProbeDeps): Promise<boolean> {
  const home = deps.homeDir ?? homedir();
  const entries =
    deps.readHomeSshDir !== undefined
      ? await deps.readHomeSshDir(home)
      : await readHomeSshDirDefault(home);
  const keyNames = ["id_ed25519", "id_ecdsa", "id_rsa"];
  const hasKey = entries.some((entry) => keyNames.includes(entry));
  const hasGithubConfig = entries.includes("config") && (await sshConfigMentionsGithub(home));
  if (!hasKey && !hasGithubConfig) return false;
  if (deps.runProbe !== undefined) return deps.runProbe();
  return runRealSshProbe(deps.env);
}

export async function detectSshAvailability(deps: SshProbeDeps = {}): Promise<boolean> {
  const env = deps.env ?? process.env;
  const injected =
    deps.runProbe !== undefined ||
    deps.readHomeSshDir !== undefined ||
    deps.homeDir !== undefined ||
    deps.env !== undefined;
  if (env.REPOTRUCK_NO_SSH) {
    if (!injected) cachedSshAvailability = false;
    return false;
  }
  if (!injected && cachedSshAvailability !== null) {
    return cachedSshAvailability;
  }
  const result = await probeSsh(deps);
  if (!injected) {
    cachedSshAvailability = result;
  }
  return result;
}

export function firstErrorLine(error: unknown, token?: string | null): string {
  const raw = error instanceof Error ? error.message : String(error);
  let line = (raw.split(/\r?\n/, 1)[0] ?? raw).trim();
  if (token !== undefined && token !== null && token.length > 0) {
    line = line.split(token).join("***");
  }
  return line;
}

export interface CloneOrUpdateOptions {
  token?: string | null;
  preferSsh?: boolean;
  depth?: number;
  blobless?: boolean;
  stash?: boolean;
  divergence?: DivergenceStrategy;
  sparse?: string[];
}

function progress(target: CloneTarget, phase: ClonePhase, message?: string): CloneProgress {
  return {
    key: `${target.owner}/${target.name}`,
    owner: target.owner,
    name: target.name,
    phase,
    ...(message !== undefined ? { message } : {}),
  };
}

interface AheadBehind {
  ahead: number;
  behind: number;
}

export async function aheadBehindCount(git: ReturnType<typeof simpleGit>): Promise<AheadBehind> {
  const raw = await git.raw(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
  const [behindText, aheadText] = raw.trim().split(/\s+/);
  return {
    ahead: Number.parseInt(aheadText ?? "0", 10) || 0,
    behind: Number.parseInt(behindText ?? "0", 10) || 0,
  };
}

async function updateRepository(
  git: ReturnType<typeof simpleGit>,
  options: CloneOrUpdateOptions,
  report: (phase: ClonePhase, message?: string) => CloneProgress,
): Promise<CloneProgress> {
  const { token, stash, divergence = "fail" } = options;

  await withGitRetry(() => git.raw(["fetch", "--prune"]));

  const status = await git.raw(["status", "--porcelain"]);
  const dirty = status.trim().length > 0;
  if (dirty && stash !== true) {
    return report("failed", "dirty worktree (use --stash or commit first)");
  }
  if (dirty) {
    await git.raw(["stash", "push", "--include-untracked", "-m", "repotruck-sync"]);
  }
  const finishStash = async (): Promise<CloneProgress | null> => {
    if (!dirty) return null;
    try {
      await git.raw(["stash", "pop"]);
      return null;
    } catch (error) {
      return report("failed", `stash pop failed (${firstErrorLine(error, token ?? null)})`);
    }
  };

  try {
    const { ahead, behind } = await aheadBehindCount(git);
    if (ahead === 0 && behind === 0) {
      const stashed = await finishStash();
      if (stashed !== null) return stashed;
      return report("done", "up to date");
    }
    if (ahead === 0 && behind > 0) {
      await git.raw(["pull", "--ff-only"]);
      const stashed = await finishStash();
      if (stashed !== null) return stashed;
      return report("done", "updated");
    }

    const aheadLabel = `ahead ${ahead}${behind > 0 ? `, behind ${behind}` : ""}`;
    if (divergence === "skip") {
      const stashed = await finishStash();
      if (stashed !== null) return stashed;
      return report("skipped", `${aheadLabel} — divergence skip`);
    }
    if (divergence === "fail") {
      const stashed = await finishStash();
      if (stashed !== null) return stashed;
      return report(
        "failed",
        `local commits ${aheadLabel} — use --divergence rebase, reset, or skip`,
      );
    }
    if (divergence === "rebase") {
      try {
        await git.raw(["pull", "--rebase"]);
      } catch (error) {
        try {
          await git.raw(["rebase", "--abort"]);
        } catch {
          /* best effort: leave the repo in whatever state git holds */
        }
        return report("failed", firstErrorLine(error, token ?? null));
      }
      const stashed = await finishStash();
      if (stashed !== null) return stashed;
      return report("done", `rebased (${aheadLabel})`);
    }
    await git.raw(["reset", "--hard", "@{upstream}"]);
    const stashed = await finishStash();
    if (stashed !== null) return stashed;
    return report("done", `reset to origin (discarded ${aheadLabel})`);
  } catch (error) {
    return report("failed", firstErrorLine(error, token ?? null));
  }
}

export async function cloneOrUpdate(
  target: CloneTarget,
  options: CloneOrUpdateOptions = {},
  emit?: EmitProgress,
): Promise<CloneProgress> {
  const { token, preferSsh, depth, blobless } = options;
  const report = (phase: ClonePhase, message?: string): CloneProgress => {
    const item = progress(target, phase, message);
    emit?.(item);
    return item;
  };

  try {
    if (existsSync(target.destDir)) {
      report("pulling");
      const git = authedGit(target.destDir, target.httpsUrl, token, preferSsh);
      let inside: string;
      try {
        inside = await git.raw(["rev-parse", "--is-inside-work-tree"]);
      } catch {
        return report("failed", "destination exists and is not a Git repository");
      }
      if (inside.trim() !== "true") {
        return report("failed", "destination exists and is not a Git repository");
      }
      let originUrl: string | null = null;
      try {
        originUrl = (await git.raw(["remote", "get-url", "origin"])).trim();
      } catch {
        originUrl = null;
      }
      if (originUrl === null || originUrl.length === 0) {
        return report(
          "failed",
          `destination exists but has no origin remote (expected ${target.owner}/${target.name}) — remove it or point origin at the repository`,
        );
      }
      if (!originMatchesTarget(originUrl, target)) {
        return report(
          "failed",
          `destination exists and tracks a different repository (origin: ${originUrl}, expected ${target.owner}/${target.name}) — move it away or repoint origin`,
        );
      }
      return await updateRepository(git, options, report);
    }

    report("cloning");
    await mkdir(path.dirname(target.destDir), { recursive: true });
    const useToken = Boolean(token) && !preferSsh;
    const sourceUrl = preferSsh ? target.sshUrl : target.httpsUrl;
    const git = authedGit(undefined, target.httpsUrl, token, preferSsh);
    const hasSparse = Array.isArray(options.sparse) && options.sparse.length > 0;
    const cloneArgs = ["clone"];
    if (depth !== undefined) cloneArgs.push("--depth", String(depth));
    if (blobless === true) cloneArgs.push("--filter=blob:none");
    if (hasSparse) cloneArgs.push("--no-checkout");
    cloneArgs.push(sourceUrl, target.destDir);
    await withGitRetry(() => git.raw(cloneArgs));
    if (hasSparse) {
      const destGit = authedGit(target.destDir, target.httpsUrl, token, preferSsh);
      await destGit.raw(["sparse-checkout", "set", ...(options.sparse ?? [])]);
      await destGit.raw(["checkout"]);
    }
    if (useToken) {
      await simpleGit(target.destDir).raw(["remote", "set-url", "origin", target.httpsUrl]);
    }
    return report("done", hasSparse ? "cloned (sparse)" : "cloned");
  } catch (error) {
    return report("failed", firstErrorLine(error, token ?? null));
  }
}

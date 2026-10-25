import { existsSync } from "node:fs";
import path from "node:path";
import { isPresetId, PRESET_IDS, type PresetRef } from "../presets/index.ts";
import { AuthError, getAuthInfo } from "../services/auth.ts";
import { type CloneProgress, type EmitProgress, firstErrorLine } from "../services/cloner.ts";
import { appConfigDir, CONFIG_FILENAME } from "../services/config.ts";
import { fileEtagCache, GitHubService } from "../services/github.ts";
import { effectiveRoot, readCustomPresets } from "../services/settings.ts";
import { isRegisteredWorkspace, resolveWorkspaceRoot } from "../services/workspaceRegistry.ts";

/**
 * Control-flow signal for CLI termination. Throwing (instead of calling
 * process.exit) lets finally blocks run, keeps locks/releases intact, and
 * gives stdout time to flush; the CLI entry converts it into process.exitCode.
 */
export class CliExit extends Error {
  constructor(public code: number) {
    super(`cli exit ${code}`);
    this.name = "CliExit";
  }
}

export function exitFail(message: string, isJson?: boolean, command?: string): never {
  if (isJson) {
    process.stdout.write(
      `${JSON.stringify({ command: command ?? "repotruck", ok: false, error: message })}\n`,
    );
    throw new CliExit(1);
  }
  process.stderr.write(`error: ${message}\n`);
  throw new CliExit(1);
}

export async function runAction(
  action: () => Promise<void>,
  options?: { command?: string; json?: boolean },
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof CliExit) {
      process.exitCode = error.code;
      return;
    }
    if (options?.json) {
      const err = error instanceof AuthError ? error.message : firstErrorLine(error);
      process.stdout.write(
        `${JSON.stringify({ command: options.command ?? "repotruck", ok: false, error: err })}\n`,
      );
      process.exitCode = 1;
      return;
    }
    if (error instanceof AuthError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`error: ${firstErrorLine(error)}\n`);
    }
    process.exitCode = 1;
  }
}

export async function resolveRootOption(dirOption?: string): Promise<string> {
  if (dirOption !== undefined) return path.resolve(dirOption);
  const walked = await resolveWorkspaceRoot(process.cwd());
  if (walked.found) return walked.root;
  const effective = await effectiveRoot(process.env);
  return effective.root;
}

export async function requireExistingRoot(dirOption?: string): Promise<string> {
  const root = await resolveRootOption(dirOption);
  const registered = await isRegisteredWorkspace(root);
  const legacy = existsSync(path.join(root, CONFIG_FILENAME));
  if (!registered && !legacy) {
    throw new Error(
      `not a repotruck workspace (no record for it in the central repotruck.json): ${root}`,
    );
  }
  return root;
}

export function requirePreset(value: string, json?: boolean, command?: string): Promise<PresetRef> {
  return (async () => {
    if (isPresetId(value)) return value;
    const customs = await readCustomPresets(process.env);
    if (customs.some((preset) => preset.id === value)) return value;
    exitFail(
      `invalid preset: ${value} (expected ${PRESET_IDS.join(", ")}, or a custom preset defined with 'repotruck preset add')`,
      json,
      command,
    );
  })();
}

/** Parses a positive integer, rejecting trailing garbage like "3.5" or "10abc". */
export function parseIntStrict(
  value: string,
  label: string,
  json?: boolean,
  command?: string,
): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    exitFail(`invalid ${label}: ${value} (expected a positive integer)`, json, command);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed <= 0) {
    exitFail(`invalid ${label}: ${value} (expected a positive integer)`, json, command);
  }
  return parsed;
}

export function jsonEmit(): (p: CloneProgress) => void {
  return (p) => {
    process.stderr.write(`[${p.phase}] ${p.key}\n`);
  };
}

export function requireAuth() {
  return getAuthInfo(process.env);
}

/**
 * Shared GitHubService factory: enables the etag conditional-request cache
 * (github-cache.json in the app config dir) unless REPOTRUCK_NO_API_CACHE is
 * set. Unchanged repositories then answer 304 with no payload, which mostly
 * benefits prune's per-repository checks across runs.
 */
export function buildGithub(token: string, baseUrl?: string): GitHubService {
  return new GitHubService(token, {
    baseUrl,
    ...(process.env.REPOTRUCK_NO_API_CACHE
      ? {}
      : { etagCache: fileEtagCache(path.join(appConfigDir(process.env), "github-cache.json")) }),
  });
}

export function progressEmit(): EmitProgress {
  return (progress) => {
    if (progress.phase === "cloning") {
      process.stdout.write(`[cloning] ${progress.key}\n`);
    } else if (progress.phase === "pulling") {
      process.stdout.write(`[pulling] ${progress.key}\n`);
    } else if (progress.phase === "done") {
      process.stdout.write(`✓ ${progress.key} — ${progress.message ?? "done"}\n`);
    } else {
      process.stdout.write(`✗ ${progress.key} — ${progress.message ?? "failed"}\n`);
    }
  };
}

export function createCliContext() {
  return {
    exitFail,
    runAction,
    resolveRootOption,
    requireExistingRoot,
    requirePreset,
    parseIntStrict,
    jsonEmit,
    requireAuth,
    buildGithub,
    progressEmit,
  };
}

export type CliContext = ReturnType<typeof createCliContext>;

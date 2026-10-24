import { mkdir, readFile } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";
import path from "node:path";
import { type CustomPreset, validateCustomPreset } from "../presets/index.ts";
import { type DivergenceStrategy, isDivergenceStrategy } from "./cloner.ts";
import { appConfigDir, type EnvLike } from "./config.ts";
import { warnQuiet } from "./diagnostics.ts";
import { writeFileAtomic } from "./fsUtils.ts";
import { resolveWorkspaceRoot } from "./workspaceRegistry.ts";

export const SETTINGS_FILENAME = "settings.json";

export type SyncDivergence = DivergenceStrategy;

export interface SyncSettings {
  concurrency?: number;
  depth?: number;
  blobless?: boolean;
  stash?: boolean;
  divergence?: SyncDivergence;
}

export interface GithubSettings {
  baseUrl?: string;
}

export interface PresetSettings {
  segments?: unknown;
}

export interface RepotruckSettings {
  defaultRoot?: string;
  sync?: SyncSettings;
  github?: GithubSettings;
  /** Dashboard palette: "default" | "light" | "contrast" (env REPOTRUCK_THEME wins). */
  theme?: string;
  /** User-defined presets: `{ "my-layout": { "segments": ["language", "owner", "name"] } }`. */
  presets?: Record<string, PresetSettings>;
}

/** Parses and validates the `presets` section of settings.json. */
export function loadCustomPresets(settings: RepotruckSettings): CustomPreset[] {
  const raw = settings.presets ?? {};
  const presets: CustomPreset[] = [];
  for (const [id, value] of Object.entries(raw)) {
    const candidate = value !== null && typeof value === "object" ? { id, ...value } : null;
    const validated = candidate === null ? null : validateCustomPreset(candidate);
    if (validated === null) {
      warnQuiet(`settings: ignoring invalid custom preset "${id}"`, value, process.env);
      continue;
    }
    presets.push(validated);
  }
  return presets;
}

/** Loads the validated custom presets from settings.json for the given env. */
export async function readCustomPresets(env: EnvLike = process.env): Promise<CustomPreset[]> {
  return loadCustomPresets(await readSettings(env));
}

export const DEFAULT_GITHUB_BASE_URL = "https://api.github.com";

/**
 * Validates and normalizes a GitHub Enterprise base URL.
 * - must use https
 * - github.com / api.github.com returns the default api.github.com
 * - a bare host (`https://ghe.example.com`) becomes `https://ghe.example.com/api/v3`
 * - a full API root ending in `/api/v3` (trailing slash tolerated) is kept as-is
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("https://")) {
    throw new Error(
      `invalid github.baseUrl: ${input} (expected an https URL, e.g. https://ghe.example.com)`,
    );
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`invalid github.baseUrl: ${input} (not a valid URL)`);
  }
  if (url.hostname === "github.com" || url.hostname === "api.github.com") {
    return DEFAULT_GITHUB_BASE_URL;
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/api/v3") {
    return `${url.origin}/api/v3`;
  }
  if (path.endsWith("/api/v3")) {
    return `${url.origin}${path}`;
  }
  throw new Error(
    `invalid github.baseUrl: ${input} (expected a bare host or a URL ending in /api/v3)`,
  );
}

export async function resolveGithubBaseUrl(
  env: EnvLike = process.env,
  flagOverride?: string,
): Promise<string> {
  const raw = flagOverride ?? (await readSettings(env)).github?.baseUrl;
  if (raw === undefined) return DEFAULT_GITHUB_BASE_URL;
  return normalizeBaseUrl(raw);
}

export interface ResolvedSyncSettings {
  concurrency: number;
  depth?: number;
  blobless: boolean;
  stash: boolean;
  divergence: SyncDivergence;
}

export interface SyncCliOverrides {
  concurrency?: number;
  depth?: number;
  blobless?: boolean;
  stash?: boolean;
  divergence?: SyncDivergence;
}

export function resolveSyncSettings(
  settings: RepotruckSettings,
  overrides: SyncCliOverrides = {},
): ResolvedSyncSettings {
  const sync = settings.sync ?? {};
  if (
    sync.concurrency !== undefined &&
    (!Number.isInteger(sync.concurrency) || sync.concurrency <= 0)
  ) {
    throw new Error(
      `invalid settings: sync.concurrency must be a positive integer (got ${sync.concurrency})`,
    );
  }
  if (sync.depth !== undefined && (!Number.isInteger(sync.depth) || sync.depth <= 0)) {
    throw new Error(`invalid settings: sync.depth must be a positive integer (got ${sync.depth})`);
  }
  if (sync.divergence !== undefined && !isDivergenceStrategy(sync.divergence)) {
    throw new Error(
      `invalid settings: sync.divergence must be one of fail, rebase, reset, skip (got ${sync.divergence})`,
    );
  }
  return {
    concurrency: overrides.concurrency ?? sync.concurrency ?? 3,
    depth: overrides.depth ?? sync.depth,
    blobless: overrides.blobless ?? sync.blobless ?? false,
    stash: overrides.stash ?? sync.stash ?? false,
    divergence: overrides.divergence ?? sync.divergence ?? "fail",
  };
}

function settingsPath(env: EnvLike): string {
  return path.join(appConfigDir(env), SETTINGS_FILENAME);
}

function sanitizeSettings(value: unknown, env: EnvLike): RepotruckSettings {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const next: RepotruckSettings = {};
  // Unknown keys are copied verbatim so a read-modify-write never drops
  // settings written by newer repotruck versions.
  for (const [key, entry] of Object.entries(raw)) {
    if (key !== "defaultRoot" && key !== "sync" && key !== "github") {
      (next as Record<string, unknown>)[key] = entry;
    }
  }
  if (typeof raw.defaultRoot === "string") next.defaultRoot = raw.defaultRoot;
  if (raw.theme !== undefined) {
    if (typeof raw.theme === "string" && raw.theme.length > 0) {
      next.theme = raw.theme;
    } else {
      warnQuiet("settings: ignoring invalid theme", raw.theme, env);
    }
  }
  if (raw.sync !== null && typeof raw.sync === "object" && !Array.isArray(raw.sync)) {
    const syncRaw = raw.sync as Record<string, unknown>;
    const sync: SyncSettings = {};
    if (syncRaw.concurrency !== undefined) {
      if (Number.isInteger(syncRaw.concurrency) && (syncRaw.concurrency as number) > 0) {
        sync.concurrency = syncRaw.concurrency as number;
      } else {
        warnQuiet("settings: ignoring invalid sync.concurrency", syncRaw.concurrency, env);
      }
    }
    if (syncRaw.depth !== undefined) {
      if (Number.isInteger(syncRaw.depth) && (syncRaw.depth as number) > 0) {
        sync.depth = syncRaw.depth as number;
      } else {
        warnQuiet("settings: ignoring invalid sync.depth", syncRaw.depth, env);
      }
    }
    if (typeof syncRaw.blobless === "boolean") sync.blobless = syncRaw.blobless;
    if (typeof syncRaw.stash === "boolean") sync.stash = syncRaw.stash;
    if (syncRaw.divergence !== undefined) {
      if (typeof syncRaw.divergence === "string" && isDivergenceStrategy(syncRaw.divergence)) {
        sync.divergence = syncRaw.divergence;
      } else {
        warnQuiet("settings: ignoring invalid sync.divergence", syncRaw.divergence, env);
      }
    }
    next.sync = sync;
  }
  if (raw.github !== null && typeof raw.github === "object" && !Array.isArray(raw.github)) {
    const githubRaw = raw.github as Record<string, unknown>;
    const github: GithubSettings = {};
    if (typeof githubRaw.baseUrl === "string") github.baseUrl = githubRaw.baseUrl;
    next.github = github;
  }
  return next;
}

export async function readSettings(env: EnvLike = process.env): Promise<RepotruckSettings> {
  try {
    const raw = (await readFile(settingsPath(env), "utf8")).replace(/^\uFEFF/, "");
    const parsed: unknown = JSON.parse(raw);
    return sanitizeSettings(parsed, env);
  } catch (error) {
    warnQuiet("settings: read failed, using defaults", error, env);
    return {};
  }
}

export async function writeSettings(
  env: EnvLike = process.env,
  settings: RepotruckSettings,
): Promise<void> {
  const file = settingsPath(env);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
}

export function homeDirFrom(
  env: EnvLike,
  platform: string = process.platform,
  homedirImpl: () => string = osHomedir,
): string {
  const envHome = platform === "win32" ? env.USERPROFILE : env.HOME;
  if (envHome !== undefined && envHome.length > 0) return envHome;
  try {
    const fallback = homedirImpl();
    if (fallback.length > 0) return fallback;
  } catch {
    /* fall through to the explicit error */
  }
  throw new Error("could not determine home directory: set HOME or USERPROFILE");
}

export function osDefaultRoot(
  env: EnvLike = process.env,
  platform: string = process.platform,
  homedirImpl: () => string = osHomedir,
): string {
  return path.join(homeDirFrom(env, platform, homedirImpl), "repotruck");
}

export type RootValidation = { ok: true; root: string } | { ok: false; error: string };

export function validateRootInput(
  input: string,
  env: EnvLike = process.env,
  platform: string = process.platform,
  homedirImpl: () => string = osHomedir,
): RootValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: "invalid root: path is required (example: ~/repotruck)",
    };
  }
  const p = platform === "win32" ? path.win32 : path.posix;
  let candidate = trimmed;
  if (candidate === "~" || candidate.startsWith("~/") || candidate.startsWith("~\\")) {
    candidate = p.join(homeDirFrom(env, platform, homedirImpl), candidate.slice(1));
  }
  if (!p.isAbsolute(candidate)) {
    return {
      ok: false,
      error: `invalid root: path must be absolute (got ${trimmed}); use an absolute path or ~`,
    };
  }
  return { ok: true, root: p.resolve(candidate) };
}

export interface EffectiveRoot {
  root: string;
  fromOverride: boolean;
}

export async function effectiveRoot(
  env: EnvLike = process.env,
  platform: string = process.platform,
): Promise<EffectiveRoot> {
  const settings = await readSettings(env);
  const override = settings.defaultRoot;
  if (typeof override === "string") {
    const validated = validateRootInput(override, env, platform);
    if (validated.ok) return { root: validated.root, fromOverride: true };
  }
  return { root: osDefaultRoot(env, platform), fromOverride: false };
}

export async function resolveRootForSession(
  env: EnvLike = process.env,
  cwd: string = process.cwd(),
  platform: string = process.platform,
): Promise<string> {
  const walked = await resolveWorkspaceRoot(cwd, env);
  if (walked.found) return walked.root;
  return (await effectiveRoot(env, platform)).root;
}

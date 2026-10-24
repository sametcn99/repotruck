import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { firstErrorLine } from "./cloner.ts";
import type { RepoInventoryEntry, RepotruckConfig } from "./config.ts";
import { appConfigDir, type EnvLike } from "./config.ts";
import { quoteForShell } from "./shellQuote.ts";

export const APPS_FILENAME = "apps.json";

export interface AppEntry {
  name: string;
  command: string;
  args?: string[];
}

export const BUILTIN_APPS: readonly AppEntry[] = [
  { name: "claude", command: "claude" },
  { name: "codex", command: "codex" },
  { name: "gemini", command: "gemini" },
  { name: "aider", command: "aider" },
  { name: "vscode", command: "code" },
  { name: "cursor", command: "cursor" },
];

export function appsFilePath(env?: EnvLike): string {
  return path.join(appConfigDir(env ?? process.env), APPS_FILENAME);
}

function isAppEntry(value: unknown): value is AppEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Partial<AppEntry>;
  return (
    typeof entry.name === "string" &&
    entry.name.length > 0 &&
    typeof entry.command === "string" &&
    entry.command.length > 0 &&
    (entry.args === undefined ||
      (Array.isArray(entry.args) && entry.args.every((item) => typeof item === "string")))
  );
}

export async function loadCustomApps(env?: EnvLike): Promise<AppEntry[]> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = (await readFile(appsFilePath(env), "utf8")).replace(/^\uFEFF/, "");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAppEntry);
  } catch {
    return [];
  }
}

export type WhichImpl = (command: string) => Promise<string | null>;

export async function defaultWhich(command: string): Promise<string | null> {
  const pathEnv = process.env.PATH ?? "";
  const directories = pathEnv.split(path.delimiter).filter((dir) => dir.length > 0);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((ext) => ext.toLowerCase())
      : [""];
  for (const dir of directories) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export interface DetectAppsOptions {
  whichImpl?: WhichImpl;
  customApps?: AppEntry[];
  env?: EnvLike;
}

export async function detectApps(options: DetectAppsOptions = {}): Promise<AppEntry[]> {
  const which = options.whichImpl ?? defaultWhich;
  const custom = options.customApps ?? (await loadCustomApps(options.env));
  const results: AppEntry[] = [];
  const overridden = new Set<string>();
  for (const builtin of BUILTIN_APPS) {
    const override = custom.find((item) => item.name.toLowerCase() === builtin.name.toLowerCase());
    if (override !== undefined) {
      overridden.add(override.name.toLowerCase());
      results.push(override);
      continue;
    }
    if ((await which(builtin.command)) !== null) {
      results.push(builtin);
    }
  }
  for (const item of custom) {
    if (!overridden.has(item.name.toLowerCase())) {
      results.push(item);
    }
  }
  return results;
}

export interface ResolvedApp {
  name: string;
  command: string;
  args: string[];
}

export interface ResolveAppOptions {
  customApps?: AppEntry[];
  whichImpl?: WhichImpl;
  env?: EnvLike;
}

export async function resolveApp(
  name: string,
  options: ResolveAppOptions = {},
): Promise<ResolvedApp | null> {
  const custom = options.customApps ?? (await loadCustomApps(options.env));
  const which = options.whichImpl ?? defaultWhich;
  const target = name.toLowerCase();

  const customEntry = custom.find((item) => item.name.toLowerCase() === target);
  if (customEntry !== undefined) {
    return { name: customEntry.name, command: customEntry.command, args: customEntry.args ?? [] };
  }

  const builtin = BUILTIN_APPS.find((item) => item.name.toLowerCase() === target);
  if (builtin !== undefined) {
    if ((await which(builtin.command)) !== null) {
      return { name: builtin.name, command: builtin.command, args: builtin.args ?? [] };
    }
    return null;
  }

  if ((await which(name)) !== null) {
    return { name, command: name, args: [] };
  }
  return null;
}

export interface RepoRefMatch {
  entry: RepoInventoryEntry;
  dir: string;
}

export function resolveRepoRef(config: RepotruckConfig, ref: string): RepoRefMatch | null {
  const aliases = config.aliases ?? {};
  for (const [alias, target] of Object.entries(aliases)) {
    if (alias.toLowerCase() === ref.toLowerCase()) {
      const entry = config.repos.find(
        (item) => item.relativePath.toLowerCase() === target.toLowerCase(),
      );
      if (entry !== undefined) return { entry, dir: entry.relativePath };
    }
  }
  const byPath = config.repos.find((item) => item.relativePath.toLowerCase() === ref.toLowerCase());
  if (byPath !== undefined) return { entry: byPath, dir: byPath.relativePath };
  const [owner, name, ...rest] = ref.split("/");
  if (
    owner !== undefined &&
    owner.length > 0 &&
    name !== undefined &&
    name.length > 0 &&
    rest.length === 0
  ) {
    const byKey = config.repos.find(
      (item) =>
        item.owner.toLowerCase() === owner.toLowerCase() &&
        item.name.toLowerCase() === name.toLowerCase(),
    );
    if (byKey !== undefined) return { entry: byKey, dir: byKey.relativePath };
  }
  return null;
}

const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface AliasOpResult {
  ok: boolean;
  message: string;
  config: RepotruckConfig;
}

export function setAlias(config: RepotruckConfig, alias: string, ref: string): AliasOpResult {
  if (!ALIAS_PATTERN.test(alias)) {
    return {
      ok: false,
      message: `invalid alias: ${alias} (use letters, digits, dots, dashes, underscores; must start with a letter or digit)`,
      config,
    };
  }
  const match = resolveRepoRef(config, ref);
  if (match === null) {
    return { ok: false, message: `repository not found: ${ref}`, config };
  }
  const existing = config.aliases ?? {};
  const target = match.entry.relativePath;
  for (const [currentAlias, currentTarget] of Object.entries(existing)) {
    if (
      currentAlias.toLowerCase() === alias.toLowerCase() &&
      currentTarget.toLowerCase() !== target.toLowerCase()
    ) {
      return {
        ok: false,
        message: `alias "${alias}" is already used for ${currentTarget} — remove it first with: repotruck alias remove ${currentAlias}`,
        config,
      };
    }
  }
  const next: Record<string, string> = {};
  for (const [currentAlias, currentTarget] of Object.entries(existing)) {
    if (currentAlias.toLowerCase() === alias.toLowerCase()) continue;
    next[currentAlias] = currentTarget;
  }
  next[alias] = target;
  return {
    ok: true,
    message: `alias ${alias} -> ${target}`,
    config: { ...config, aliases: next },
  };
}

export function removeAlias(config: RepotruckConfig, alias: string): AliasOpResult {
  const existing = config.aliases ?? {};
  const found = Object.keys(existing).find((item) => item.toLowerCase() === alias.toLowerCase());
  if (found === undefined) {
    return { ok: false, message: `alias not found: ${alias}`, config };
  }
  const removed = existing[found]!;
  const next: Record<string, string> = {};
  for (const [currentAlias, currentTarget] of Object.entries(existing)) {
    if (currentAlias === found) continue;
    next[currentAlias] = currentTarget;
  }
  return {
    ok: true,
    message: `alias ${found} (${removed}) removed`,
    config: { ...config, aliases: next },
  };
}

export interface AliasListing {
  alias: string;
  target: string;
}

export function listAliases(config: RepotruckConfig): AliasListing[] {
  return Object.entries(config.aliases ?? {})
    .map(([alias, target]) => ({ alias, target }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

export type OpenMode = "foreground" | "attached-resume";

export interface RunAppInRepoInput {
  root: string;
  config: RepotruckConfig;
  ref: string;
  app: ResolvedApp;
  mode: OpenMode;
  onBeforeResume?: () => void;
}

export interface SpawnRequest {
  command: string;
  args: string[];
  cwd: string;
}

export type SpawnImpl = (request: SpawnRequest) => Promise<number>;

export function defaultSpawnImpl(request: SpawnRequest): Promise<number> {
  const attempt = (useShell: boolean): Promise<number> =>
    new Promise((resolve, reject) => {
      const command = useShell ? quoteForShell(request.command, request.args) : request.command;
      const args = useShell ? [] : request.args;
      const child = spawn(command, args, {
        cwd: request.cwd,
        stdio: "inherit",
        shell: useShell,
        windowsHide: false,
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
  return attempt(false).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return attempt(true);
    }
    throw error;
  });
}

export interface RunAppInRepoResult {
  ok: boolean;
  code: number | null;
  dir?: string;
  message?: string;
}

export async function runAppInRepo(
  input: RunAppInRepoInput,
  options: { spawnImpl?: SpawnImpl } = {},
): Promise<RunAppInRepoResult> {
  const spawnImpl = options.spawnImpl ?? defaultSpawnImpl;
  const match = resolveRepoRef(input.config, input.ref);
  if (match === null) {
    return { ok: false, code: 1, message: `repository not found: ${input.ref}` };
  }
  const repoDir = path.join(input.root, ...match.dir.split("/"));
  if (!existsSync(repoDir)) {
    return { ok: false, code: 1, dir: match.dir, message: `${match.dir} is not on disk` };
  }
  try {
    const code = await spawnImpl({
      command: input.app.command,
      args: input.app.args ?? [],
      cwd: repoDir,
    });
    if (input.mode === "attached-resume") {
      input.onBeforeResume?.();
    }
    return { ok: code === 0, code, dir: match.dir };
  } catch (error) {
    if (input.mode === "attached-resume") {
      input.onBeforeResume?.();
    }
    return { ok: false, code: 1, dir: match.dir, message: firstErrorLine(error) };
  }
}

import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isPresetRef, type PresetRef, type RepoCategory } from "../presets/index.ts";
import {
  type AgentsMdRepo,
  type AgentsMdTemplateBlock,
  type AgentsMdWorktree,
  extractCustomInstructions,
  extractTemplateBlock,
  generateAgentsMd,
} from "./agentsMd.ts";
import { writeFileAtomic } from "./fsUtils.ts";
import { GIST_ID_PATTERN } from "./gistApi.ts";

export const CONFIG_FILENAME = "repotruck.json";
export const AGENTS_MD_FILENAME = "AGENTS.md";

export interface RepoInventoryEntry {
  owner: string;
  name: string;
  relativePath: string;
  category: RepoCategory;
  internal: boolean;
  language: string | null;
  updatedAt: string | null;
  description?: string | null;
  topics?: string[];
  forkSourceOwner?: string;
  custom?: boolean;
  sparse?: string[];
}

export interface GistInventoryEntry {
  id: string;
}

export interface RepotruckConfig {
  version: 1;
  root: string;
  preset: PresetRef;
  lastSync: string | null;
  repos: RepoInventoryEntry[];
  gists?: GistInventoryEntry[];
  aliases?: Record<string, string>;
  pinned?: string[];
  profiles?: Record<string, string[]>;
}

export type EnvLike = Record<string, string | undefined>;

export function appConfigDir(
  env: EnvLike,
  platform: typeof process.platform = process.platform,
): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const override = env.REPOTRUCK_CONFIG_DIR;
  if (override) {
    if (!isAbsoluteUserPath(override, platform)) {
      throw new Error("REPOTRUCK_CONFIG_DIR must be an absolute path");
    }
    return paths.normalize(override);
  }

  if (platform === "win32") {
    const appData = env.LOCALAPPDATA;
    if (appData && isAbsoluteUserPath(appData, platform)) return paths.join(appData, "repotruck");
    return paths.join(appUserHome(env, platform), "AppData", "Local", "repotruck");
  }

  const home = appUserHome(env, platform);
  return platform === "darwin"
    ? paths.join(home, "Library", "Application Support", "repotruck")
    : paths.join(home, ".repotruck");
}

export function isAbsoluteUserPath(value: string, platform: string): boolean {
  return platform === "win32"
    ? path.win32.isAbsolute(value) && path.win32.parse(value).root.length > 1
    : path.posix.isAbsolute(value);
}

export function appUserHome(env: EnvLike, platform = process.platform): string {
  const candidates =
    platform === "win32" ? [env.USERPROFILE, env.HOME] : [env.HOME, env.USERPROFILE];
  for (const candidate of candidates) {
    if (candidate && isAbsoluteUserPath(candidate, platform)) return candidate;
  }
  const fallback = homedir();
  if (isAbsoluteUserPath(fallback, platform)) return fallback;
  throw new Error("could not determine an absolute user home directory");
}

export function isRepoInventoryEntry(value: unknown): value is RepoInventoryEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Partial<RepoInventoryEntry>;
  const sparseValid = entry.sparse === undefined || isStringArray(entry.sparse);
  return (
    typeof entry.owner === "string" &&
    typeof entry.name === "string" &&
    typeof entry.relativePath === "string" &&
    (entry.category === "archived" || entry.category === "forks" || entry.category === "source") &&
    typeof entry.internal === "boolean" &&
    (entry.language === null || typeof entry.language === "string") &&
    (entry.updatedAt === null || typeof entry.updatedAt === "string") &&
    (entry.description === undefined ||
      entry.description === null ||
      typeof entry.description === "string") &&
    (entry.topics === undefined || isStringArray(entry.topics)) &&
    (entry.forkSourceOwner === undefined || typeof entry.forkSourceOwner === "string") &&
    sparseValid
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isRepotruckConfig(value: unknown): value is RepotruckConfig {
  if (value === null || typeof value !== "object") return false;
  const config = value as Partial<RepotruckConfig>;
  const aliasesValid =
    config.aliases === undefined ||
    (typeof config.aliases === "object" &&
      config.aliases !== null &&
      !Array.isArray(config.aliases) &&
      Object.entries(config.aliases).every(
        ([key, target]) => typeof key === "string" && typeof target === "string",
      ));
  const pinnedValid = config.pinned === undefined || isStringArray(config.pinned);
  const profilesValid =
    config.profiles === undefined ||
    (typeof config.profiles === "object" &&
      config.profiles !== null &&
      !Array.isArray(config.profiles) &&
      Object.entries(config.profiles).every(
        ([key, targets]) => typeof key === "string" && isStringArray(targets),
      ));
  return (
    config.version === 1 &&
    typeof config.root === "string" &&
    isPresetRef(config.preset) &&
    (config.lastSync === null || typeof config.lastSync === "string") &&
    Array.isArray(config.repos) &&
    config.repos.every(isRepoInventoryEntry) &&
    (config.gists === undefined ||
      (Array.isArray(config.gists) &&
        config.gists.every(
          (item) => typeof item?.id === "string" && GIST_ID_PATTERN.test(item.id),
        ))) &&
    aliasesValid &&
    pinnedValid &&
    profilesValid
  );
}

export function defaultConfig(root: string, preset: PresetRef = "categorized"): RepotruckConfig {
  return {
    version: 1,
    root,
    preset,
    lastSync: null,
    repos: [],
  };
}

export async function readAgentsMd(root: string): Promise<string | null> {
  try {
    return await readFile(path.join(root, AGENTS_MD_FILENAME), "utf8");
  } catch {
    return null;
  }
}

export interface WriteAgentsMdExtra {
  pinned?: readonly string[];
  worktrees?: readonly AgentsMdWorktree[];
}

export async function writeAgentsMd(
  root: string,
  repos: readonly AgentsMdRepo[],
  preset: PresetRef,
  lastSync: string | null,
  aliases?: Record<string, string>,
  template?: AgentsMdTemplateBlock | null,
  extra?: WriteAgentsMdExtra,
): Promise<string> {
  const existing = await readAgentsMd(root);
  const customInstructions = existing !== null ? extractCustomInstructions(existing) : null;
  const templateBlock =
    template === undefined ? (existing !== null ? extractTemplateBlock(existing) : null) : template;
  const content = generateAgentsMd({
    preset,
    lastSync,
    repos,
    customInstructions,
    aliases,
    template: templateBlock,
    pinned: extra?.pinned,
    worktrees: extra?.worktrees,
  });
  if (existing === content) {
    return content;
  }
  await mkdir(root, { recursive: true });
  await writeFileAtomic(path.join(root, AGENTS_MD_FILENAME), content);
  return content;
}

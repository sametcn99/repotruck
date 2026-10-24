import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isPresetRef, type PresetRef, type RepoCategory } from "../presets/index.ts";
import {
  type AgentsMdRepo,
  type AgentsMdTemplateBlock,
  extractCustomInstructions,
  extractTemplateBlock,
  generateAgentsMd,
} from "./agentsMd.ts";
import { writeFileAtomic } from "./fsUtils.ts";

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
  custom?: boolean;
}

export interface RepotruckConfig {
  version: 1;
  root: string;
  preset: PresetRef;
  lastSync: string | null;
  repos: RepoInventoryEntry[];
  aliases?: Record<string, string>;
}

export type EnvLike = Record<string, string | undefined>;

export function appConfigDir(
  env: EnvLike,
  platform: typeof process.platform = process.platform,
): string {
  const override = env.REPOTRUCK_CONFIG_DIR;
  if (override !== undefined && override.length > 0) return override;

  if (platform === "win32") {
    const appData = env.APPDATA;
    if (appData !== undefined && appData.length > 0) return path.join(appData, "repotruck");
    const userProfile = env.USERPROFILE;
    if (userProfile !== undefined && userProfile.length > 0) {
      return path.join(userProfile, "AppData", "Roaming", "repotruck");
    }
  }

  if (platform === "darwin") {
    const home = env.HOME ?? env.USERPROFILE;
    if (home !== undefined && home.length > 0) {
      return path.join(home, "Library", "Application Support", "repotruck");
    }
  }

  const home = env.HOME ?? env.USERPROFILE;
  const base =
    env.XDG_CONFIG_HOME ??
    (home !== undefined && home.length > 0 ? path.join(home, ".config") : undefined);
  if (base !== undefined && base.length > 0) return path.join(base, "repotruck");

  return path.join("repotruck");
}

export function isRepoInventoryEntry(value: unknown): value is RepoInventoryEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Partial<RepoInventoryEntry>;
  return (
    typeof entry.owner === "string" &&
    typeof entry.name === "string" &&
    typeof entry.relativePath === "string" &&
    (entry.category === "archived" || entry.category === "forks" || entry.category === "source") &&
    typeof entry.internal === "boolean" &&
    (entry.language === null || typeof entry.language === "string") &&
    (entry.updatedAt === null || typeof entry.updatedAt === "string")
  );
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
  return (
    config.version === 1 &&
    typeof config.root === "string" &&
    isPresetRef(config.preset) &&
    (config.lastSync === null || typeof config.lastSync === "string") &&
    Array.isArray(config.repos) &&
    config.repos.every(isRepoInventoryEntry) &&
    aliasesValid
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

export async function writeAgentsMd(
  root: string,
  repos: readonly AgentsMdRepo[],
  preset: PresetRef,
  lastSync: string | null,
  aliases?: Record<string, string>,
  template?: AgentsMdTemplateBlock | null,
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
  });
  if (existing === content) {
    return content;
  }
  await mkdir(root, { recursive: true });
  await writeFileAtomic(path.join(root, AGENTS_MD_FILENAME), content);
  return content;
}

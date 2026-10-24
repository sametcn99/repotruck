import path from "node:path";
import {
  type CategoryInput,
  type CustomPreset,
  isInternalOwner,
  type PresetRef,
  repoCategory,
  targetSegmentsForPreset,
} from "../presets/index.ts";
import {
  cloneOrUpdate,
  createCloneLimiter,
  DEFAULT_CONCURRENCY,
  type DivergenceStrategy,
  detectSshAvailability,
  type EmitProgress,
} from "./cloner.ts";
import type { EnvLike, RepoInventoryEntry, RepotruckConfig } from "./config.ts";
import { defaultConfig, writeAgentsMd } from "./config.ts";
import { repoKeyEquals } from "./fsUtils.ts";
import type { RepoInfo } from "./github.ts";
import type { ProgressHub } from "./progressHub.ts";
import { withWorkspaceLock } from "./workspaceLock.ts";
import {
  deleteLegacyWorkspaceConfig,
  readLegacyWorkspaceConfig,
  readWorkspaceConfig,
  writeWorkspaceConfig,
} from "./workspaceRegistry.ts";

export interface InventoryRepoInput extends CategoryInput {
  owner: string;
  name: string;
  language: string | null;
  updatedAt?: string | null;
}

export function targetDirFor(
  root: string,
  repo: Parameters<typeof targetSegmentsForPreset>[0],
  preset: PresetRef,
  internal: boolean,
  customPresets: readonly CustomPreset[] = [],
): string {
  return path.join(root, ...targetSegmentsForPreset(repo, preset, internal, customPresets));
}

export function toPosixRelative(root: string, absDir: string): string {
  return path.relative(root, absDir).split(path.sep).join("/");
}

export function upsertInventory(
  config: RepotruckConfig,
  repo: InventoryRepoInput,
  relativePath: string,
  internal: boolean,
): RepotruckConfig {
  const index = config.repos.findIndex((entry) => repoKeyEquals(entry, repo.owner, repo.name));
  const previous = index >= 0 ? config.repos[index] : undefined;
  const base: RepoInventoryEntry = {
    owner: repo.owner,
    name: repo.name,
    relativePath,
    category: repoCategory(repo),
    internal,
    language: repo.language,
    updatedAt: repo.updatedAt ?? null,
  };
  const entry: RepoInventoryEntry =
    previous !== undefined && previous.custom !== undefined
      ? { ...base, custom: previous.custom }
      : base;
  const repos =
    index >= 0
      ? config.repos.map((item, i) => (i === index ? entry : item))
      : [...config.repos, entry];
  return { ...config, repos };
}

export async function saveWorkspace(
  root: string,
  config: RepotruckConfig,
  env?: EnvLike,
): Promise<void> {
  await withWorkspaceLock(
    async () => {
      const next: RepotruckConfig = { ...config, root };
      await writeWorkspaceConfig(root, next, env);
      await writeAgentsMd(root, next.repos, next.preset, next.lastSync, next.aliases);
    },
    { env },
  );
}

export async function loadWorkspace(
  root: string,
  presetOverride?: PresetRef,
  env?: EnvLike,
): Promise<RepotruckConfig> {
  const central = await readWorkspaceConfig(root, env);
  const legacy = await readLegacyWorkspaceConfig(root);
  if (legacy !== null && (central === null || central.repos.length === 0)) {
    const imported: RepotruckConfig = { ...legacy, root };
    await writeWorkspaceConfig(root, imported, env);
    await deleteLegacyWorkspaceConfig(root);
    return presetOverride === undefined ? imported : { ...imported, preset: presetOverride };
  }
  if (central !== null) {
    return presetOverride === undefined ? central : { ...central, preset: presetOverride };
  }
  return defaultConfig(root, presetOverride ?? "categorized");
}

export interface SyncReposOptions {
  root: string;
  config: RepotruckConfig;
  repos: readonly RepoInfo[];
  userLogin: string;
  orgs: readonly string[];
  token?: string | null;
  preferSsh?: boolean;
  concurrency?: number;
  depth?: number;
  blobless?: boolean;
  stash?: boolean;
  divergence?: DivergenceStrategy;
  env?: EnvLike;
  emit?: EmitProgress;
  hub?: ProgressHub;
  customPresets?: readonly CustomPreset[];
}

export interface SyncedEntry {
  key: string;
  relativePath: string;
  internal: boolean;
}

export interface SyncReposResult {
  done: SyncedEntry[];
  failed: Array<{ key: string; message: string }>;
  skipped: Array<{ key: string; message: string }>;
}

export async function syncRepos(options: SyncReposOptions): Promise<SyncReposResult> {
  const { root, config, repos, userLogin, orgs, token } = options;
  const preferSsh = options.preferSsh ?? (token ? await detectSshAvailability() : false);
  const limit = createCloneLimiter(options.concurrency ?? DEFAULT_CONCURRENCY);
  let current = config;
  const done: SyncedEntry[] = [];
  const failed: SyncReposResult["failed"] = [];
  const skipped: SyncReposResult["skipped"] = [];

  await Promise.all(
    repos.map((repo, index) =>
      limit(async () => {
        const internal = isInternalOwner(repo.owner, userLogin, orgs);
        const destDir = targetDirFor(
          root,
          repo,
          current.preset,
          internal,
          options.customPresets ?? [],
        );
        const hub = options.hub;
        const emit = options.emit
          ? (progress: Parameters<EmitProgress>[0]): void => {
              options.emit?.(progress);
              if (hub !== undefined) {
                hub.publish({ ...progress, index: index + 1, total: repos.length });
              }
            }
          : hub !== undefined
            ? (progress: Parameters<EmitProgress>[0]): void => {
                hub.publish({ ...progress, index: index + 1, total: repos.length });
              }
            : undefined;
        const final = await cloneOrUpdate(
          {
            owner: repo.owner,
            name: repo.name,
            httpsUrl: repo.httpsUrl,
            sshUrl: repo.sshUrl,
            destDir,
          },
          {
            token: token ?? null,
            preferSsh,
            depth: options.depth,
            blobless: options.blobless,
            stash: options.stash,
            divergence: options.divergence,
          },
          emit,
        );
        const key = `${repo.owner}/${repo.name}`;
        if (final.phase === "done") {
          const relativePath = toPosixRelative(root, destDir);
          current = upsertInventory(current, repo, relativePath, internal);
          done.push({ key, relativePath, internal });
        } else if (final.phase === "skipped") {
          skipped.push({ key, message: final.message ?? "divergence skip" });
        } else {
          failed.push({ key, message: final.message ?? "unknown failure" });
        }
      }),
    ),
  );

  current = { ...current, lastSync: new Date().toISOString() };
  await saveWorkspace(root, current, options.env);
  options.hub?.publish({
    kind: "sync-summary",
    done: done.length,
    failed: failed.length,
    skipped: skipped.length,
  });
  return { done, failed, skipped };
}

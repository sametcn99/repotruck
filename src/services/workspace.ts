import { mkdir } from "node:fs/promises";
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
  firstErrorLine,
} from "./cloner.ts";
import type { EnvLike, RepoInventoryEntry, RepotruckConfig } from "./config.ts";
import { defaultConfig, writeAgentsMd } from "./config.ts";
import { lookupRepoDetails, type RepoLookup } from "./forkSource.ts";
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
import { findLinkedWorktrees, inspectGitDotEntry } from "./worktree.ts";

export interface InventoryRepoInput extends CategoryInput {
  owner: string;
  name: string;
  language: string | null;
  updatedAt?: string | null;
  description?: string | null;
  topics?: readonly string[];
  forkSourceOwner?: string;
  sparse?: string[];
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

export function resolveRepoPlacement(
  config: RepotruckConfig,
  repo: RepoInfo,
  userLogin: string,
  orgs: readonly string[],
  customPresets: readonly CustomPreset[] = [],
): { relativePath: string; internal: boolean; tracked?: RepoInventoryEntry } {
  const tracked = config.repos.find((entry) => repoKeyEquals(entry, repo.owner, repo.name));
  if (tracked !== undefined) {
    return { relativePath: tracked.relativePath, internal: tracked.internal, tracked };
  }
  const internal = isInternalOwner(repo.owner, userLogin, orgs);
  const segments = targetSegmentsForPreset(repo, config.preset, internal, customPresets);
  if (config.preset === "categorized" && repoCategory(repo) === "forks" && repo.forkSourceOwner) {
    const group = segments.slice(0, -1);
    if (inspectGitDotEntry(path.join(config.root, ...group)).kind !== "none") {
      throw new Error(
        `fork group ${group.join("/")} is already a Git checkout; reorganize the workspace first`,
      );
    }
  }
  return {
    relativePath: segments.join("/"),
    internal,
  };
}

export async function resolveForkPlacementRepo(
  repo: RepoInfo,
  config: RepotruckConfig,
  getRepo?: RepoLookup,
): Promise<RepoInfo> {
  if (config.preset !== "categorized" || repoCategory(repo) !== "forks" || repo.forkSourceOwner) {
    return repo;
  }
  const tracked = config.repos.find((entry) => repoKeyEquals(entry, repo.owner, repo.name));
  const forkSourceOwner =
    tracked?.forkSourceOwner ?? (await lookupRepoDetails(repo, getRepo))?.forkSourceOwner;
  return forkSourceOwner === undefined ? repo : { ...repo, forkSourceOwner };
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
  const description = repo.description === undefined ? previous?.description : repo.description;
  const topics = repo.topics ?? previous?.topics;
  const forkSourceOwner = repo.forkSourceOwner ?? previous?.forkSourceOwner;
  const base: RepoInventoryEntry = {
    owner: repo.owner,
    name: repo.name,
    relativePath,
    category: repoCategory(repo),
    internal,
    language: repo.language,
    updatedAt: repo.updatedAt ?? null,
    ...(description !== undefined ? { description } : {}),
    ...(topics !== undefined ? { topics: [...topics] } : {}),
    ...(forkSourceOwner !== undefined ? { forkSourceOwner } : {}),
    ...(repo.sparse
      ? { sparse: repo.sparse }
      : previous?.sparse
        ? { sparse: previous.sparse }
        : {}),
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

/**
 * Atomically updates a workspace's configuration under a file lock.
 * Loads the current config, applies the `mutate` function, writes the updated config
 * and regenerated AGENTS.md, and returns the resulting config and any custom result.
 *
 * RULE: No network calls or git operations are permitted inside `mutate``.
 * Long-running work (like git clone or network fetch) MUST happen outside the lock,
 * with only the in-memory config transformations performed inside `mutate``.
 */
export async function updateWorkspace<T = void>(
  root: string,
  mutate: (
    current: RepotruckConfig,
  ) => { config: RepotruckConfig; result: T } | Promise<{ config: RepotruckConfig; result: T }>,
  env?: EnvLike,
): Promise<{ config: RepotruckConfig; result: T }> {
  return await withWorkspaceLock(
    async () => {
      const current = await readWorkspaceConfig(root, env);
      const baseConfig = current ?? defaultConfig(root);
      const { config: nextConfig, result } = await mutate(baseConfig);

      const resolved: RepotruckConfig = { ...nextConfig, root };
      await writeWorkspaceConfig(root, resolved, env);
      let worktrees: Awaited<ReturnType<typeof findLinkedWorktrees>> = [];
      try {
        worktrees = await findLinkedWorktrees(root, 4);
      } catch {
        worktrees = [];
      }
      await writeAgentsMd(
        root,
        resolved.repos,
        resolved.preset,
        resolved.lastSync,
        resolved.aliases,
        undefined,
        {
          pinned: resolved.pinned,
          worktrees,
        },
      );
      return { config: resolved, result };
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
    return await withWorkspaceLock(
      async () => {
        const currentCentral = await readWorkspaceConfig(root, env);
        if (currentCentral !== null && currentCentral.repos.length > 0) {
          return presetOverride === undefined
            ? currentCentral
            : { ...currentCentral, preset: presetOverride };
        }
        const imported: RepotruckConfig = { ...legacy, root };
        await writeWorkspaceConfig(root, imported, env);
        await deleteLegacyWorkspaceConfig(root);
        return presetOverride === undefined ? imported : { ...imported, preset: presetOverride };
      },
      { env },
    );
  }
  if (central !== null) {
    return presetOverride === undefined ? central : { ...central, preset: presetOverride };
  }
  return defaultConfig(root, presetOverride ?? "categorized");
}

export async function registerWorkspace(root: string, env?: EnvLike): Promise<RepotruckConfig> {
  await mkdir(root, { recursive: true });
  return await withWorkspaceLock(
    async () => {
      const existing = await readWorkspaceConfig(root, env);
      if (existing !== null) return existing;
      const config = await loadWorkspace(root, undefined, env);
      const registered = await updateWorkspace(root, () => ({ config, result: undefined }), env);
      return registered.config;
    },
    { env },
  );
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
  cloneOrUpdateImpl?: typeof cloneOrUpdate;
  getRepo?: RepoLookup;
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
  const done: SyncedEntry[] = [];
  const failed: SyncReposResult["failed"] = [];
  const skipped: SyncReposResult["skipped"] = [];
  const syncedRepos = new Map<string, RepoInfo>();

  await Promise.all(
    repos.map((candidate, index) =>
      limit(async () => {
        const repo = await resolveForkPlacementRepo(candidate, config, options.getRepo);
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
        const { owner, name } = repo;
        const key = `${owner}/${name}`;
        let placement: ReturnType<typeof resolveRepoPlacement>;
        try {
          placement = resolveRepoPlacement(config, repo, userLogin, orgs, options.customPresets);
        } catch (error) {
          const message = firstErrorLine(error);
          failed.push({ key, message });
          emit?.({ key, owner, name, phase: "failed", message });
          return;
        }
        const { relativePath, internal, tracked } = placement;
        const destDir = path.join(root, ...relativePath.split("/"));
        const cloneFn = options.cloneOrUpdateImpl ?? cloneOrUpdate;
        const final = await cloneFn(
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
            sparse: tracked?.sparse,
          },
          emit,
        );
        if (final.phase === "done") {
          syncedRepos.set(key, repo);
          done.push({ key, relativePath, internal });
        } else if (final.phase === "skipped") {
          skipped.push({ key, message: final.message ?? "divergence skip" });
        } else {
          failed.push({ key, message: final.message ?? "unknown failure" });
        }
      }),
    ),
  );

  await updateWorkspace(
    root,
    (freshConfig) => {
      let updated = freshConfig;
      for (const entry of done) {
        const repo = syncedRepos.get(entry.key);
        if (repo) {
          const invEntry = config.repos.find((e) => repoKeyEquals(e, repo.owner, repo.name));
          updated = upsertInventory(
            updated,
            { ...repo, sparse: invEntry?.sparse },
            entry.relativePath,
            entry.internal,
          );
        }
      }
      return { config: { ...updated, lastSync: new Date().toISOString() }, result: undefined };
    },
    options.env,
  );

  options.hub?.publish({
    kind: "sync-summary",
    done: done.length,
    failed: failed.length,
    skipped: skipped.length,
  });
  return { done, failed, skipped };
}

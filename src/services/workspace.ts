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
import { findLinkedWorktrees } from "./worktree.ts";

export interface InventoryRepoInput extends CategoryInput {
  owner: string;
  name: string;
  language: string | null;
  updatedAt?: string | null;
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
    ...(repo.sparse ? { sparse: repo.sparse } : {}),
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

  await Promise.all(
    repos.map((repo, index) =>
      limit(async () => {
        const internal = isInternalOwner(repo.owner, userLogin, orgs);
        const destDir = targetDirFor(
          root,
          repo,
          config.preset,
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
        const cloneFn = options.cloneOrUpdateImpl ?? cloneOrUpdate;
        const inv = config.repos.find((e) => repoKeyEquals(e, repo.owner, repo.name));
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
            sparse: inv?.sparse,
          },
          emit,
        );
        const key = `${repo.owner}/${repo.name}`;
        if (final.phase === "done") {
          const relativePath = toPosixRelative(root, destDir);
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
        const repo = repos.find((r) => `${r.owner}/${r.name}` === entry.key);
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

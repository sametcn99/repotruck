import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { simpleGit } from "simple-git";
import type { EnvLike, RepoInventoryEntry, RepotruckConfig } from "./config.ts";
import { repoKeyEquals } from "./fsUtils.ts";
import { moveDir } from "./mover.ts";
import { type ParsedGitUrl, parseGitUrl } from "./singleCloner.ts";
import { targetDirFor, toPosixRelative, updateWorkspace } from "./workspace.ts";

export interface DiscoveredRepo {
  owner: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  remoteUrl: string;
  internal: boolean;
}

export interface ScanResult {
  root: string;
  allDiscovered: DiscoveredRepo[];
  unregistered: DiscoveredRepo[];
  tracked: DiscoveredRepo[];
}

export interface AdoptPlan {
  repo: DiscoveredRepo;
  targetPath: string;
  targetRelativePath: string;
  needsMove: boolean;
}

export const MAX_SCAN_DEPTH = 6;

const IGNORED_DIRS = new Set([
  "node_modules",
  "vendor",
  "bower_components",
  "target",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".svn",
  ".hg",
  ".git",
  ".repotruck",
]);

export async function scanForRepos(
  root: string,
  maxDepth = MAX_SCAN_DEPTH,
): Promise<DiscoveredRepo[]> {
  const found: DiscoveredRepo[] = [];
  const resolvedRoot = path.resolve(root);

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let items: Dirent[];
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (!item.isDirectory()) continue;
      if (IGNORED_DIRS.has(item.name) || item.name.startsWith(".")) continue;
      const full = path.join(dir, item.name);
      if (existsSync(path.join(full, ".git"))) {
        const relativePath = toPosixRelative(resolvedRoot, full);
        let parsed: ParsedGitUrl | null = null;
        let remoteUrl = "";
        try {
          const remote = await simpleGit(full).raw(["remote", "get-url", "origin"]);
          remoteUrl = remote.trim();
          parsed = parseGitUrl(remoteUrl);
        } catch {
          parsed = null;
        }
        if (parsed !== null) {
          found.push({
            owner: parsed.owner,
            name: parsed.name,
            relativePath,
            absolutePath: full,
            remoteUrl,
            internal: !relativePath.toLowerCase().startsWith("community/"),
          });
        }
        continue;
      }
      await walk(full, depth + 1);
    }
  };

  await walk(resolvedRoot, 0);
  return found;
}

export async function scanWorkspaceRepos(
  root: string,
  config: RepotruckConfig,
): Promise<ScanResult> {
  const discovered = await scanForRepos(root);
  const tracked: DiscoveredRepo[] = [];
  const unregistered: DiscoveredRepo[] = [];

  for (const item of discovered) {
    const isTracked = config.repos.some((entry) => repoKeyEquals(entry, item.owner, item.name));
    if (isTracked) {
      tracked.push(item);
    } else {
      unregistered.push(item);
    }
  }

  return {
    root,
    allDiscovered: discovered,
    unregistered,
    tracked,
  };
}

export function buildAdoptPlan(
  root: string,
  config: RepotruckConfig,
  repos: DiscoveredRepo[],
): AdoptPlan[] {
  const plans: AdoptPlan[] = [];
  for (const repo of repos) {
    const targetDir = targetDirFor(
      root,
      {
        owner: repo.owner,
        name: repo.name,
        isArchived: false,
        isFork: false,
        language: null,
      },
      config.preset,
      repo.internal,
    );
    const targetRelative = toPosixRelative(root, targetDir);
    const needsMove = targetRelative.toLowerCase() !== repo.relativePath.toLowerCase();
    plans.push({
      repo,
      targetPath: targetDir,
      targetRelativePath: targetRelative,
      needsMove,
    });
  }
  return plans;
}

export interface AdoptOptions {
  dryRun?: boolean;
  moveImpl?: (src: string, dest: string) => void;
  env?: EnvLike;
}

export interface AdoptExecutionResult {
  adopted: Array<{ key: string; from: string; to: string }>;
  errors: Array<{ key: string; error: string }>;
}

export async function adoptUnregisteredRepos(
  root: string,
  _config: RepotruckConfig,
  plans: AdoptPlan[],
  options: AdoptOptions = {},
): Promise<AdoptExecutionResult> {
  const move = options.moveImpl ?? moveDir;
  const adopted: Array<{ key: string; from: string; to: string }> = [];
  const errors: Array<{ key: string; error: string }> = [];

  for (const plan of plans) {
    const key = `${plan.repo.owner}/${plan.repo.name}`;
    if (options.dryRun === true) {
      adopted.push({ key, from: plan.repo.relativePath, to: plan.targetRelativePath });
      continue;
    }

    try {
      if (plan.needsMove) {
        move(plan.repo.absolutePath, plan.targetPath);
      }
      await updateWorkspace(
        root,
        (current) => {
          const entryExists = current.repos.some((r) =>
            repoKeyEquals(r, plan.repo.owner, plan.repo.name),
          );
          if (entryExists) return { config: current, result: undefined };

          const newEntry: RepoInventoryEntry = {
            owner: plan.repo.owner,
            name: plan.repo.name,
            category: "source",
            language: null,
            relativePath: plan.targetRelativePath,
            internal: plan.repo.internal,
            custom: false,
            updatedAt: new Date().toISOString(),
          };

          return {
            config: {
              ...current,
              repos: [...current.repos, newEntry],
            },
            result: undefined,
          };
        },
        options.env,
      );
      adopted.push({ key, from: plan.repo.relativePath, to: plan.targetRelativePath });
    } catch (err) {
      errors.push({ key, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { adopted, errors };
}

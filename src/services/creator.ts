import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { type CustomPreset, targetSegmentsForPreset } from "../presets/index.ts";
import { firstErrorLine, gitWithTokenAuth } from "./cloner.ts";
import type { RepotruckConfig } from "./config.ts";
import { repoKeyEquals } from "./fsUtils.ts";
import type { GitHubRepoCreator, RepoInfo } from "./github.ts";
import { moveDir, validateMoveDestination } from "./mover.ts";
import { updateWorkspace, upsertInventory } from "./workspace.ts";

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export function validateCreateName(name: string): string | null {
  if (name.length === 0 || name.length > 100) return null;
  if (!NAME_PATTERN.test(name)) return null;
  if (name.startsWith(".") || name.startsWith("-")) return null;
  if (name.endsWith(".") || name.endsWith("-")) return null;
  return name;
}

export interface CreateOptions {
  name: string;
  org?: string;
  isPrivate: boolean;
  description?: string;
  customPath?: string;
  fromDir?: string;
}

export interface GitSeam {
  isGitRepo(dir: string): Promise<boolean>;
  statusPorcelain(dir: string): Promise<string>;
  initMain(dir: string): Promise<void>;
  addAll(dir: string): Promise<void>;
  commitInitial(dir: string, allowEmpty: boolean): Promise<void>;
  setRemoteOrigin(dir: string, url: string): Promise<void>;
  pushMain(dir: string, token: string | null, remoteUrl?: string): Promise<void>;
}

export const defaultGitSeam: GitSeam = {
  isGitRepo: async (dir) => {
    try {
      const out = await simpleGit(dir).raw(["rev-parse", "--is-inside-work-tree"]);
      return out.trim() === "true";
    } catch {
      return false;
    }
  },
  statusPorcelain: async (dir) => {
    return simpleGit(dir).raw(["status", "--porcelain"]);
  },
  initMain: async (dir) => {
    await simpleGit(dir).raw(["init", "-b", "main"]);
  },
  addAll: async (dir) => {
    await simpleGit(dir).raw(["add", "-A"]);
  },
  commitInitial: async (dir, allowEmpty) => {
    const args = allowEmpty
      ? ["commit", "--allow-empty", "-m", "Initial commit"]
      : ["commit", "-m", "Initial commit"];
    await simpleGit(dir).raw(args);
  },
  setRemoteOrigin: async (dir, url) => {
    const git = simpleGit(dir);
    try {
      await git.raw(["remote", "add", "origin", url]);
    } catch {
      await git.raw(["remote", "set-url", "origin", url]);
    }
  },
  pushMain: async (dir, token, remoteUrl) => {
    const git = gitWithTokenAuth(dir, remoteUrl ?? "https://github.com", token);
    await git.raw(["push", "-u", "origin", "main"]);
  },
};

export interface CreateRepositoryInput {
  root: string;
  config: RepotruckConfig;
  github: GitHubRepoCreator;
  token?: string | null;
  userLogin: string;
  orgs: readonly string[];
  options: CreateOptions;
  emit?: (message: string) => void;
  git?: GitSeam;
  customPresets?: readonly CustomPreset[];
}

export interface CreateResult {
  ok: boolean;
  message: string;
  destDir?: string;
  relativePath?: string;
}

function isInsideTrackedRepo(root: string, config: RepotruckConfig, sourceDir: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(sourceDir));
  if (relative === "" || relative.startsWith("..")) return false;
  const relPosix = relative.split(path.sep).join("/").toLowerCase();
  return config.repos.some((entry) => {
    const entryRel = entry.relativePath.toLowerCase();
    return relPosix === entryRel || relPosix.startsWith(`${entryRel}/`);
  });
}

export async function createRepository(input: CreateRepositoryInput): Promise<CreateResult> {
  const { root, config, github, token, userLogin, options } = input;
  const git = input.git ?? defaultGitSeam;
  const emit = input.emit ?? (() => {});

  const validName = validateCreateName(options.name);
  if (validName === null) {
    return { ok: false, message: `invalid repository name: ${options.name}` };
  }
  const owner = options.org ?? userLogin;

  let segments: string[];
  if (options.customPath !== undefined) {
    const validated = validateMoveDestination(options.customPath);
    if (validated === null) {
      return {
        ok: false,
        message: `invalid destination path: ${options.customPath}`,
      };
    }
    segments = validated;
  } else {
    segments = targetSegmentsForPreset(
      { owner, name: validName, isArchived: false, isFork: false, language: null },
      config.preset,
      true,
      input.customPresets ?? [],
    );
  }
  const destDir = path.join(root, ...segments);
  const destRel = segments.join("/");

  const trackedConflict = config.repos.some(
    (entry) => entry.relativePath.toLowerCase() === destRel.toLowerCase(),
  );
  if (trackedConflict) {
    return { ok: false, message: `destination is already tracked: ${destRel}` };
  }
  if (existsSync(destDir)) {
    return { ok: false, message: `destination already exists on disk: ${destRel}` };
  }

  if (options.fromDir !== undefined) {
    const sourceDir = path.resolve(options.fromDir);
    if (!existsSync(sourceDir)) {
      return {
        ok: false,
        message: `source directory does not exist: ${options.fromDir}`,
      };
    }
    if (isInsideTrackedRepo(root, config, sourceDir)) {
      return {
        ok: false,
        message: "source directory is already tracked by repotruck",
      };
    }
    if (await git.isGitRepo(sourceDir)) {
      const status = await git.statusPorcelain(sourceDir);
      if (status.trim().length > 0) {
        return {
          ok: false,
          message: "source has uncommitted changes — commit or stash first",
        };
      }
    }
  }

  emit(`creating GitHub repository ${owner}/${validName}`);
  let repo: RepoInfo;
  try {
    repo = await github.createRepo(validName, {
      org: options.org,
      private: options.isPrivate,
      description: options.description,
    });
  } catch (error) {
    return { ok: false, message: firstErrorLine(error, token ?? null) };
  }

  const workDir = options.fromDir !== undefined ? path.resolve(options.fromDir) : destDir;
  try {
    if (options.fromDir !== undefined) {
      if (!(await git.isGitRepo(workDir))) {
        await git.initMain(workDir);
        await git.addAll(workDir);
        await git.commitInitial(workDir, false);
      }
    } else {
      mkdirSync(destDir, { recursive: true });
      await git.initMain(destDir);
      await git.commitInitial(destDir, true);
    }
    await git.setRemoteOrigin(workDir, repo.httpsUrl);
    await git.pushMain(workDir, token ?? null, repo.httpsUrl);
  } catch (error) {
    return { ok: false, message: firstErrorLine(error, token ?? null) };
  }

  if (options.fromDir !== undefined) {
    try {
      moveDir(workDir, destDir);
    } catch (error) {
      return {
        ok: false,
        message: `${repo.owner}/${repo.name} was created on GitHub and pushed, but moving ${workDir} to ${destRel} failed (${firstErrorLine(error)}) — move it manually and run 'repotruck sync' to adopt it`,
      };
    }
  }

  await updateWorkspace(root, (current) => {
    let next = upsertInventory(
      current,
      {
        owner: repo.owner,
        name: repo.name,
        isArchived: false,
        isFork: false,
        language: repo.language,
        updatedAt: repo.updatedAt,
      },
      destRel,
      true,
    );
    if (options.customPath !== undefined) {
      next = {
        ...next,
        repos: next.repos.map((entry) =>
          repoKeyEquals(entry, repo.owner, repo.name) ? { ...entry, custom: true } : entry,
        ),
      };
    }
    return { config: { ...next, lastSync: new Date().toISOString() }, result: undefined };
  });

  emit(`created ${repo.owner}/${repo.name} at ${destRel}`);
  return {
    ok: true,
    message: `created ${repo.owner}/${repo.name} at ${destRel}`,
    destDir,
    relativePath: destRel,
  };
}

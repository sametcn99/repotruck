import { lstatSync } from "node:fs";
import path from "node:path";
import type { EnvLike, RepotruckConfig } from "./config.ts";
import { removeInventoryEntry } from "./lifecycle.ts";
import { identifyCheckout, scanLocalCheckouts } from "./scanner.ts";
import { resolveGithubBaseUrl } from "./settings.ts";
import { updateWorkspace, upsertInventory } from "./workspace.ts";
import { inspectGitDotEntry } from "./worktree.ts";

export type InventoryFix =
  | { action: "adopt"; owner: string; name: string; relativePath: string; internal: boolean }
  | { action: "relink"; key: string; from: string; to: string }
  | { action: "remove"; key: string; relativePath: string };

export interface InventoryIssue {
  detail: string;
  suggestion: string;
  fix?: InventoryFix;
}

function pathKey(relativePath: string): string {
  return process.platform === "win32" ? relativePath.toLowerCase() : relativePath;
}

function repoKey(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`.toLowerCase();
}

function checkoutPath(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split("/"));
}

function lacksGitMarker(root: string, relativePath: string): boolean {
  try {
    lstatSync(path.join(checkoutPath(root, relativePath), ".git"));
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
}

export async function inspectWorkspaceInventory(
  config: RepotruckConfig,
  env: EnvLike,
): Promise<InventoryIssue[]> {
  const { root, repos } = config;
  const host = new URL(await resolveGithubBaseUrl(env)).hostname;
  const hosts = ["github.com", host];
  const checkouts = await scanLocalCheckouts(root);
  const identified = checkouts.map((checkout) => ({
    checkout,
    repo: identifyCheckout(checkout, hosts),
  }));
  const byPath = new Map(identified.map((item) => [pathKey(item.checkout.relativePath), item]));
  const registered = new Map(repos.map((repo) => [repoKey(repo), repo]));
  const registeredPaths = new Set(repos.map((repo) => pathKey(repo.relativePath)));
  const relinkPaths = new Set<string>();
  const issues: InventoryIssue[] = [];

  for (const repo of repos) {
    const key = repoKey(repo);
    const current = byPath.get(pathKey(repo.relativePath));
    if (current && (current.repo === null || repoKey(current.repo) === key)) continue;
    if (!current && !lacksGitMarker(root, repo.relativePath)) continue;

    const matches = identified.filter(({ repo }) => repo !== null && repoKey(repo) === key);
    const to = matches.length === 1 ? matches[0]!.checkout.relativePath : undefined;
    const detail = `Missing checkout for ${repo.owner}/${repo.name} at ${repo.relativePath}`;
    if (to !== undefined && !registeredPaths.has(pathKey(to)) && !current) {
      relinkPaths.add(pathKey(to));
      issues.push({
        detail,
        suggestion: `Relink inventory to ${to}`,
        fix: { action: "relink", key, from: repo.relativePath, to },
      });
    } else if (matches.length === 0 && !current) {
      issues.push({
        detail,
        suggestion: "Remove the stale inventory record",
        fix: { action: "remove", key, relativePath: repo.relativePath },
      });
    } else {
      issues.push({
        detail,
        suggestion:
          "Inspect the checkout paths and Git origins. No unique replacement is available",
      });
    }
  }

  for (const { checkout, repo } of identified) {
    const relativePath = checkout.relativePath;
    if (registeredPaths.has(pathKey(relativePath)) || relinkPaths.has(pathKey(relativePath)))
      continue;
    const detail = `Unregistered Git checkout at ${relativePath}`;
    if (repo === null) {
      issues.push({
        detail,
        suggestion: "Set a GitHub origin and run Doctor again to register it",
      });
    } else if (
      registered.has(repoKey(repo)) ||
      identified.filter((item) => item.repo && repoKey(item.repo) === repoKey(repo)).length > 1
    ) {
      issues.push({
        detail,
        suggestion: `Choose the intended checkout for ${repo.owner}/${repo.name} before registering it`,
      });
    } else {
      const { owner, name, internal } = repo;
      issues.push({
        detail,
        suggestion: "Register the checkout at its current path",
        fix: { action: "adopt", owner, name, relativePath, internal },
      });
    }
  }
  return issues;
}

export async function applyInventoryFixes(
  root: string,
  fixes: readonly InventoryFix[],
  env: EnvLike,
): Promise<number> {
  const { result } = await updateWorkspace(
    root,
    (current) => {
      let config = current;
      let applied = 0;
      for (const fix of fixes) {
        const key = fix.action === "adopt" ? repoKey(fix) : fix.key;
        const entry = config.repos.find((candidate) => repoKey(candidate) === key);
        const target = fix.action === "relink" ? fix.to : fix.relativePath;
        if (fix.action === "remove") {
          if (entry?.relativePath !== target || !lacksGitMarker(root, target)) continue;
          config = { ...config, ...removeInventoryEntry(config, entry) };
        } else {
          if (config.repos.some((candidate) => pathKey(candidate.relativePath) === pathKey(target)))
            continue;
          if (inspectGitDotEntry(checkoutPath(root, target)).kind !== "repo") continue;
          if (fix.action === "adopt") {
            if (entry !== undefined) continue;
            const repo = {
              owner: fix.owner,
              name: fix.name,
              isArchived: false,
              isFork: false,
              language: null,
            };
            config = upsertInventory(config, repo, target, fix.internal);
            config.repos = config.repos.map((candidate) =>
              repoKey(candidate) === key ? { ...candidate, custom: true } : candidate,
            );
          } else {
            if (entry?.relativePath !== fix.from || !lacksGitMarker(root, fix.from)) continue;
            config = {
              ...config,
              repos: config.repos.map((candidate) =>
                candidate === entry
                  ? { ...candidate, relativePath: target, custom: true }
                  : candidate,
              ),
              ...(config.aliases
                ? {
                    aliases: Object.fromEntries(
                      Object.entries(config.aliases).map(([alias, relativePath]) => [
                        alias,
                        pathKey(relativePath) === pathKey(fix.from) ? target : relativePath,
                      ]),
                    ),
                  }
                : {}),
            };
          }
        }
        applied += 1;
      }
      return { config, result: applied };
    },
    env,
  );
  return result;
}

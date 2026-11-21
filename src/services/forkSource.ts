import type { GitHubRepoReader, RepoInfo } from "./github.ts";

export type RepoLookup = GitHubRepoReader["getRepo"];

export function lazyRepoLookup(connect: () => Promise<GitHubRepoReader>): RepoLookup {
  let client: Promise<GitHubRepoReader> | undefined;
  return async (owner, name) => {
    client ??= connect();
    return (await client).getRepo(owner, name);
  };
}

export function memoizeRepoLookup(lookup: RepoLookup): RepoLookup {
  const requests = new Map<string, Promise<RepoInfo>>();
  return (owner, name) => {
    const key = `${owner}/${name}`.toLowerCase();
    const cached = requests.get(key);
    if (cached !== undefined) return cached;
    const pending = lookup(owner, name).catch((error: unknown) => {
      requests.delete(key);
      throw error;
    });
    requests.set(key, pending);
    return pending;
  };
}

export async function lookupRepoDetails(
  repo: { owner: string; name: string },
  getRepo?: RepoLookup,
): Promise<RepoInfo | undefined> {
  try {
    return await getRepo?.(repo.owner, repo.name);
  } catch {
    return undefined;
  }
}

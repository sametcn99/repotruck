import type { GitHubService, RepoInfo } from "./services/github.ts";
import type { WorkspaceListing } from "./services/workspaceRegistry.ts";

export const TUI_MIN_BUN = "1.3.14";
export const TUI_MIN_NODE = "26.4";

export function isAtLeast(version: string, min: readonly number[]): boolean {
  const parts = version.split(/[.+-]/).map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < min.length; i += 1) {
    const part = parts[i] ?? 0;
    const required = min[i]!;
    // A missing component (e.g. "26.4" against [26, 4, 0]) counts as zero,
    // never as a failure.
    if (Number.isNaN(part)) return false;
    if (part > required) return true;
    if (part < required) return false;
  }
  return true;
}

export function tuiRuntimeError(
  bunVersion?: string | null,
  nodeVersion?: string | null,
): string | null {
  if (typeof bunVersion === "string" && bunVersion.length > 0) {
    return isAtLeast(bunVersion, [1, 3, 14])
      ? null
      : `The interactive interface requires Bun ${TUI_MIN_BUN} or newer (found Bun ${bunVersion}). Update Bun, or run repotruck with a supported runtime.`;
  }
  const node = typeof nodeVersion === "string" ? nodeVersion : "";
  if (isAtLeast(node, [26, 4, 0])) return null;
  return `The interactive interface requires Node.js ${TUI_MIN_NODE} or newer (found Node.js ${node.length > 0 ? node : "unknown"}), or Bun ${TUI_MIN_BUN} or newer. Install Bun and run repotruck with it.`;
}

export function detectTuiRuntimeError(): string | null {
  const globalBun = (globalThis as { Bun?: { version?: unknown } }).Bun;
  const bunVersion =
    globalBun !== undefined && typeof globalBun.version === "string" ? globalBun.version : null;
  return tuiRuntimeError(bunVersion, process.versions.node ?? null);
}

export type SyncScope = { kind: "user" } | { kind: "org"; org: string } | { kind: "all" };

export function parseSyncScope(scope: string): SyncScope | null {
  if (scope === "user") return { kind: "user" };
  if (scope === "all") return { kind: "all" };
  if (scope.startsWith("org:")) {
    const org = scope.slice("org:".length);
    if (org.length > 0) return { kind: "org", org };
  }
  return null;
}

export function describeSyncScope(scope: SyncScope): string {
  switch (scope.kind) {
    case "user":
      return "user";
    case "org":
      return `org:${scope.org}`;
    case "all":
      return "all";
  }
}

export function formatWorkspaceLine(listing: WorkspaceListing): string {
  const lastSync = listing.lastSync ?? "never";
  const missing = listing.missing ? " (missing)" : "";
  return `${listing.path} — preset ${listing.preset} — ${listing.repoCount} repositories — last sync: ${lastSync} — last used: ${listing.lastUsed}${missing}`;
}

export async function collectScopeRepos(
  github: GitHubService,
  scope: SyncScope,
): Promise<RepoInfo[]> {
  if (scope.kind === "user") return github.listUserRepos();
  if (scope.kind === "org") return github.listOrgRepos(scope.org);
  const seen = new Set<string>();
  const repos: RepoInfo[] = [];
  const push = (items: RepoInfo[]): void => {
    for (const repo of items) {
      const key = `${repo.owner}/${repo.name}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      repos.push(repo);
    }
  };
  push(await github.listUserRepos());
  const orgs = await github.getActiveOrgs();
  for (const org of orgs) {
    push(await github.listOrgRepos(org));
  }
  return repos;
}

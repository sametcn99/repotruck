import type { RepoInventoryEntry } from "../../services/config.ts";
import { validateCreateName } from "../../services/creator.ts";
import type { RepoInfo } from "../../services/github.ts";
import { validateMoveDestination } from "../../services/mover.ts";
import type {
  CreateDraft,
  CreateStep,
  FiltersState,
  HealthFilter,
  RepoLocalHealth,
  SidebarRow,
  SortKey,
  StoreSnapshot,
} from "./types.ts";

export function repoKey(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`;
}

function repoOrderKey(repo: RepoInfo): string {
  return `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
}

export function inventoryEntryToRepoInfo(entry: RepoInventoryEntry): RepoInfo {
  return {
    owner: entry.owner,
    name: entry.name,
    description: null,
    isPrivate: false,
    isFork: entry.category === "forks",
    isArchived: entry.category === "archived",
    language: entry.language ?? null,
    httpsUrl: `https://github.com/${entry.owner}/${entry.name}.git`,
    sshUrl: `git@github.com:${entry.owner}/${entry.name}.git`,
    updatedAt: entry.updatedAt ?? null,
    stars: null,
  };
}

export function filterRepos(repos: readonly RepoInfo[], filters: FiltersState): RepoInfo[] {
  return repos.filter((repo) => {
    if (repo.isArchived) return filters.archived;
    if (repo.isFork) return filters.forks;
    return filters.active;
  });
}

export function filterByHealth(
  repos: readonly RepoInfo[],
  healthFilter: HealthFilter,
  localHealth?: ReadonlyMap<string, RepoLocalHealth>,
): RepoInfo[] {
  if (healthFilter === "all" || localHealth === undefined) return [...repos];
  return repos.filter((repo) => {
    const h = localHealth.get(repoOrderKey(repo));
    switch (healthFilter) {
      case "dirty":
        return h?.dirty === true;
      case "ahead":
        return (h?.ahead ?? 0) > 0;
      case "behind":
        return (h?.behind ?? 0) > 0;
      case "pinned":
        return h?.pinned === true;
      case "local":
        return h?.tracked === true && h.missing !== true;
      case "uncloned":
        return h === undefined || !h.tracked || h.missing;
      default:
        return true;
    }
  });
}

export function searchRepos(
  repos: readonly RepoInfo[],
  term: string | null,
  localHealth?: ReadonlyMap<string, RepoLocalHealth>,
): RepoInfo[] {
  if (term === null || term.trim().length === 0) return [...repos];
  const raw = term.trim().toLowerCase();

  if (raw.startsWith("@") && raw.length > 1) {
    const aliasNeedle = raw.slice(1);
    return repos.filter((repo) => {
      const alias = localHealth?.get(repoOrderKey(repo))?.alias;
      return alias?.toLowerCase().includes(aliasNeedle) === true;
    });
  }

  const tokens = raw.split(/\s+/);
  let langFilter: string | null = null;
  const textTokens: string[] = [];
  for (const tok of tokens) {
    if (tok.startsWith("lang:") && tok.length > 5) {
      langFilter = tok.slice(5);
    } else {
      textTokens.push(tok);
    }
  }
  const needle = textTokens.join(" ");

  return repos.filter((repo) => {
    if (langFilter !== null) {
      if (repo.language === null || !repo.language.toLowerCase().includes(langFilter)) {
        return false;
      }
    }
    if (needle.length === 0) return true;
    const keyLower = repoOrderKey(repo);
    const alias = localHealth?.get(keyLower)?.alias;
    return (
      repo.owner.toLowerCase().includes(needle) ||
      repo.name.toLowerCase().includes(needle) ||
      keyLower.includes(needle) ||
      alias?.toLowerCase().includes(needle) === true
    );
  });
}

export function sortRepos(
  repos: readonly RepoInfo[],
  key: SortKey,
  descending = false,
  localHealth?: ReadonlyMap<string, RepoLocalHealth>,
): RepoInfo[] {
  const ascending = sortReposAscending(repos, key, localHealth);
  return descending ? ascending.reverse() : ascending;
}

function sortReposAscending(
  repos: readonly RepoInfo[],
  key: SortKey,
  localHealth?: ReadonlyMap<string, RepoLocalHealth>,
): RepoInfo[] {
  if (key === "default") return [...repos];
  const sorted = [...repos];
  sorted.sort((a, b) => {
    let result = 0;
    if (key === "name") {
      result = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    } else if (key === "language") {
      if (a.language === null && b.language === null) result = 0;
      else if (a.language === null) result = 1;
      else if (b.language === null) result = -1;
      else result = a.language.toLowerCase().localeCompare(b.language.toLowerCase());
    } else if (key === "stars") {
      const sa = typeof a.stars === "number" ? a.stars : -1;
      const sb = typeof b.stars === "number" ? b.stars : -1;
      result = sb - sa;
    } else if (key === "dirty") {
      const ha = localHealth?.get(repoOrderKey(a));
      const hb = localHealth?.get(repoOrderKey(b));
      const scoreA = (ha?.dirty ? 4 : 0) + ((ha?.ahead ?? 0) > 0 ? 2 : 0) + (ha?.pinned ? 1 : 0);
      const scoreB = (hb?.dirty ? 4 : 0) + ((hb?.ahead ?? 0) > 0 ? 2 : 0) + (hb?.pinned ? 1 : 0);
      result = scoreB - scoreA;
    } else {
      if (a.updatedAt === null && b.updatedAt === null) result = 0;
      else if (a.updatedAt === null) result = 1;
      else if (b.updatedAt === null) result = -1;
      else result = a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
    }
    if (result !== 0) return result;
    return repoOrderKey(a).localeCompare(repoOrderKey(b));
  });
  return sorted;
}

export type CreateStepOrNull = CreateStep | null;

export function nextCreateStep(step: CreateStep): CreateStepOrNull {
  if (step === "name") return "source";
  if (step === "source") return "org";
  if (step === "org") return "path";
  if (step === "path") return "description";
  if (step === "description") return "visibility";
  return null;
}

export function prevCreateStep(step: CreateStep): CreateStepOrNull {
  if (step === "visibility") return "description";
  if (step === "description") return "path";
  if (step === "path") return "org";
  if (step === "org") return "source";
  if (step === "source") return "name";
  return null;
}

export function validateCreateDraft(draft: CreateDraft): string | null {
  const nameError = validateCreateName(draft.name);
  if (nameError === null) {
    return `invalid repository name: ${draft.name}`;
  }
  if (draft.path.length > 0 && validateMoveDestination(draft.path) === null) {
    return `invalid destination path: ${draft.path}`;
  }
  return null;
}

export function buildSidebarRows(snapshot: StoreSnapshot): SidebarRow[] {
  const rows: SidebarRow[] = [
    {
      kind: "personal",
      label: `Personal (${snapshot.userLogin ?? "unknown"})`,
      checked: snapshot.includePersonal ?? true,
    },
  ];
  for (const org of snapshot.orgs) {
    rows.push({
      kind: "org",
      org,
      label: org,
      checked: snapshot.selectedOrgs.has(org),
    });
  }
  rows.push({ kind: "preset", label: `Preset: ${snapshot.preset}`, checked: false });
  rows.push({
    kind: "filter",
    key: "active",
    label: "Active",
    checked: snapshot.filters.active,
  });
  rows.push({
    kind: "filter",
    key: "forks",
    label: "Forks",
    checked: snapshot.filters.forks,
  });
  rows.push({
    kind: "filter",
    key: "archived",
    label: "Archived",
    checked: snapshot.filters.archived,
  });
  return rows;
}

export function sidebarRowIndexForY(localY: number, orgCount: number): number | null {
  if (localY <= 0) return null;
  if (localY <= 1 + orgCount) {
    return localY - 1;
  }
  if (localY === 2 + orgCount) return null;
  if (localY === 3 + orgCount) {
    return 1 + orgCount;
  }
  if (localY === 4 + orgCount) return null;
  const filterOffset = localY - (5 + orgCount);
  if (filterOffset >= 0 && filterOffset < 3) {
    return 2 + orgCount + filterOffset;
  }
  return null;
}

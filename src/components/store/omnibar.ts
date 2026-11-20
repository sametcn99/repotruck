import { REGISTRY } from "../../commands/registry.ts";
import type {
  CodeSearchMatch,
  CodeSearchResult,
  SearchCodeOptions,
} from "../../services/codeSearch.ts";
import type { RepotruckConfig } from "../../services/config.ts";
import type { RepoInfo } from "../../services/github.ts";
import { VIEW_SPECS } from "../views/viewRegistry.ts";
import type { GithubClient, OmnibarCommandItem, OmnibarMode, StoreSnapshot } from "./types.ts";

export const OMNIBAR_MODES: readonly OmnibarMode[] = ["commands", "symbols", "github", "runner"];

export function cycleOmnibarMode(current: OmnibarMode): OmnibarMode {
  const idx = OMNIBAR_MODES.indexOf(current);
  return OMNIBAR_MODES[(idx + 1) % OMNIBAR_MODES.length] ?? "commands";
}

/**
 * Case-insensitive fuzzy score: subsequence match with bonuses for word
 * starts and consecutive runs. `null` when the query does not match.
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) {
    return 100 - direct + (direct === 0 ? 50 : 0);
  }
  let score = 0;
  let qi = 0;
  let run = 0;
  let prevWordStart = false;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    const tc = t[ti]!;
    const wordStart = ti === 0 || /[\s\-_/]/.test(t[ti - 1] ?? "");
    if (tc === q[qi]) {
      run += 1;
      score += 10 + run * 2 + (wordStart ? 8 : 0) + (prevWordStart ? 4 : 0);
      qi += 1;
      prevWordStart = wordStart;
    } else {
      run = 0;
      prevWordStart = false;
    }
  }
  return qi === q.length ? score : null;
}

function itemScore(query: string, item: OmnibarCommandItem): number | null {
  const fields = [
    item.label,
    item.id,
    item.category ?? "",
    item.shortcut ?? "",
    item.keywords ?? "",
  ];
  let best: number | null = null;
  for (const field of fields) {
    const s = fuzzyScore(query, field);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

/**
 * Registry-derived palette entries: every CLI command/subcommand is
 * reachable from the palette. Commands whose root path already has a
 * richer UI entry (with shortcut and live detail) are skipped to avoid
 * duplicates; subcommands and uncovered commands are added with the
 * `cmd:` id prefix.
 */
export function buildRegistryPaletteItems(uiIds: ReadonlySet<string>): OmnibarCommandItem[] {
  const items: OmnibarCommandItem[] = [];
  for (const spec of REGISTRY) {
    if (spec.id === "__globals__") continue;
    const rootToken = spec.path.split(" ")[0]!;
    if (spec.id === rootToken && uiIds.has(rootToken)) continue;
    items.push({
      id: `cmd:${spec.id}`,
      label: `${spec.path} — ${spec.title}`,
      category: spec.group,
      keywords: `${spec.summary} ${spec.flags.map((flag) => flag.flag).join(" ")}`,
    });
  }
  return items;
}

/**
 * Navigation entries for every dashboard view, derived from the same
 * registry the nav rail renders from — the palette can never miss a page.
 */
export function buildViewPaletteItems(snapshot: StoreSnapshot): OmnibarCommandItem[] {
  return VIEW_SPECS.map((spec) => ({
    id: `view:${spec.id}`,
    category: "Go",
    label: `Go to ${spec.title} — ${spec.summary}`,
    shortcut: spec.id === "cockpit" ? "Esc" : `v ${spec.go}`,
    detail: snapshot.view === spec.id ? "active" : undefined,
    keywords: `go open navigate view page ${spec.group} ${spec.summary}`,
  }));
}

export function buildCommandPaletteItems(
  query: string,
  snapshot: StoreSnapshot,
): OmnibarCommandItem[] {
  const currentRepo = snapshot.filteredRepos[snapshot.cursor];
  const currentRepoKey =
    currentRepo !== undefined ? `${currentRepo.owner}/${currentRepo.name}` : undefined;
  const sortDirLabel = snapshot.sortDescending ? "descending" : "ascending";

  const all: OmnibarCommandItem[] = [
    // View Navigation (every page is reachable from the palette)
    ...buildViewPaletteItems(snapshot),

    // Sync, Clone & Omnibar Modes
    {
      id: "sync",
      category: "Sync",
      label: "Sync selected repositories",
      shortcut: "Enter",
      detail: `${snapshot.selected.size} selected`,
      keywords: "pull clone mirror start",
    },
    {
      id: "clone",
      category: "Sync",
      label: "Clone repository by URL or owner/name",
      shortcut: "c",
      keywords: "git url add",
    },
    {
      id: "create",
      category: "Sync",
      label: "Create new repository wizard",
      shortcut: "n",
      keywords: "new github init",
    },
    {
      id: "scan",
      category: "Sync",
      label: "Scan disk & adopt untracked Git repositories",
      detail: "scan --adopt",
      keywords: "discover local adopt untracked",
    },
    {
      id: "refresh",
      category: "Sync",
      label: "Refresh GitHub & local workspace state",
      detail: snapshot.offline ? "reconnect" : "reload",
      keywords: "reload fetch auth",
    },
    {
      id: "mode-symbols",
      category: "Mode",
      label: "Workspace Code Search (AST symbols & text:)",
      shortcut: "@",
      keywords: "search code symbol function class grep",
    },
    {
      id: "mode-github",
      category: "Mode",
      label: "GitHub Discover (search & clone remote repos)",
      shortcut: "#",
      keywords: "discover remote explore public",
    },
    {
      id: "mode-runner",
      category: "Mode",
      label: "Bulk Command Runner (run shell command across repos)",
      shortcut: "!",
      keywords: "exec shell batch command run",
    },

    // Repository Actions
    {
      id: "open",
      category: "Repo",
      label: "Open highlighted repository in app / editor / shell",
      shortcut: "o",
      detail: currentRepoKey,
      keywords: "vscode cursor terminal code launch",
    },
    {
      id: "detail",
      category: "Repo",
      label: "Inspect repository details & metadata",
      shortcut: "i",
      detail: currentRepoKey,
      keywords: "info stars description branch",
    },
    {
      id: "worktree",
      category: "Repo",
      label: "Manage linked git worktrees for highlighted repository",
      shortcut: "W",
      detail: currentRepoKey,
      keywords: "worktree branch checkout linked",
    },
    {
      id: "move",
      category: "Repo",
      label: "Move highlighted repository to custom path",
      shortcut: "m",
      detail: currentRepoKey,
      keywords: "relocate folder directory",
    },
    {
      id: "alias",
      category: "Repo",
      label: "Set or update @alias for highlighted repository",
      shortcut: "r",
      detail: currentRepoKey,
      keywords: "nickname shortcut tag",
    },
    {
      id: "pin",
      category: "Repo",
      label: "Pin / unpin repository (Active Focus in AGENTS.md)",
      shortcut: "P",
      detail: `${snapshot.pinnedCount} pinned`,
      keywords: "star favorite focus profile",
    },
    {
      id: "select-toggle",
      category: "Repo",
      label: "Select / deselect highlighted repository",
      shortcut: "Space",
      detail: currentRepoKey,
      keywords: "check mark toggle",
    },
    {
      id: "select-all",
      category: "Repo",
      label: "Select / deselect all filtered repositories",
      shortcut: "a",
      detail: `${snapshot.filteredRepos.length} visible`,
      keywords: "bulk check clear all",
    },
    {
      id: "archive",
      category: "Repo",
      label: "Archive repository on GitHub + move to archived/",
      shortcut: "A",
      keywords: "readonly retire",
    },
    {
      id: "untrack",
      category: "Repo",
      label: "Untrack repository (keep files on disk)",
      shortcut: "u",
      keywords: "forget remove inventory",
    },
    {
      id: "delete",
      category: "Repo",
      label: "Delete repository to .repotruck/trash",
      shortcut: "D",
      keywords: "remove trash rm",
    },
    {
      id: "undo",
      category: "Repo",
      label: "Undo last move or delete",
      shortcut: "z",
      detail: snapshot.canUndo ? "ready" : "empty",
      keywords: "restore revert",
    },

    // Search, Filter & Scope
    {
      id: "search",
      category: "Filter",
      label: "Filter repositories by owner, name, or @alias",
      shortcut: "/",
      detail: snapshot.search !== null ? `"${snapshot.search}"` : undefined,
      keywords: "find query filter",
    },
    {
      id: "clear-search",
      category: "Filter",
      label: "Clear active repository search filter",
      shortcut: "Esc",
      detail: snapshot.search !== null ? `"${snapshot.search}"` : "none",
      keywords: "reset search",
    },
    {
      id: "health-filter",
      category: "Filter",
      label: "Cycle Git health filter",
      shortcut: "f",
      detail: snapshot.healthFilter,
      keywords: "status git filter",
    },
    {
      id: "health-all",
      category: "Filter",
      label: "Git filter: Show all repositories",
      detail: snapshot.healthFilter === "all" ? "active" : undefined,
      keywords: "reset health all",
    },
    {
      id: "health-dirty",
      category: "Filter",
      label: "Git filter: Dirty working tree only",
      detail: snapshot.healthFilter === "dirty" ? "active" : undefined,
      keywords: "modified uncommitted changes",
    },
    {
      id: "health-ahead",
      category: "Filter",
      label: "Git filter: Unpushed commits (ahead)",
      detail: snapshot.healthFilter === "ahead" ? "active" : undefined,
      keywords: "outgoing unpushed",
    },
    {
      id: "health-behind",
      category: "Filter",
      label: "Git filter: Behind upstream",
      detail: snapshot.healthFilter === "behind" ? "active" : undefined,
      keywords: "incoming outdated pull",
    },
    {
      id: "health-pinned",
      category: "Filter",
      label: "Git filter: Pinned Active Focus only",
      detail: snapshot.healthFilter === "pinned" ? "active" : undefined,
      keywords: "starred focus",
    },
    {
      id: "health-local",
      category: "Filter",
      label: "Git filter: Cloned locally only",
      detail: snapshot.healthFilter === "local" ? "active" : undefined,
      keywords: "disk tracked installed",
    },
    {
      id: "health-uncloned",
      category: "Filter",
      label: "Git filter: Not cloned locally",
      detail: snapshot.healthFilter === "uncloned" ? "active" : undefined,
      keywords: "remote missing uncloned",
    },
    {
      id: "scope-personal",
      category: "Filter",
      label: "Toggle personal repositories in scope",
      detail: snapshot.includePersonal ? "on" : "off",
      keywords: "user owner scope sidebar",
    },
    {
      id: "filter-active",
      category: "Filter",
      label: "Toggle active (source) repositories filter",
      detail: snapshot.filters.active ? "on" : "off",
      keywords: "category source",
    },
    {
      id: "filter-forks",
      category: "Filter",
      label: "Toggle fork repositories filter",
      detail: snapshot.filters.forks ? "on" : "off",
      keywords: "category forks",
    },
    {
      id: "filter-archived",
      category: "Filter",
      label: "Toggle archived repositories filter",
      detail: snapshot.filters.archived ? "on" : "off",
      keywords: "category archived",
    },

    // Sorting
    {
      id: "sort-cycle",
      category: "Sort",
      label: "Cycle sort key",
      shortcut: "s",
      detail: `${snapshot.sortKey} (${sortDirLabel})`,
    },
    {
      id: "sort-reverse",
      category: "Sort",
      label: "Reverse sort direction (ascending / descending)",
      shortcut: "S",
      detail: sortDirLabel,
      keywords: "order asc desc",
    },
    {
      id: "sort-default",
      category: "Sort",
      label: "Sort repositories by default order",
      detail: snapshot.sortKey === "default" ? "active" : undefined,
    },
    {
      id: "sort-name",
      category: "Sort",
      label: "Sort repositories by name",
      detail: snapshot.sortKey === "name" ? "active" : undefined,
    },
    {
      id: "sort-language",
      category: "Sort",
      label: "Sort repositories by primary language",
      detail: snapshot.sortKey === "language" ? "active" : undefined,
    },
    {
      id: "sort-updated",
      category: "Sort",
      label: "Sort repositories by last updated date",
      detail: snapshot.sortKey === "updatedAt" ? "active" : undefined,
    },
    {
      id: "sort-stars",
      category: "Sort",
      label: "Sort repositories by GitHub stars",
      detail: snapshot.sortKey === "stars" ? "active" : undefined,
    },
    {
      id: "sort-dirty",
      category: "Sort",
      label: "Sort repositories by dirty / ahead state",
      detail: snapshot.sortKey === "dirty" ? "active" : undefined,
    },

    // View, Panes & Appearance
    {
      id: "tab-activity",
      category: "View",
      label: "Right pane: Activity Stream",
      shortcut: "1",
      detail: snapshot.rightPaneTab === "activity" ? "active" : undefined,
    },
    {
      id: "tab-inspector",
      category: "View",
      label: "Right pane: Live Git Inspector",
      shortcut: "2",
      detail: snapshot.rightPaneTab === "inspector" ? "active" : undefined,
    },
    {
      id: "tab-health",
      category: "View",
      label: "Right pane: Workspace Health & Doctor",
      shortcut: "3",
      detail: snapshot.rightPaneTab === "health" ? "active" : undefined,
    },
    {
      id: "focus-cycle",
      category: "View",
      label: "Cycle active pane focus (Scope / Repos / Status)",
      shortcut: "Tab",
      detail: snapshot.focus,
    },
    {
      id: "theme",
      category: "View",
      label: "Cycle TUI color theme",
      shortcut: "t",
      detail: snapshot.themeName,
      keywords: "dark light contrast colors",
    },

    // Workspace, Layout & Maintenance
    {
      id: "workspaces",
      category: "Workspace",
      label: "Switch or manage registered workspaces",
      shortcut: "w",
      keywords: "registry list projects",
    },
    {
      id: "preset",
      category: "Workspace",
      label: "Cycle directory layout preset",
      shortcut: "p",
      detail: snapshot.preset,
      keywords: "categorized flat owner language",
    },
    {
      id: "reorganize",
      category: "Workspace",
      label: "Reorganize workspace directory layout",
      shortcut: "R",
      keywords: "migrate layout preset move",
    },
    {
      id: "root",
      category: "Workspace",
      label: "Configure default workspace root directory",
      shortcut: "d",
      keywords: "path folder settings",
    },
    {
      id: "doctor-fix",
      category: "Workspace",
      label: "Run Doctor auto-fix on workspace",
      shortcut: "F",
      keywords: "health repair journal check",
    },
    {
      id: "instructions-sync",
      category: "Workspace",
      label: "Regenerate workspace AGENTS.md map",
      detail: "instructions",
      keywords: "agents markdown ai map",
    },
    {
      id: "code-index",
      category: "Workspace",
      label: "Rebuild workspace Tree-sitter code search index",
      detail: "search-code --rebuild",
      keywords: "ast symbols index",
    },
    {
      id: "backup-snapshot",
      category: "Workspace",
      label: "Save workspace configuration backup snapshot",
      detail: ".repotruck/backups",
      keywords: "export snapshot config",
    },
    {
      id: "trash-empty",
      category: "Workspace",
      label: "Empty workspace .repotruck/trash",
      detail: "trash empty",
      keywords: "purge clean disk",
    },
    {
      id: "offline",
      category: "Workspace",
      label: "Switch to Offline Mode (local inventory only)",
      detail: snapshot.offline ? "active" : undefined,
      keywords: "local airplane disconnect",
    },
    {
      id: "help",
      category: "Help",
      label: "Show all keyboard shortcuts",
      shortcut: "?",
      keywords: "keys manual",
    },
  ];

  const uiItems = all;
  const uiIds = new Set(uiItems.map((item) => item.id));
  const merged = [...uiItems, ...buildRegistryPaletteItems(uiIds)];

  const needle = query.trim();
  if (needle.length === 0) return merged;
  const scored: { item: OmnibarCommandItem; score: number }[] = [];
  for (const item of merged) {
    const score = itemScore(needle, item);
    if (score !== null) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.item);
}

export async function runOmnibarSymbolSearch(
  root: string,
  config: RepotruckConfig,
  query: string,
  searchFn: (options: SearchCodeOptions) => Promise<CodeSearchResult>,
): Promise<CodeSearchMatch[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const textMode = trimmed.startsWith("text:");
  const pattern = textMode ? trimmed.slice(5).trim() : trimmed;
  if (pattern.length === 0) return [];
  const res = await searchFn({
    root,
    config,
    pattern,
    text: textMode,
    limit: 25,
    offline: true,
  });
  return res.matches;
}

export async function runOmnibarGithubSearch(
  github: GithubClient | null,
  query: string,
): Promise<RepoInfo[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2 || github === null || typeof github.searchRepos !== "function") {
    return [];
  }
  return await github.searchRepos(trimmed, 20);
}

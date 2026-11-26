import type { ViewId } from "../store/types.ts";

/**
 * Static metadata for every dashboard view. The Views menu, `v`-prefix
 * dispatch, `[`/`]` cycling and the help screen all render from this
 * registry so a new page can never miss a surface.
 */
export interface ViewSpec {
  readonly id: ViewId;
  /** Short label shown in the Views menu and page headers. */
  readonly title: string;
  /** Views menu group heading. */
  readonly group: string;
  /** Letter pressed after the `v` prefix to open this view. */
  readonly go: string;
  /** One-line purpose shown by the placeholder page and help. */
  readonly summary: string;
  /** Implementing ticket; placeholders cite it until the real page lands. */
  readonly ticket: string;
}

export const VIEW_SPECS: readonly ViewSpec[] = [
  {
    id: "cockpit",
    title: "Cockpit",
    group: "Workspace",
    go: "h",
    summary: "scope, repository list and activity",
    ticket: "—",
  },
  {
    id: "sync",
    title: "Sync Center",
    group: "Workspace",
    go: "s",
    summary: "bulk sync with every flag plus watch mode",
    ticket: "t14",
  },
  {
    id: "gists",
    title: "Gists",
    group: "Workspace",
    go: "j",
    summary: "browse, sync and manage GitHub Gists",
    ticket: "—",
  },
  {
    id: "discover",
    title: "Discover",
    group: "Workspace",
    go: "d",
    summary: "qualified GitHub search and bulk clone",
    ticket: "t16",
  },
  {
    id: "scan",
    title: "Scan",
    group: "Workspace",
    go: "n",
    summary: "find unregistered repos and adopt them",
    ticket: "t17",
  },
  {
    id: "status",
    title: "Status",
    group: "Inspect",
    go: "t",
    summary: "per-repo git health across the workspace",
    ticket: "t05",
  },
  {
    id: "search",
    title: "Code Search",
    group: "Inspect",
    go: "e",
    summary: "tree-sitter symbol, text and regex search",
    ticket: "t06",
  },
  {
    id: "stats",
    title: "Stats",
    group: "Inspect",
    go: "i",
    summary: "language, disk and health scorecard",
    ticket: "t08",
  },
  {
    id: "changelog",
    title: "Changelog",
    group: "Inspect",
    go: "c",
    summary: "workspace changelog preview and export",
    ticket: "t17",
  },
  {
    id: "run",
    title: "Run Console",
    group: "Automate",
    go: "r",
    summary: "run a command across selected repositories",
    ticket: "t07",
  },
  {
    id: "presets",
    title: "Presets",
    group: "Organize",
    go: "p",
    summary: "browse, build and remove layout presets",
    ticket: "t11",
  },
  {
    id: "profiles",
    title: "Profiles",
    group: "Organize",
    go: "f",
    summary: "pinned repos and named repository profiles",
    ticket: "t11",
  },
  {
    id: "trash",
    title: "Trash",
    group: "Organize",
    go: "b",
    summary: "restore trashed repos and snapshots",
    ticket: "t09",
  },
  {
    id: "worktree",
    title: "Worktrees",
    group: "Organize",
    go: "w",
    summary: "workspace-wide linked worktree browser",
    ticket: "t18",
  },
  {
    id: "agents",
    title: "Agents",
    group: "System",
    go: "g",
    summary: "AGENTS.md templates, exports and MCP server",
    ticket: "t12",
  },
  {
    id: "settings",
    title: "Settings",
    group: "System",
    go: "a",
    summary: "configuration, auth, update and completions",
    ticket: "t10",
  },
  {
    id: "resolve",
    title: "Conflicts",
    group: "Workspace",
    go: "x",
    summary: "inspect and continue/abort stuck rebases",
    ticket: "t15",
  },
  {
    id: "about",
    title: "About",
    group: "System",
    go: "o",
    summary: "about Repotruck and its GitHub project",
    ticket: "—",
  },
  {
    id: "log",
    title: "Log",
    group: "System",
    go: "l",
    summary: "captured errors, warnings and runtime diagnostics",
    ticket: "—",
  },
];

export const VIEW_ORDER: readonly ViewId[] = VIEW_SPECS.map((spec) => spec.id);

export const VIEW_BY_ID: ReadonlyMap<ViewId, ViewSpec> = new Map(
  VIEW_SPECS.map((spec) => [spec.id, spec]),
);

/** `v` + letter dispatch table; letters are unique across views. */
export const VIEW_GO_KEYS: ReadonlyMap<string, ViewId> = new Map(
  VIEW_SPECS.map((spec) => [spec.go, spec.id]),
);

export const VIEW_MENU_GROUPS = ["Workspace", "Inspect", "Automate", "Organize", "System"].map(
  (title) => ({ title, views: VIEW_SPECS.filter((spec) => spec.group === title) }),
);

export function nextViewId(current: ViewId, direction: 1 | -1): ViewId {
  const index = VIEW_ORDER.indexOf(current);
  const next = (index + direction + VIEW_ORDER.length) % VIEW_ORDER.length;
  return VIEW_ORDER[next]!;
}

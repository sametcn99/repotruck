import type { ViewId } from "../components/store/types.ts";

/**
 * Single source of truth for CLI/TUI parity: every CLI command, subcommand
 * and flag carries its planned TUI surface here. The command palette, nav
 * rail links, context menu and the parity test all render from this data —
 * a CLI flag without a registry entry fails `tests/parity.test.ts`.
 *
 * Inventory mirrors `src/cli/commands/*` (see docs: website CommandReference).
 */

export type FlagType =
  | "bool"
  | "enum"
  | "int"
  | "optional-int"
  | "string"
  | "path"
  | "url"
  | "list";

/** Candidate sources shared with the hidden `__complete` CLI helper. */
export type CompleteSource =
  | "presets"
  | "apps"
  | "aliases"
  | "scopes"
  | "kinds"
  | "langs"
  | "divergence";

export type TuiBinding =
  | { kind: "view"; view: ViewId }
  | { kind: "modal"; modal: string }
  | { kind: "action"; action: string }
  | { kind: "planned"; ticket: string };

export interface FlagSpec {
  /** Long form without placeholder, e.g. "--scope". */
  readonly flag: string;
  readonly short?: string;
  readonly type: FlagType;
  readonly values?: readonly string[];
  readonly default?: string;
  readonly complete?: CompleteSource;
  readonly summary: string;
  /** Short description of the TUI control covering this flag. */
  readonly tui: string;
  /** CLI-only semantics adapted to a TUI equivalent (see plan principle 4). */
  readonly adapted?: boolean;
}

export interface ArgSpec {
  readonly name: string;
  readonly required: boolean;
  readonly summary: string;
}

export interface CommandSpec {
  /** Stable id, subcommands dot-separated: "sync", "sync.resolve". */
  readonly id: string;
  /** CLI spelling: "sync", "sync resolve", "trash empty". */
  readonly path: string;
  readonly title: string;
  readonly group: CommandGroup;
  readonly summary: string;
  readonly args: readonly ArgSpec[];
  readonly flags: readonly FlagSpec[];
  readonly surface: TuiBinding;
  readonly requires: readonly ("workspace" | "auth" | "selection")[];
}

export type CommandGroup =
  | "Sync"
  | "Lifecycle"
  | "Workspace"
  | "Search"
  | "Platform"
  | "Settings"
  | "Global";

const f = (
  flag: string,
  type: FlagType,
  summary: string,
  tui: string,
  extra: Partial<FlagSpec> = {},
): FlagSpec => ({ flag, type, summary, tui, ...extra });

const jsonFlag = (tui: string): FlagSpec =>
  f("--json", "bool", "machine-readable JSON output", tui, { adapted: true });

export const REGISTRY: readonly CommandSpec[] = [
  // ---- sync & clone -------------------------------------------------------
  {
    id: "sync",
    path: "sync",
    title: "Sync Center",
    group: "Sync",
    summary: "Clone or update repositories in bulk",
    args: [],
    surface: { kind: "view", view: "sync" },
    requires: ["workspace", "auth"],
    flags: [
      f(
        "--scope",
        "enum",
        '"user" (default), "org:<name>", or "all"',
        "scope picker (selection/personal/orgs/all/pinned/profile)",
        { short: "-s", values: ["user", "org:<name>", "all"], default: "user", complete: "scopes" },
      ),
      f("--pinned", "bool", "sync only pinned repositories", "scope: pinned"),
      f("--profile", "string", "sync only a named profile", "scope: profile picker"),
      f("--limit", "int", "first N repos of the scope in API order", "number stepper"),
      f("--concurrency", "int", "parallel repositories", "stepper (settings default)", {
        short: "-c",
        default: "3",
      }),
      f("--depth", "int", "shallow clone depth (new clones only)", "stepper (off default)"),
      f("--blobless", "bool", "blobless partial clones", "toggle"),
      f("--stash", "bool", "stash uncommitted changes before update", "toggle"),
      f("--divergence", "enum", "ahead-of-origin strategy", "enum picker", {
        values: ["fail", "rebase", "reset", "skip"],
        default: "fail",
        complete: "divergence",
      }),
      f("--include", "list", "only repos matching glob", "list editor"),
      f("--exclude", "list", "skip repos matching glob", "list editor"),
      f(
        "--watch",
        "optional-int",
        "keep syncing every N seconds (default 300)",
        "watch toggle + countdown",
        { default: "300" },
      ),
      f("--base-url", "url", "GitHub Enterprise API URL", "Settings › connection"),
      f("--preset", "string", "target layout preset", "preset picker (p)", {
        short: "-p",
        complete: "presets",
      }),
      jsonFlag("copy-as-JSON on summary"),
    ],
  },
  {
    id: "sync.resolve",
    path: "sync resolve",
    title: "Resolve conflicts",
    group: "Sync",
    summary: "Inspect and resolve git conflict / rebase state",
    args: [{ name: "repo", required: false, summary: "repo ref; defaults to root" }],
    surface: { kind: "view", view: "resolve" },
    requires: ["workspace"],
    flags: [
      f("--action", "enum", "execute resolution", "continue/abort row actions", {
        values: ["continue", "abort"],
      }),
      jsonFlag("guide as JSON"),
    ],
  },
  {
    id: "clone",
    path: "clone",
    title: "Clone repository",
    group: "Sync",
    summary: "Clone or update a single repository into the layout",
    args: [{ name: "url", required: true, summary: "GitHub URL or owner/name" }],
    surface: { kind: "modal", modal: "clone" },
    requires: ["workspace", "auth"],
    flags: [
      f("--preset", "string", "layout preset", "current preset + picker", {
        short: "-p",
        complete: "presets",
      }),
      f("--depth", "int", "shallow clone depth", "advanced option"),
      f("--blobless", "bool", "blobless partial clone", "advanced option"),
      f("--sparse", "list", "sparse checkout paths", "list editor"),
      f("--base-url", "url", "GitHub Enterprise API URL", "Settings › connection"),
      jsonFlag("result as JSON copy"),
    ],
  },
  {
    id: "discover",
    path: "discover",
    title: "Discover",
    group: "Sync",
    summary: "Search GitHub with qualifiers and optionally clone matches",
    args: [{ name: "query", required: true, summary: "repository search query" }],
    surface: { kind: "view", view: "discover" },
    requires: ["auth"],
    flags: [
      f("--org", "string", "restrict to an organization", "qualifier field"),
      f("--lang", "string", "restrict primary language", "qualifier field"),
      f("--min-stars", "int", "minimum stars", "number field"),
      f("--topic", "list", "required topics (repeatable)", "list editor"),
      f("--include-archived", "bool", "include archived repos", "toggle"),
      f("--include-forks", "bool", "include forks", "toggle"),
      f("--limit", "int", "max results (default 20, cap 200)", "stepper", {
        short: "-l",
        default: "20",
      }),
      f("--clone", "bool", "clone matches into the workspace", "select + bulk clone"),
      f("--depth", "int", "shallow depth when cloning", "clone option"),
      f("--blobless", "bool", "blobless when cloning", "clone option"),
      f("--preset", "string", "layout preset", "preset picker", {
        short: "-p",
        complete: "presets",
      }),
      f("--base-url", "url", "GitHub Enterprise API URL", "Settings › connection"),
      jsonFlag("copy results as JSON"),
    ],
  },

  // ---- lifecycle ----------------------------------------------------------
  {
    id: "forget",
    path: "forget",
    title: "Untrack",
    group: "Lifecycle",
    summary: "Stop tracking; the clone stays on disk",
    args: [{ name: "repo", required: true, summary: "repo ref" }],
    surface: { kind: "action", action: "openSelectionUntrackConfirm" },
    requires: ["workspace"],
    flags: [],
  },
  {
    id: "prune",
    path: "prune",
    title: "Prune",
    group: "Lifecycle",
    summary: "Untrack repositories deleted on GitHub",
    args: [],
    surface: { kind: "planned", ticket: "t17" },
    requires: ["workspace", "auth"],
    flags: [
      f("--dry-run", "bool", "only list what would be pruned", "preview step (TUI default)", {
        adapted: true,
      }),
      f("--base-url", "url", "GitHub Enterprise API URL", "Settings › connection"),
      jsonFlag("result as JSON copy"),
    ],
  },
  {
    id: "delete",
    path: "delete",
    title: "Delete",
    group: "Lifecycle",
    summary: "Untrack and remove the repository directory",
    args: [{ name: "repo", required: true, summary: "repo ref" }],
    surface: { kind: "action", action: "openSelectionDeleteConfirm" },
    requires: ["workspace"],
    flags: [
      f(
        "--yes",
        "bool",
        "confirm the deletion (required)",
        "confirm dialog; permanent path types the repo name",
        { adapted: true },
      ),
    ],
  },
  {
    id: "trash.list",
    path: "trash list",
    title: "Trash list",
    group: "Lifecycle",
    summary: "List soft-deleted repositories",
    args: [],
    surface: { kind: "view", view: "trash" },
    requires: ["workspace"],
    flags: [jsonFlag("entries as JSON copy")],
  },
  {
    id: "trash.restore",
    path: "trash restore",
    title: "Trash restore",
    group: "Lifecycle",
    summary: "Restore a trashed repository",
    args: [{ name: "selector", required: true, summary: "trash id, owner/name, or name" }],
    surface: { kind: "view", view: "trash" },
    requires: ["workspace"],
    flags: [jsonFlag("result as JSON copy")],
  },
  {
    id: "trash.empty",
    path: "trash empty",
    title: "Trash empty",
    group: "Lifecycle",
    summary: "Permanently remove trashed directories",
    args: [],
    surface: { kind: "action", action: "trash-empty" },
    requires: ["workspace"],
    flags: [
      f("--older-than", "int", "only entries older than N days", "day stepper"),
      f("--yes", "bool", "confirm permanent removal (required)", "confirm dialog", {
        adapted: true,
      }),
      jsonFlag("result as JSON copy"),
    ],
  },
  {
    id: "archive",
    path: "archive",
    title: "Archive",
    group: "Lifecycle",
    summary: "Archive on GitHub and re-file under archived/",
    args: [{ name: "repo", required: true, summary: "repo ref" }],
    surface: { kind: "action", action: "openSelectionArchiveConfirm" },
    requires: ["workspace", "auth"],
    flags: [f("--base-url", "url", "GitHub Enterprise API URL", "Settings › connection")],
  },
  {
    id: "status",
    path: "status",
    title: "Status Matrix",
    group: "Lifecycle",
    summary: "Per-repository git health",
    args: [],
    surface: { kind: "view", view: "status" },
    requires: ["workspace"],
    flags: [
      f("--detail", "bool", "unpushed commits and diff stats", "expandable rows", { short: "-D" }),
      f("--filter", "enum", "dirty / unpushed / unpulled / all", "filter chips", {
        short: "-f",
        values: ["dirty", "uncommitted", "unpushed", "unpulled", "all"],
      }),
      f("--pinned", "bool", "only pinned repositories", "filter chip"),
      f("--profile", "string", "only a named profile", "filter chip: profile picker"),
      f("--remote", "bool", "open PR counts + CI check state", "remote toggle (PR/CI columns)"),
      f("--check", "bool", "exit non-zero when attention needed", "summary ribbon", {
        adapted: true,
      }),
      f("--base-url", "url", "GitHub Enterprise API URL", "Settings › connection"),
      jsonFlag("copy table as JSON"),
    ],
  },

  // ---- workspace & layout -------------------------------------------------
  {
    id: "create",
    path: "create",
    title: "Create repository",
    group: "Workspace",
    summary: "Create a GitHub repository and register it",
    args: [{ name: "name", required: true, summary: "new repository name" }],
    surface: { kind: "modal", modal: "create" },
    requires: ["auth"],
    flags: [
      f("--from", "path", "import an existing local directory", "wizard source step"),
      f("--at", "path", "custom workspace-relative path", "wizard path step"),
      f("--public", "bool", "create as public", "wizard visibility step"),
      f("--private", "bool", "create as private (default)", "wizard visibility step"),
      f("--description", "string", "short description", "wizard description step"),
      f("--org", "string", "create inside an organization", "wizard owner step"),
      f("--base-url", "url", "GitHub Enterprise API URL", "Settings › connection"),
    ],
  },
  {
    id: "move",
    path: "move",
    title: "Move",
    group: "Workspace",
    summary: "Move a repository to a custom path",
    args: [
      { name: "repo", required: true, summary: "owner/name" },
      { name: "path", required: true, summary: "relative destination" },
    ],
    surface: { kind: "modal", modal: "move" },
    requires: ["workspace"],
    flags: [],
  },
  {
    id: "scan",
    path: "scan",
    title: "Scan & adopt",
    group: "Workspace",
    summary: "Discover unregistered repos and adopt them",
    args: [{ name: "directory", required: false, summary: "scan root (defaults to workspace)" }],
    surface: { kind: "view", view: "scan" },
    requires: ["workspace"],
    flags: [
      f("--move", "bool", "adopt and move into layout", "adopt plan + apply", { short: "-m" }),
      f("--dry-run", "bool", "preview planned moves", "preview step (TUI default)", {
        adapted: true,
      }),
      jsonFlag("result as JSON copy"),
    ],
  },
  {
    id: "reorganize",
    path: "reorganize",
    title: "Reorganize",
    group: "Workspace",
    summary: "Re-file every repository into a new preset",
    args: [{ name: "preset", required: false, summary: "target preset (optional with --resume)" }],
    surface: { kind: "modal", modal: "reorganize" },
    requires: ["workspace"],
    flags: [
      f("--scan", "bool", "also adopt untracked repos", "include-scan checkbox"),
      f("--dry-run", "bool", "show the move plan only", "live preview (TUI default)", {
        adapted: true,
      }),
      f("--keep-custom", "bool", "keep manually placed repos", "keep-custom checkbox"),
      f("--resume", "bool", "resume from the interrupted journal", "resume banner + action"),
      jsonFlag("result as JSON copy"),
    ],
  },
  {
    id: "preset.list",
    path: "preset list",
    title: "Preset list",
    group: "Workspace",
    summary: "List built-in and custom presets",
    args: [],
    surface: { kind: "view", view: "presets" },
    requires: [],
    flags: [],
  },
  {
    id: "preset.add",
    path: "preset add",
    title: "Preset add",
    group: "Workspace",
    summary: "Add a custom layout preset",
    args: [
      { name: "id", required: true, summary: "preset id" },
      {
        name: "segments",
        required: true,
        summary: "owner/category/language/name tokens (name last)",
      },
    ],
    surface: { kind: "view", view: "presets" },
    requires: [],
    flags: [],
  },
  {
    id: "preset.remove",
    path: "preset remove",
    title: "Preset remove",
    group: "Workspace",
    summary: "Remove a custom preset",
    args: [{ name: "id", required: true, summary: "preset id" }],
    surface: { kind: "view", view: "presets" },
    requires: [],
    flags: [],
  },
  {
    id: "profile.list",
    path: "profile list",
    title: "Profile list",
    group: "Workspace",
    summary: "List pinned repos and named profiles",
    args: [],
    surface: { kind: "view", view: "profiles" },
    requires: [],
    flags: [jsonFlag("profiles as JSON copy")],
  },
  {
    id: "profile.pin",
    path: "profile pin",
    title: "Pin",
    group: "Workspace",
    summary: "Pin repositories as active focus",
    args: [{ name: "repos", required: true, summary: "repo refs (variadic)" }],
    surface: { kind: "action", action: "togglePinSelection" },
    requires: ["workspace"],
    flags: [jsonFlag("result as JSON copy")],
  },
  {
    id: "profile.unpin",
    path: "profile unpin",
    title: "Unpin",
    group: "Workspace",
    summary: "Unpin repositories",
    args: [{ name: "repos", required: true, summary: "repo refs (variadic)" }],
    surface: { kind: "action", action: "togglePinSelection" },
    requires: ["workspace"],
    flags: [jsonFlag("result as JSON copy")],
  },
  {
    id: "profile.save",
    path: "profile save",
    title: "Profile save",
    group: "Workspace",
    summary: "Save a named repository profile",
    args: [
      { name: "name", required: true, summary: "profile name" },
      { name: "repos", required: false, summary: "member refs (variadic)" },
    ],
    surface: { kind: "view", view: "profiles" },
    requires: ["workspace"],
    flags: [
      f("--from-pinned", "bool", "populate from pinned repos", "source: pinned toggle"),
      jsonFlag("result as JSON copy"),
    ],
  },
  {
    id: "profile.delete",
    path: "profile delete",
    title: "Profile delete",
    group: "Workspace",
    summary: "Delete a named profile",
    args: [{ name: "name", required: true, summary: "profile name" }],
    surface: { kind: "view", view: "profiles" },
    requires: ["workspace"],
    flags: [jsonFlag("result as JSON copy")],
  },
  {
    id: "workspaces",
    path: "workspaces",
    title: "Workspaces",
    group: "Workspace",
    summary: "List or remove registered workspaces",
    args: [
      { name: "action", required: false, summary: "list (default) | remove" },
      { name: "path", required: false, summary: "workspace path (remove)" },
    ],
    surface: { kind: "modal", modal: "workspaces" },
    requires: [],
    flags: [jsonFlag("listings as JSON copy")],
  },
  {
    id: "backup",
    path: "backup",
    title: "Backups",
    group: "Workspace",
    summary: "List or restore workspace snapshots",
    args: [
      { name: "action", required: false, summary: "list (default) | restore" },
      { name: "snapshot", required: false, summary: "snapshot file (restore)" },
    ],
    surface: { kind: "view", view: "trash" },
    requires: ["workspace"],
    flags: [
      f("--yes", "bool", "confirm restore (required)", "confirm dialog", { adapted: true }),
      jsonFlag("snapshots as JSON copy"),
    ],
  },
  {
    id: "root",
    path: "root",
    title: "Default root",
    group: "Workspace",
    summary: "Show, set or reset the default workspace root",
    args: [{ name: "path", required: false, summary: "new default root" }],
    surface: { kind: "modal", modal: "root" },
    requires: [],
    flags: [f("--reset", "bool", "clear the saved default root", "reset button")],
  },
  {
    id: "alias.set",
    path: "alias set",
    title: "Alias set",
    group: "Workspace",
    summary: "Set an alias for a repository",
    args: [
      { name: "alias", required: true, summary: "alias name" },
      { name: "repo", required: true, summary: "repo ref" },
    ],
    surface: { kind: "modal", modal: "alias" },
    requires: ["workspace"],
    flags: [],
  },
  {
    id: "alias.remove",
    path: "alias remove",
    title: "Alias remove",
    group: "Workspace",
    summary: "Remove a repository alias",
    args: [{ name: "alias", required: true, summary: "alias name" }],
    surface: { kind: "modal", modal: "alias" },
    requires: ["workspace"],
    flags: [],
  },
  {
    id: "alias.list",
    path: "alias list",
    title: "Alias list",
    group: "Workspace",
    summary: "List repository aliases",
    args: [],
    surface: { kind: "planned", ticket: "t13" },
    requires: ["workspace"],
    flags: [jsonFlag("aliases as JSON copy")],
  },
  {
    id: "open",
    path: "open",
    title: "Open in app",
    group: "Workspace",
    summary: "Open a repository in an editor or agent app",
    args: [
      { name: "repo", required: true, summary: "repo ref" },
      { name: "app", required: false, summary: "app name (list detected when omitted)" },
    ],
    surface: { kind: "modal", modal: "open" },
    requires: ["workspace"],
    flags: [],
  },
  {
    id: "worktree.list",
    path: "worktree list",
    title: "Worktree list",
    group: "Workspace",
    summary: "List linked worktrees of a repository",
    args: [{ name: "repo", required: true, summary: "repo ref" }],
    surface: { kind: "modal", modal: "worktree" },
    requires: ["workspace"],
    flags: [jsonFlag("worktrees as JSON copy")],
  },
  {
    id: "worktree.scan",
    path: "worktree scan",
    title: "Worktree scan",
    group: "Workspace",
    summary: "Discover linked worktrees workspace-wide",
    args: [],
    surface: { kind: "view", view: "worktree" },
    requires: ["workspace"],
    flags: [jsonFlag("worktrees as JSON copy")],
  },
  {
    id: "worktree.create",
    path: "worktree create",
    title: "Worktree create",
    group: "Workspace",
    summary: "Create a linked worktree",
    args: [
      { name: "repo", required: true, summary: "repo ref" },
      { name: "branch", required: true, summary: "branch to check out" },
      { name: "path", required: false, summary: "worktree path (default beside repo)" },
    ],
    surface: { kind: "modal", modal: "worktree" },
    requires: ["workspace"],
    flags: [
      f(
        "--new-branch",
        "bool",
        "create the branch instead of checking out",
        "new-branch checkbox",
        { short: "-b" },
      ),
      jsonFlag("result as JSON copy"),
    ],
  },
  {
    id: "worktree.remove",
    path: "worktree remove",
    title: "Worktree remove",
    group: "Workspace",
    summary: "Remove a linked worktree",
    args: [
      { name: "repo", required: true, summary: "repo ref" },
      { name: "path", required: true, summary: "worktree path" },
    ],
    surface: { kind: "modal", modal: "worktree" },
    requires: ["workspace"],
    flags: [
      f("--force", "bool", "force removal with untracked changes", "force checkbox in confirm", {
        short: "-f",
      }),
      jsonFlag("result as JSON copy"),
    ],
  },

  // ---- search & automation ------------------------------------------------
  {
    id: "search-code",
    path: "search-code",
    title: "Code Search",
    group: "Search",
    summary: "Symbol, text or regex search across the workspace",
    args: [{ name: "pattern", required: true, summary: "symbol / text / regex pattern" }],
    surface: { kind: "view", view: "search" },
    requires: ["workspace"],
    flags: [
      f("--kind", "enum", "symbol kind filter", "kind picker", {
        values: ["function", "class", "interface", "type", "enum", "method", "const"],
        complete: "kinds",
      }),
      f("--lang", "enum", "language filter", "lang picker", {
        values: ["ts", "tsx", "js", "py", "go", "rs"],
        complete: "langs",
      }),
      f("--limit", "int", "max matches (default 50)", "stepper", { short: "-l", default: "50" }),
      f("--offline", "bool", "require cached grammars only", "offline toggle"),
      f("--rebuild", "bool", "force rebuild the symbol index", "rebuild action"),
      f("--regex", "bool", "treat pattern as regex", "mode: regex"),
      f("--text", "bool", "raw line search instead of symbols", "mode: text"),
      jsonFlag("matches as JSON copy"),
    ],
  },
  {
    id: "run",
    path: "run",
    title: "Run Console",
    group: "Search",
    summary: "Run a shell command across repositories in parallel",
    args: [{ name: "command", required: true, summary: "command and args (variadic)" }],
    surface: { kind: "view", view: "run" },
    requires: ["workspace"],
    flags: [
      f("--repo", "list", "target repositories (repeatable)", "scope: repo list editor", {
        short: "-r",
      }),
      f("--pinned", "bool", "run only in pinned repos", "scope: pinned"),
      f("--profile", "string", "run only in a named profile", "scope: profile picker"),
      f("--concurrency", "int", "parallel execution limit", "stepper", {
        short: "-c",
        default: "3",
      }),
      jsonFlag("results as JSON copy"),
    ],
  },
  {
    id: "instructions.template",
    path: "instructions template",
    title: "AGENTS.md templates",
    group: "Search",
    summary: "List, apply or clear instruction templates",
    args: [{ name: "template", required: false, summary: "node / python / monorepo" }],
    surface: { kind: "view", view: "agents" },
    requires: ["workspace"],
    flags: [f("--clear", "bool", "remove the applied template block", "clear button")],
  },
  {
    id: "instructions.export",
    path: "instructions export",
    title: "Export instructions",
    group: "Search",
    summary: "Export agent instructions to cursor/claude/copilot/agents",
    args: [],
    surface: { kind: "view", view: "agents" },
    requires: ["workspace"],
    flags: [
      f("--format", "enum", "export format", "format picker", {
        short: "-f",
        values: ["agents", "cursor", "claude", "copilot"],
        default: "cursor",
      }),
      f("--out", "path", "custom output file", "output path field", { short: "-o" }),
      jsonFlag("export result as JSON copy"),
    ],
  },
  {
    id: "changelog",
    path: "changelog",
    title: "Changelog",
    group: "Search",
    summary: "Synthesize commits into a changelog",
    args: [],
    surface: { kind: "view", view: "changelog" },
    requires: ["workspace"],
    flags: [
      f("--since", "string", "git log since expression", "field", { default: "7 days ago" }),
      f("--until", "string", "git log until expression", "field"),
      f("--author", "string", "filter by author", "field"),
      f("--repo", "string", "filter to one repository", "repo picker"),
      f("--format", "enum", "markdown or json", "preview + copy-as", {
        values: ["markdown", "json"],
        default: "markdown",
      }),
      f("--out", "path", "write to a file instead of stdout", "write-file action", { short: "-o" }),
      f("--json", "bool", "alias for --format json", "copy-as JSON", { adapted: true }),
    ],
  },

  // ---- platform -----------------------------------------------------------
  {
    id: "auth.login",
    path: "auth login",
    title: "Login",
    group: "Platform",
    summary: "Authenticate via the OAuth device flow",
    args: [],
    surface: { kind: "planned", ticket: "t10" },
    requires: ["auth"],
    flags: [
      f(
        "--base-url",
        "url",
        "GitHub Enterprise endpoint (persisted)",
        "Settings › connection field",
      ),
    ],
  },
  {
    id: "auth.logout",
    path: "auth logout",
    title: "Logout",
    group: "Platform",
    summary: "Log out of cached credentials",
    args: [],
    surface: { kind: "planned", ticket: "t10" },
    requires: [],
    flags: [],
  },
  {
    id: "auth.status",
    path: "auth status",
    title: "Auth status",
    group: "Platform",
    summary: "Show the current authentication method",
    args: [],
    surface: { kind: "planned", ticket: "t10" },
    requires: [],
    flags: [jsonFlag("status as JSON copy")],
  },
  {
    id: "doctor",
    path: "doctor",
    title: "Doctor",
    group: "Platform",
    summary: "Health checks for git, gh, token and workspace",
    args: [],
    surface: { kind: "action", action: "runHealthDoctorFix" },
    requires: [],
    flags: [
      f("--fix", "bool", "attempt fixes (auth login, journal resume)", "F · run doctor auto-fix"),
      jsonFlag("checks as JSON copy"),
    ],
  },
  {
    id: "stats",
    path: "stats",
    title: "Stats & health",
    group: "Platform",
    summary: "Language, category, disk and health scorecard",
    args: [],
    surface: { kind: "view", view: "stats" },
    requires: ["workspace"],
    flags: [
      f("--health", "bool", "workspace health scorecard and grade", "scorecard section"),
      jsonFlag("stats as JSON copy"),
    ],
  },
  {
    id: "completions",
    path: "completions",
    title: "Shell completions",
    group: "Platform",
    summary: "Generate shell completion scripts",
    args: [{ name: "shell", required: true, summary: "bash | zsh | fish | powershell" }],
    surface: { kind: "planned", ticket: "t10" },
    requires: [],
    flags: [],
  },

  // ---- settings & agents --------------------------------------------------
  {
    id: "config",
    path: "config",
    title: "Settings",
    group: "Settings",
    summary: "Read and write repotruck settings",
    args: [
      { name: "action", required: true, summary: "get | set | unset | list" },
      { name: "key", required: false, summary: "settings key" },
      { name: "value", required: false, summary: "value (set)" },
    ],
    surface: { kind: "view", view: "settings" },
    requires: [],
    flags: [],
  },
  {
    id: "update",
    path: "update",
    title: "Self-update",
    group: "Settings",
    summary: "Check npm for a newer release and self-update",
    args: [],
    surface: { kind: "planned", ticket: "t10" },
    requires: [],
    flags: [jsonFlag("result as JSON copy")],
  },
  {
    id: "mcp",
    path: "mcp",
    title: "MCP server",
    group: "Settings",
    summary: "Serve the workspace as an MCP server (stdio or HTTP)",
    args: [],
    surface: { kind: "view", view: "agents" },
    requires: [],
    flags: [
      f("--http", "bool", "Streamable HTTP instead of stdio", "mode selector"),
      f("--port", "int", "HTTP port", "stepper", { default: "3000" }),
      f("--host", "string", "bind address (non-localhost needs --token)", "field", {
        default: "127.0.0.1",
      }),
      f("--token", "string", "required bearer token", "generate + show"),
      f("--base-url", "url", "GitHub Enterprise API URL", "Settings › connection"),
    ],
  },

  // ---- parent hubs (no direct action; route to their family surface) -----
  {
    id: "alias",
    path: "alias",
    title: "Aliases",
    group: "Workspace",
    summary: "Manage repository aliases",
    args: [],
    surface: { kind: "planned", ticket: "t13" },
    requires: ["workspace"],
    flags: [],
  },
  {
    id: "auth",
    path: "auth",
    title: "Auth",
    group: "Platform",
    summary: "Manage GitHub authentication",
    args: [],
    surface: { kind: "planned", ticket: "t10" },
    requires: [],
    flags: [],
  },
  {
    id: "preset",
    path: "preset",
    title: "Presets",
    group: "Workspace",
    summary: "Manage layout presets",
    args: [],
    surface: { kind: "view", view: "presets" },
    requires: [],
    flags: [],
  },
  {
    id: "profile",
    path: "profile",
    title: "Profiles",
    group: "Workspace",
    summary: "Manage pinned focus and named profiles",
    args: [],
    surface: { kind: "view", view: "profiles" },
    requires: [],
    flags: [],
  },
  {
    id: "trash",
    path: "trash",
    title: "Trash",
    group: "Lifecycle",
    summary: "Inspect, restore or empty soft-deleted repositories",
    args: [],
    surface: { kind: "view", view: "trash" },
    requires: ["workspace"],
    flags: [],
  },
  {
    id: "worktree",
    path: "worktree",
    title: "Worktrees",
    group: "Workspace",
    summary: "Manage linked git worktrees",
    args: [],
    surface: { kind: "view", view: "worktree" },
    requires: ["workspace"],
    flags: [],
  },

  // ---- global flags -------------------------------------------------------
  {
    id: "__globals__",
    path: "(global flags)",
    title: "Global flags",
    group: "Global",
    summary: "Program-level options inherited by every command",
    args: [],
    surface: { kind: "view", view: "settings" },
    requires: [],
    flags: [
      f("--dir", "path", "workspace root override", "workspace switcher (w)", { short: "-d" }),
      f("--concurrency", "int", "global concurrency limit", "task steppers + settings", {
        short: "-c",
        default: "3",
      }),
      f("--verbose", "bool", "detailed diagnostic logging", "Settings toggle + expandable output"),
      f("--no-color", "bool", "disable terminal colors", "NO_COLOR (already honored)"),
    ],
  },
];

export const REGISTRY_BY_ID: ReadonlyMap<string, CommandSpec> = new Map(
  REGISTRY.map((command) => [command.id, command]),
);

export const REGISTRY_BY_PATH: ReadonlyMap<string, CommandSpec> = new Map(
  REGISTRY.map((command) => [command.path, command]),
);

/** Count of flag/arg inventory entries — the parity dashboard number. */
export function registryFlagCount(): number {
  return REGISTRY.reduce((total, command) => total + command.flags.length, 0);
}

export interface CommandDoc {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  readonly examples: readonly string[];
  readonly flags?: readonly { readonly flag: string; readonly description: string }[];
}

export interface CommandGroup {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly commands: readonly CommandDoc[];
}

// 30 top-level commands across 6 logical groups.
export const COMMAND_GROUPS: readonly CommandGroup[] = [
  {
    id: "sync-and-clone",
    title: "Sync, clone and discover",
    blurb: "Search GitHub and move repositories between GitHub and disk in bulk or one at a time.",
    commands: [
      {
        name: "sync",
        summary:
          "Clone or update repositories in bulk, without the interactive interface. Exits 1 when any repository fails.",
        usage: "repotruck sync [options]",
        examples: [
          "repotruck sync",
          "repotruck sync --scope all",
          "repotruck sync --pinned",
          "repotruck sync --profile backend",
          "repotruck sync --scope org:acme --limit 20",
          "repotruck sync -p language-first",
          "repotruck sync --depth 1 --blobless -c 5",
          "repotruck sync --stash --divergence rebase",
          "repotruck sync --watch 60",
        ],
        flags: [
          { flag: "-s, --scope <scope>", description: '"user" (default), "org:<name>", or "all"' },
          { flag: "--pinned", description: "sync only repositories pinned in the workspace" },
          {
            flag: "--profile <name>",
            description: "sync only repositories in the named workspace profile",
          },
          {
            flag: "-l, --limit <n>",
            description: "sync only the first N repositories of the scope, in API order",
          },
          {
            flag: "-c, --concurrency <n>",
            description: "parallel repositories (default 3; also settable as sync.concurrency)",
          },
          {
            flag: "--depth <n>",
            description: "shallow clones with the given commit depth (new clones only)",
          },
          {
            flag: "--blobless",
            description: "blobless partial clones, git clone --filter=blob:none (new clones only)",
          },
          {
            flag: "--stash",
            description: "stash uncommitted changes before updating, restore them afterwards",
          },
          {
            flag: "--divergence <strategy>",
            description: "ahead-of-origin repositories: fail (default), rebase, reset or skip",
          },
          {
            flag: "--include <glob>",
            description: "only sync repositories whose owner/name matches the glob",
          },
          {
            flag: "--exclude <glob>",
            description: "skip repositories whose owner/name matches the glob",
          },
          {
            flag: "--watch [seconds]",
            description:
              "keep syncing at a fixed interval (default 300s; Ctrl+C stops; never exits non-zero mid-watch)",
          },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
      {
        name: "clone",
        summary:
          "Clone a single GitHub repository (URL or owner/name) into the workspace layout; fast-forward-pulls when it already exists.",
        usage: "repotruck clone <url> [options]",
        examples: [
          "repotruck clone monalisa/api",
          "repotruck clone https://github.com/monalisa/api -p flat-by-owner",
          "repotruck clone monalisa/api --depth 1 --blobless",
        ],
        flags: [
          {
            flag: "--depth <n>",
            description: "create a shallow clone with the given commit depth",
          },
          {
            flag: "--blobless",
            description: "create a blobless partial clone (git clone --filter=blob:none)",
          },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
      {
        name: "discover",
        summary:
          "Search GitHub repositories with structured qualifiers (org, language, minimum stars, topics) and optionally clone matches straight into the workspace.",
        usage: "repotruck discover <query> [options]",
        examples: [
          "repotruck discover mcp --lang typescript --min-stars 50",
          "repotruck discover cli --org acme --topic devtools --clone",
          "repotruck discover router --include-forks --limit 10 --json",
        ],
        flags: [
          { flag: "--org <org>", description: "restrict search to a GitHub organization" },
          { flag: "--lang <language>", description: "restrict search to primary language" },
          { flag: "--min-stars <n>", description: "minimum stargazer count" },
          { flag: "--topic <topic>", description: "require repository topic (repeatable)" },
          {
            flag: "--include-archived",
            description: "include archived repositories (excluded by default)",
          },
          {
            flag: "--include-forks",
            description: "include fork repositories (excluded by default)",
          },
          {
            flag: "-l, --limit <n>",
            description: "maximum results to return (default 20, max 200)",
          },
          { flag: "--clone", description: "clone discovered repositories into the workspace" },
          { flag: "--depth <n>", description: "shallow clone commit depth when --clone is used" },
          { flag: "--blobless", description: "blobless partial clone when --clone is used" },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
    ],
  },
  {
    id: "lifecycle",
    title: "Repository lifecycle",
    blurb: "Track, untrack, soft-delete/restore, archive and inspect repository health.",
    commands: [
      {
        name: "forget",
        summary: "Stop tracking a repository; the clone stays on disk untouched.",
        usage: "repotruck forget <repo>",
        examples: ["repotruck forget monalisa/api"],
      },
      {
        name: "prune",
        summary:
          "Untrack repositories that were deleted on GitHub (or became inaccessible). Unclear answers (permission or network errors) are kept and reported, and the run exits 1. Runs the GitHub checks in parallel.",
        usage: "repotruck prune [options]",
        examples: ["repotruck prune --dry-run", "repotruck prune"],
        flags: [
          { flag: "--dry-run", description: "only list what would be pruned; change nothing" },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
      {
        name: "delete",
        summary: "Stop tracking a repository and permanently remove its directory from disk.",
        usage: "repotruck delete <repo> [options]",
        examples: ["repotruck delete monalisa/api --yes"],
        flags: [
          {
            flag: "--yes",
            description: "confirm the deletion (required; this permanently removes the directory)",
          },
        ],
      },
      {
        name: "trash",
        summary:
          "List, restore, or permanently empty soft-deleted repositories parked in <root>/.repotruck/trash.",
        usage: "repotruck trash [list|restore <selector>|empty] [options]",
        examples: [
          "repotruck trash list",
          "repotruck trash restore monalisa/api",
          "repotruck trash empty --older-than 30 --yes",
          "repotruck trash empty --yes",
        ],
        flags: [
          {
            flag: "--older-than <days>",
            description: "only delete entries trashed more than N days ago (empty)",
          },
          {
            flag: "--yes",
            description: "confirm permanent deletion from trash (required for empty)",
          },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
      {
        name: "archive",
        summary: "Archive the repository on GitHub and re-file it under the archived category.",
        usage: "repotruck archive <repo>",
        examples: ["repotruck archive monalisa/old-project"],
      },
      {
        name: "status",
        summary:
          "Show per-repository health: dirty state, ahead/behind, worktrees, category, aliases, detailed diff stats, and optional remote PR/CI checks.",
        usage: "repotruck status [options]",
        examples: [
          "repotruck status",
          "repotruck status -D",
          "repotruck status --pinned --remote",
          "repotruck status --profile backend",
          "repotruck status --filter dirty",
          "repotruck status --check",
          "repotruck status --json",
        ],
        flags: [
          {
            flag: "-D, --detail",
            description: "show detailed unpushed commits and modified files with diff stats",
          },
          {
            flag: "-f, --filter <type>",
            description: "filter repos by status: dirty, uncommitted, unpushed, unpulled, all",
          },
          { flag: "--pinned", description: "only inspect pinned repositories" },
          {
            flag: "--profile <name>",
            description: "only inspect repositories in the named profile",
          },
          {
            flag: "--remote",
            description: "fetch open PR counts and default-branch CI check state from GitHub",
          },
          {
            flag: "-c, --check",
            description: "exit non-zero if any repo has uncommitted/unpushed changes or is missing",
          },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
    ],
  },
  {
    id: "workspace",
    title: "Workspace and layout",
    blurb: "Create, move and re-file repositories; manage workspaces, profiles and aliases.",
    commands: [
      {
        name: "create",
        summary:
          "Create a new GitHub repository and register it in the workspace. Private by default.",
        usage: "repotruck create <name> [options]",
        examples: [
          'repotruck create my-app --description "side project"',
          "repotruck create cli-tool --from ./cli-tool --at tools/cli",
          "repotruck create shared-lib --org acme --public",
        ],
        flags: [
          {
            flag: "--from <dir>",
            description: "import an existing local directory (clean Git tree required)",
          },
          {
            flag: "--at <relative-path>",
            description: "place the repository at a custom workspace-relative path",
          },
          { flag: "--public / --private", description: "visibility (private is the default)" },
          { flag: "--description <text>", description: "short repository description" },
          { flag: "--org <name>", description: "create the repository inside this organization" },
        ],
      },
      {
        name: "move",
        summary:
          "Move a tracked repository to a custom path; the inventory, AGENTS.md map and aliases follow. Moved repositories are marked manually placed.",
        usage: "repotruck move <repo> <destination>",
        examples: ["repotruck move monalisa/api active/api"],
      },
      {
        name: "scan",
        summary:
          "Scan directory recursively for git repositories, detect unregistered repos, and optionally move them into preset layout.",
        usage: "repotruck scan [directory] [options]",
        examples: [
          "repotruck scan",
          "repotruck scan ~/code",
          "repotruck scan --move --dry-run",
          "repotruck scan --move",
          "repotruck scan --json",
        ],
        flags: [
          {
            flag: "-m, --move",
            description:
              "adopt and move unregistered repositories into their target preset directory",
          },
          {
            flag: "--dry-run",
            description:
              "preview planned moves for unregistered repositories without modifying files",
          },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
      {
        name: "reorganize",
        summary: "Move every tracked repository to its path for a new preset.",
        usage: "repotruck reorganize <preset> [options]",
        examples: [
          "repotruck reorganize language-first",
          "repotruck reorganize category-first --dry-run",
          "repotruck reorganize flat-by-owner --scan --keep-custom",
        ],
        flags: [
          {
            flag: "--scan",
            description: "also discover untracked Git repositories on disk and adopt them",
          },
          { flag: "--dry-run", description: "show the move plan without touching anything" },
          {
            flag: "--keep-custom",
            description: "keep manually placed (custom) repositories where they are",
          },
          {
            flag: "--resume",
            description: "resume an interrupted reorganization from its journal",
          },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
      {
        name: "preset",
        summary:
          "Manage custom directory-layout presets stored in settings.json. Segments are built from the owner, category, language and name tokens (name last), and custom presets work everywhere a built-in id is accepted.",
        usage: "repotruck preset <list|add|remove>",
        examples: [
          "repotruck preset list",
          "repotruck preset add lang-owner language owner name",
          "repotruck preset remove lang-owner",
        ],
      },
      {
        name: "profile",
        summary:
          "Manage pinned focus repositories (surfaced in AGENTS.md) and named repository profiles reusable across status, sync, and run.",
        usage: "repotruck profile <list|pin|unpin|save|delete> [options]",
        examples: [
          "repotruck profile list",
          "repotruck profile pin monalisa/api monalisa/web",
          "repotruck profile unpin monalisa/web",
          "repotruck profile save backend --from-pinned",
          "repotruck profile save core monalisa/api acme/sdk",
          "repotruck profile delete core",
        ],
        flags: [
          {
            flag: "--from-pinned",
            description: "populate the saved profile from currently pinned repositories",
          },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
      {
        name: "workspaces",
        summary:
          'List or remove registered workspaces ("list" is the default). Both print the central records file path.',
        usage: "repotruck workspaces [action] [path]",
        examples: ["repotruck workspaces", "repotruck workspaces remove ../old-workspace"],
        flags: [{ flag: "--json", description: "machine-readable JSON output" }],
      },
      {
        name: "backup",
        summary:
          "List or restore the automatic workspace snapshots kept in <root>/.repotruck/backups (5 generations). Restoring replaces the current inventory and requires --yes.",
        usage: "repotruck backup [list|restore <snapshot>]",
        examples: ["repotruck backup list", "repotruck backup restore 20261024T120000.json --yes"],
        flags: [
          {
            flag: "--yes",
            description: "confirm the restore (required; it replaces the current inventory)",
          },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
      {
        name: "root",
        summary:
          "Print, set or reset the default workspace root used when no registered workspace is found walking up.",
        usage: "repotruck root [path]",
        examples: ["repotruck root", "repotruck root ~/code", "repotruck root --reset"],
        flags: [
          {
            flag: "--reset",
            description: "clear the saved default root and return to the OS default",
          },
        ],
      },
      {
        name: "alias",
        summary:
          "Manage short names for repositories, usable with open. Aliases survive moves and reorganize, and show up in AGENTS.md.",
        usage: "repotruck alias <set|remove|list>",
        examples: [
          "repotruck alias set api monalisa/api",
          "repotruck alias list",
          "repotruck alias remove api",
        ],
      },
      {
        name: "open",
        summary:
          "Open a tracked repository (alias, relative path or owner/name) in an app; omit the app to list what is detected. Builtins: claude, codex, gemini, aider, vscode, cursor, custom entries in apps.json, or any bare PATH executable.",
        usage: "repotruck open <repo> [app]",
        examples: [
          "repotruck open api claude",
          "repotruck open monalisa/api vscode",
          "repotruck open api",
        ],
      },
    ],
  },
  {
    id: "search-and-run",
    title: "Code search and automation",
    blurb: "Tree-sitter symbol indexing, parallel command execution, and workspace instructions.",
    commands: [
      {
        name: "search-code",
        summary:
          "Search an indexed symbol name (or raw source lines with --text) across every tracked repository. Uses fast git ls-files discovery with .gitignore fallback.",
        usage: "repotruck search-code <pattern> [options]",
        examples: [
          "repotruck search-code UserService",
          "repotruck search-code handleAuth --kind function",
          "repotruck search-code 'TODO:' --text",
          "repotruck search-code 'useEffect\\(' --regex",
        ],
        flags: [
          {
            flag: "--kind <kind>",
            description: "filter symbols: function, class, interface, type, enum, method, const",
          },
          {
            flag: "--lang <lang>",
            description: "filter by language (ts, tsx, js, py, go, rs, or aliases)",
          },
          { flag: "-l, --limit <n>", description: "maximum number of matches (default 50)" },
          {
            flag: "--offline",
            description: "disable automatic grammar downloads and require local/cached grammars",
          },
          { flag: "--rebuild", description: "force rebuild of the tree-sitter symbol index" },
          {
            flag: "--regex",
            description: "treat the pattern as a case-insensitive regular expression",
          },
          {
            flag: "--text",
            description: "search raw source lines across tracked repositories instead of symbols",
          },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
      {
        name: "run",
        summary:
          "Run an arbitrary shell command in parallel across every tracked (or selected) repository and report per-repository exit codes and durations.",
        usage: "repotruck run <command...> [options]",
        examples: [
          "repotruck run git status -s",
          "repotruck run --pinned bun test",
          "repotruck run --profile backend npm run lint",
          "repotruck run -r monalisa/api -r acme/cli npm test",
        ],
        flags: [
          {
            flag: "-r, --repo <ref>",
            description:
              "target specific repositories (repeatable; owner/name, alias, or path); without it the command runs in every tracked repository",
          },
          { flag: "--pinned", description: "run only in pinned repositories" },
          {
            flag: "--profile <name>",
            description: "run only in repositories belonging to the named profile",
          },
          { flag: "-c, --concurrency <n>", description: "parallel execution limit (default 3)" },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
      {
        name: "instructions",
        summary:
          "Manage AGENTS.md instruction templates: list them (node, python, monorepo), apply one by name, or clear the applied template block.",
        usage: "repotruck instructions template [name]",
        examples: [
          "repotruck instructions template",
          "repotruck instructions template monorepo",
          "repotruck instructions template --clear",
        ],
        flags: [
          {
            flag: "--clear",
            description: "remove the applied template block from AGENTS.md",
          },
        ],
      },
    ],
  },
  {
    id: "platform",
    title: "Authentication and diagnostics",
    blurb: "Manage authentication, system diagnostics, repository stats, and shell completions.",
    commands: [
      {
        name: "auth",
        summary:
          "Manage GitHub authentication across env token (REPOTRUCK_TOKEN), cached credentials, and GitHub CLI (gh auth).",
        usage: "repotruck auth <status|login|logout>",
        examples: ["repotruck auth status", "repotruck auth login", "repotruck auth logout"],
        flags: [
          {
            flag: "--base-url <url>",
            description: "target a GitHub Enterprise endpoint (login)",
          },
          { flag: "--json", description: "machine-readable JSON output (status)" },
        ],
      },
      {
        name: "doctor",
        summary:
          "Check system dependencies (git, gh), configuration, GitHub auth, central registry, trash directory, and workspace health. --fix starts auth login when no token is found and resumes interrupted reorganizations.",
        usage: "repotruck doctor [options]",
        examples: ["repotruck doctor", "repotruck doctor --fix"],
        flags: [
          {
            flag: "--fix",
            description:
              "start repotruck auth login when no token is found and resume interrupted reorganizations",
          },
          { flag: "--json", description: "machine-readable JSON output" },
        ],
      },
      {
        name: "stats",
        summary:
          "Display repository statistics, language distribution, category breakdown, disk usage, and stale repositories (>=180d).",
        usage: "repotruck stats [options]",
        examples: ["repotruck stats", "repotruck stats --json"],
        flags: [{ flag: "--json", description: "machine-readable JSON output" }],
      },
      {
        name: "completions",
        summary:
          "Generate shell completion scripts for bash, zsh, fish, or PowerShell with shell-specific installation instructions. Subcommands and flag values like --preset/--scope/--kind complete dynamically.",
        usage: "repotruck completions <bash|zsh|fish|powershell>",
        examples: [
          "repotruck completions bash",
          "repotruck completions zsh",
          "repotruck completions fish",
          "repotruck completions powershell",
        ],
      },
    ],
  },
  {
    id: "cli-settings",
    title: "Settings, updates and agents",
    blurb: "Persist defaults, stay current, and expose the workspace to coding agents.",
    commands: [
      {
        name: "config",
        summary:
          "Read and write repotruck settings (settings.json in the app config dir). Every row prints its value and where it comes from (settings or default).",
        usage: "repotruck config <get|set|unset|list> [key] [value]",
        examples: [
          "repotruck config list",
          "repotruck config get sync.concurrency",
          "repotruck config set sync.depth 1",
          "repotruck config unset sync.depth",
        ],
      },
      {
        name: "update",
        summary:
          "Check the npm registry for a newer release and self-update global installs (npm i -g repotruck@latest, or bun add -g repotruck@latest for bun-managed globals); npx/bunx runs get per-method guidance.",
        usage: "repotruck update [options]",
        examples: ["repotruck update", "repotruck update --json"],
        flags: [{ flag: "--json", description: "machine-readable JSON output" }],
      },
      {
        name: "mcp",
        summary:
          "Run the Model Context Protocol server on stdio or Streamable HTTP for coding agents. See the MCP guide below for client setup.",
        usage: "repotruck mcp [options]",
        examples: ["repotruck mcp", "repotruck mcp --http", "repotruck mcp --http --port 8923"],
        flags: [
          { flag: "--http", description: "serve Streamable HTTP instead of stdio" },
          { flag: "--port <n>", description: "HTTP port (default 3000)" },
          {
            flag: "--host <addr>",
            description: "bind address (default 127.0.0.1; non-localhost binds require --token)",
          },
          {
            flag: "--token <token>",
            description: "require Authorization: Bearer <token> on every HTTP request",
          },
          {
            flag: "--base-url <url>",
            description: "target a GitHub Enterprise API for the server's GitHub calls",
          },
        ],
      },
    ],
  },
];

export interface SettingRow {
  readonly key: string;
  readonly value: string;
  readonly description: string;
}

export const SETTING_ROWS: readonly SettingRow[] = [
  {
    key: "defaultRoot",
    value: "(not set)",
    description: "workspace root used when no registered workspace is found walking up",
  },
  {
    key: "github.baseUrl",
    value: "(api.github.com)",
    description: "custom GitHub Enterprise base URL",
  },
  {
    key: "theme",
    value: "default",
    description: "dashboard palette: default, light or contrast (REPOTRUCK_THEME overrides)",
  },
  {
    key: "sync.concurrency",
    value: "3",
    description: "how many repositories sync updates in parallel",
  },
  {
    key: "sync.depth",
    value: "(off)",
    description: "commit depth for shallow clones of new repositories",
  },
  {
    key: "sync.blobless",
    value: "false",
    description: "create blobless partial clones (--filter=blob:none)",
  },
  {
    key: "sync.stash",
    value: "false",
    description: "stash uncommitted changes before updating, restore afterwards",
  },
  {
    key: "sync.divergence",
    value: "fail",
    description: "strategy for repositories ahead of origin: fail, rebase, reset or skip",
  },
];

export const DIVERGENCE_ROWS: readonly { readonly strategy: string; readonly behavior: string }[] =
  [
    { strategy: "fail", behavior: "stop that repository with an error (default; sync exits 1)" },
    { strategy: "rebase", behavior: "rebase local commits on top of the fetched upstream" },
    { strategy: "reset", behavior: "discard local commits and hard-reset to upstream" },
    { strategy: "skip", behavior: "leave that repository untouched this run" },
  ];

export const GLOBAL_FLAGS: readonly { readonly flag: string; readonly description: string }[] = [
  {
    flag: "-d, --dir <root>",
    description:
      "target a workspace explicitly; otherwise the nearest registered root walking up wins, then the configured default root, then the OS default",
  },
  {
    flag: "-p, --preset <id>",
    description:
      "preset for the target layout (sync and clone): categorized, flat-by-owner, topic-focused, language-first, category-first, language-categorized, flat, category-flat, language-flat, etc.",
  },
  {
    flag: "--base-url <url>",
    description: "custom GitHub Enterprise API URL (overrides github.baseUrl setting)",
  },
  {
    flag: "-c, --concurrency <n>",
    description: "global concurrency limit for bulk git operations (default 3)",
  },
  { flag: "--verbose", description: "enable detailed diagnostic logging" },
  { flag: "--no-color", description: "disable terminal color output" },
  { flag: "--json", description: "output machine-readable JSON envelopes" },
];

// AUTO-GENERATED from src/commands/registry.ts — do not edit by hand.
// Regenerate with: bun run docs:gen   (drift fails CI via: bun run docs:check)

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

export const COMMAND_GROUPS: readonly CommandGroup[] = [
  {
    id: "sync-and-clone",
    title: "Sync, clone and discover",
    blurb: "Search GitHub and move repositories between GitHub and disk in bulk or one at a time.",
    commands: [
      {
        name: "sync",
        summary: "Clone or update repositories in bulk",
        usage: "repotruck sync [options] | repotruck sync resolve [repo] [options]",
        examples: [
          "repotruck sync",
          "repotruck sync --scope all",
          "repotruck sync --no-gists",
          "repotruck sync --pinned",
          "repotruck sync --profile backend",
          "repotruck sync --scope org:acme --limit 20",
          "repotruck sync -p language-first",
          "repotruck sync --depth 1 --blobless -c 5",
          "repotruck sync --stash --divergence rebase",
          "repotruck sync --watch 60",
          "repotruck sync resolve monalisa/api",
          "repotruck sync resolve monalisa/api --action continue",
        ],
        flags: [
          {
            flag: "-s, --scope <scope>",
            description:
              '"user" (default), "org:<name>", or "all" (choices: user, org:<name>, all)',
          },
          {
            flag: "--pinned",
            description: "sync only pinned repositories",
          },
          {
            flag: "--profile <name>",
            description: "sync only a named profile",
          },
          {
            flag: "--limit <n>",
            description: "first N repos of the scope in API order",
          },
          {
            flag: "-c, --concurrency <n>",
            description: "parallel repositories (default: 3)",
          },
          {
            flag: "--depth <n>",
            description: "shallow clone depth (new clones only)",
          },
          {
            flag: "--blobless",
            description: "blobless partial clones",
          },
          {
            flag: "--stash",
            description: "stash uncommitted changes before update",
          },
          {
            flag: "--divergence <strategy>",
            description:
              "ahead-of-origin strategy (choices: fail, rebase, reset, skip) (default: fail)",
          },
          {
            flag: "--include <glob>",
            description: "only repos matching glob",
          },
          {
            flag: "--exclude <glob>",
            description: "skip repos matching glob",
          },
          {
            flag: "--watch [seconds]",
            description: "keep syncing every N seconds (default 300)",
          },
          {
            flag: "--base-url <url>",
            description: "GitHub Enterprise API URL",
          },
          {
            flag: "-p, --preset <id>",
            description: "target layout preset",
          },
          {
            flag: "--no-gists",
            description: "exclude Gists from workspace sync",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
          {
            flag: "--action <action>",
            description: "execute resolution (choices: continue, abort)",
          },
        ],
      },
      {
        name: "clone",
        summary: "Clone or update a single repository into the layout",
        usage: "repotruck clone <url> [options]",
        examples: [
          "repotruck clone monalisa/api",
          "repotruck clone https://github.com/monalisa/api -p flat-by-owner",
          "repotruck clone monalisa/api --depth 1 --blobless",
          "repotruck clone monalisa/api --sparse packages/core packages/utils",
        ],
        flags: [
          {
            flag: "-p, --preset <id>",
            description: "layout preset",
          },
          {
            flag: "--depth <n>",
            description: "shallow clone depth",
          },
          {
            flag: "--blobless",
            description: "blobless partial clone",
          },
          {
            flag: "--sparse <dirs...>",
            description: "sparse checkout paths",
          },
          {
            flag: "--base-url <url>",
            description: "GitHub Enterprise API URL",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "discover",
        summary: "Search GitHub with qualifiers and optionally clone matches",
        usage: "repotruck discover <query> [options]",
        examples: [
          "repotruck discover mcp --lang typescript --min-stars 50",
          "repotruck discover cli --org acme --topic devtools --clone",
          "repotruck discover router --include-forks --limit 10 --json",
        ],
        flags: [
          {
            flag: "--org <name>",
            description: "restrict to an organization",
          },
          {
            flag: "--lang <language>",
            description: "restrict primary language",
          },
          {
            flag: "--min-stars <n>",
            description: "minimum stars",
          },
          {
            flag: "--topic <topic>",
            description: "required topics (repeatable)",
          },
          {
            flag: "--include-archived",
            description: "include archived repos",
          },
          {
            flag: "--include-forks",
            description: "include forks",
          },
          {
            flag: "-l, --limit <n>",
            description: "max results (default 20, cap 200)",
          },
          {
            flag: "--clone",
            description: "clone matches into the workspace",
          },
          {
            flag: "--depth <n>",
            description: "shallow depth when cloning",
          },
          {
            flag: "--blobless",
            description: "blobless when cloning",
          },
          {
            flag: "-p, --preset <id>",
            description: "layout preset",
          },
          {
            flag: "--base-url <url>",
            description: "GitHub Enterprise API URL",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
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
        summary: "Stop tracking; the clone stays on disk",
        usage: "repotruck forget <repo>",
        examples: ["repotruck forget monalisa/api"],
      },
      {
        name: "prune",
        summary: "Untrack repositories deleted on GitHub",
        usage: "repotruck prune [options]",
        examples: ["repotruck prune --dry-run", "repotruck prune"],
        flags: [
          {
            flag: "--dry-run",
            description: "only list what would be pruned",
          },
          {
            flag: "--base-url <url>",
            description: "GitHub Enterprise API URL",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "delete",
        summary: "Untrack and remove the repository directory",
        usage: "repotruck delete <repo> [options]",
        examples: ["repotruck delete monalisa/api --yes"],
        flags: [
          {
            flag: "--yes",
            description: "confirm the deletion (required)",
          },
        ],
      },
      {
        name: "trash",
        summary: "Inspect, restore or empty soft-deleted repositories",
        usage:
          "repotruck trash [options] | repotruck trash list [options] | repotruck trash restore <selector> [options] | repotruck trash empty [options]",
        examples: [
          "repotruck trash list",
          "repotruck trash restore monalisa/api",
          "repotruck trash empty --older-than 30 --yes",
          "repotruck trash empty --yes",
        ],
        flags: [
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
          {
            flag: "--older-than <days>",
            description: "only entries older than N days",
          },
          {
            flag: "--yes",
            description: "confirm permanent removal (required)",
          },
        ],
      },
      {
        name: "archive",
        summary: "Archive on GitHub and re-file under archived/",
        usage: "repotruck archive <repo> [options]",
        examples: ["repotruck archive monalisa/old-project"],
        flags: [
          {
            flag: "--base-url <url>",
            description: "GitHub Enterprise API URL",
          },
        ],
      },
      {
        name: "status",
        summary: "Per-repository git health",
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
            description: "unpushed commits and diff stats",
          },
          {
            flag: "-f, --filter <filter>",
            description:
              "dirty / unpushed / unpulled / all (choices: dirty, uncommitted, unpushed, unpulled, all)",
          },
          {
            flag: "--pinned",
            description: "only pinned repositories",
          },
          {
            flag: "--profile <name>",
            description: "only a named profile",
          },
          {
            flag: "--remote",
            description: "open PR counts + CI check state",
          },
          {
            flag: "--check",
            description: "exit non-zero when attention needed",
          },
          {
            flag: "--base-url <url>",
            description: "GitHub Enterprise API URL",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
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
        summary: "Create a GitHub repository and register it",
        usage: "repotruck create <name> [options]",
        examples: [
          'repotruck create my-app --description "side project"',
          "repotruck create cli-tool --from ./cli-tool --at tools/cli",
          "repotruck create shared-lib --org acme --public",
        ],
        flags: [
          {
            flag: "--from <dir>",
            description: "import an existing local directory",
          },
          {
            flag: "--at <relative-path>",
            description: "custom workspace-relative path",
          },
          {
            flag: "--public",
            description: "create as public",
          },
          {
            flag: "--private",
            description: "create as private (default)",
          },
          {
            flag: "--description <text>",
            description: "short description",
          },
          {
            flag: "--org <name>",
            description: "create inside an organization",
          },
          {
            flag: "--base-url <url>",
            description: "GitHub Enterprise API URL",
          },
        ],
      },
      {
        name: "move",
        summary: "Move a repository to a custom path",
        usage: "repotruck move <repo> <path>",
        examples: ["repotruck move monalisa/api active/api"],
      },
      {
        name: "scan",
        summary: "Discover unregistered repos and adopt them",
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
            description: "adopt and move into layout",
          },
          {
            flag: "--dry-run",
            description: "preview planned moves",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "reorganize",
        summary: "Re-file every repository into a new preset",
        usage: "repotruck reorganize [preset] [options]",
        examples: [
          "repotruck reorganize language-first",
          "repotruck reorganize category-first --dry-run",
          "repotruck reorganize flat-by-owner --scan --keep-custom",
        ],
        flags: [
          {
            flag: "--scan",
            description: "also adopt untracked repos",
          },
          {
            flag: "--dry-run",
            description: "show the move plan only",
          },
          {
            flag: "--keep-custom",
            description: "keep manually placed repos",
          },
          {
            flag: "--resume",
            description: "resume from the interrupted journal",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "preset",
        summary: "Manage layout presets",
        usage:
          "repotruck preset | repotruck preset list | repotruck preset add <id> <segments...> | repotruck preset remove <id>",
        examples: [
          "repotruck preset list",
          "repotruck preset add lang-owner language owner name",
          "repotruck preset remove lang-owner",
        ],
      },
      {
        name: "profile",
        summary: "Manage pinned focus and named profiles",
        usage:
          "repotruck profile [options] | repotruck profile list [options] | repotruck profile pin <repos...> [options] | repotruck profile unpin <repos...> [options] | repotruck profile save <name> [repos...] [options] | repotruck profile delete <name> [options]",
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
            flag: "--json",
            description: "machine-readable JSON output",
          },
          {
            flag: "--from-pinned",
            description: "populate from pinned repos",
          },
        ],
      },
      {
        name: "workspaces",
        summary: "List, add, or remove registered workspaces",
        usage: "repotruck workspaces [action] [path] [options]",
        examples: [
          "repotruck workspaces",
          "repotruck workspaces add ~/code/team",
          "repotruck workspaces remove ../old-workspace",
        ],
        flags: [
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "backup",
        summary: "List or restore workspace snapshots",
        usage: "repotruck backup [action] [snapshot] [options]",
        examples: ["repotruck backup list", "repotruck backup restore 20261024T120000.json --yes"],
        flags: [
          {
            flag: "--yes",
            description: "confirm restore (required)",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "root",
        summary: "Show, set or reset the default workspace root",
        usage: "repotruck root [path] [options]",
        examples: ["repotruck root", "repotruck root ~/code", "repotruck root --reset"],
        flags: [
          {
            flag: "--reset",
            description: "clear the saved default root",
          },
        ],
      },
      {
        name: "alias",
        summary: "Manage repository aliases",
        usage:
          "repotruck alias [options] | repotruck alias set <alias> <repo> | repotruck alias remove <alias> | repotruck alias list [options]",
        examples: [
          "repotruck alias set api monalisa/api",
          "repotruck alias list",
          "repotruck alias remove api",
        ],
        flags: [
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "open",
        summary: "Open a repository in an editor or agent app",
        usage: "repotruck open <repo> [app]",
        examples: [
          "repotruck open api claude",
          "repotruck open monalisa/api vscode",
          "repotruck open api",
        ],
      },
      {
        name: "worktree",
        summary: "Manage linked git worktrees",
        usage:
          "repotruck worktree [options] | repotruck worktree list <repo> [options] | repotruck worktree scan [options] | repotruck worktree create <repo> <branch> [path] [options] | repotruck worktree remove <repo> <path> [options]",
        examples: [
          "repotruck worktree list monalisa/api",
          "repotruck worktree scan",
          "repotruck worktree create monalisa/api feat-branch",
          "repotruck worktree create monalisa/api feat-branch ./trees/feat -b",
          "repotruck worktree remove monalisa/api ./trees/feat --force",
        ],
        flags: [
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
          {
            flag: "-b, --new-branch",
            description: "create the branch instead of checking out",
          },
          {
            flag: "-f, --force",
            description: "force removal with untracked changes",
          },
        ],
      },
      {
        name: "gist",
        summary: "Browse, clone, and manage GitHub Gists",
        usage:
          "repotruck gist [options] | repotruck gist list [options] | repotruck gist show <ref> [options] | repotruck gist clone <ref> [options] | repotruck gist sync [refs...] [options] | repotruck gist open <ref> <app> [options] | repotruck gist create [options] | repotruck gist edit <ref> [options] | repotruck gist push <ref> [options] | repotruck gist delete <ref> [options]",
        examples: [
          "repotruck gist list --tracked",
          "repotruck gist show <gist-id> --file notes.md",
          "repotruck gist clone <gist-url>",
          "repotruck gist sync",
          "repotruck gist open <gist-id> vscode",
          "repotruck gist create --file notes.md draft.md",
          "repotruck gist edit <gist-id> --file draft.md",
          "repotruck gist push <gist-id>",
          "repotruck gist delete <gist-id> --yes",
        ],
        flags: [
          {
            flag: "--tracked",
            description: "list the tracked inventory offline",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
          {
            flag: "--file <file>",
            description: "print one text file",
          },
          {
            flag: "--description <text>",
            description: "Gist description",
          },
          {
            flag: "--public",
            description: "publish publicly (default: secret)",
          },
          {
            flag: "--rename <rename>",
            description: "rename files using old=new pairs",
          },
          {
            flag: "--remove <remove>",
            description: "remove files by name",
          },
          {
            flag: "--expect-version <expect-version>",
            description: "require a version from gist show",
          },
          {
            flag: "--yes",
            description: "confirm remote deletion and keep local files",
          },
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
        summary: "Symbol, text or regex search across the workspace",
        usage: "repotruck search-code <pattern> [options]",
        examples: [
          "repotruck search-code UserService",
          "repotruck search-code handleAuth --kind function",
          "repotruck search-code 'TODO:' --text",
          "repotruck search-code 'useEffect\\\\(' --regex",
        ],
        flags: [
          {
            flag: "--kind <kind>",
            description:
              "symbol kind filter (choices: function, class, interface, type, enum, method, const)",
          },
          {
            flag: "--lang <language>",
            description: "language filter (choices: ts, tsx, js, py, go, rs)",
          },
          {
            flag: "-l, --limit <number>",
            description: "max matches (default 50)",
          },
          {
            flag: "--offline",
            description: "require cached grammars only",
          },
          {
            flag: "--rebuild",
            description: "force rebuild the symbol index",
          },
          {
            flag: "--regex",
            description: "treat pattern as regex",
          },
          {
            flag: "--text",
            description: "raw line search instead of symbols",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "run",
        summary: "Run a shell command across repositories in parallel",
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
            description: "target repositories (repeatable)",
          },
          {
            flag: "--pinned",
            description: "run only in pinned repos",
          },
          {
            flag: "--profile <name>",
            description: "run only in a named profile",
          },
          {
            flag: "-c, --concurrency <number>",
            description: "parallel execution limit (default: 3)",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "instructions",
        summary: "Manage workspace agent instructions",
        usage:
          "repotruck instructions [options] | repotruck instructions template [template] [options] | repotruck instructions export [options]",
        examples: [
          "repotruck instructions template",
          "repotruck instructions template monorepo",
          "repotruck instructions template --clear",
          "repotruck instructions export --format cursor",
          "repotruck instructions export --format claude --out CLAUDE.md",
        ],
        flags: [
          {
            flag: "--clear",
            description: "remove the applied template block",
          },
          {
            flag: "-f, --format <fmt>",
            description:
              "export format (choices: agents, cursor, claude, copilot) (default: cursor)",
          },
          {
            flag: "-o, --out <file>",
            description: "custom output file",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "changelog",
        summary: "Synthesize commits into a changelog",
        usage: "repotruck changelog [options]",
        examples: [
          "repotruck changelog",
          "repotruck changelog --since '14 days ago'",
          "repotruck changelog --author monalisa --format json",
          "repotruck changelog --repo monalisa/api -o CHANGELOG.md",
        ],
        flags: [
          {
            flag: "--since <duration>",
            description: "git log since expression (default: 7 days ago)",
          },
          {
            flag: "--until <duration>",
            description: "git log until expression",
          },
          {
            flag: "--author <author>",
            description: "filter by author",
          },
          {
            flag: "--repo <ref>",
            description: "filter to one repository",
          },
          {
            flag: "--format <fmt>",
            description: "markdown or json (choices: markdown, json) (default: markdown)",
          },
          {
            flag: "-o, --out <file>",
            description: "write to a file instead of stdout",
          },
          {
            flag: "--json",
            description: "alias for --format json",
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
        name: "about",
        summary: "Application description and GitHub project link",
        usage: "repotruck about",
        examples: ["repotruck --about", "repotruck about"],
      },
      {
        name: "auth",
        summary: "Manage GitHub authentication",
        usage:
          "repotruck auth [options] | repotruck auth login [options] | repotruck auth logout | repotruck auth status [options]",
        examples: ["repotruck auth status", "repotruck auth login", "repotruck auth logout"],
        flags: [
          {
            flag: "--base-url <url>",
            description: "GitHub Enterprise endpoint (persisted)",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "doctor",
        summary: "Health checks for git, gh, token and workspace",
        usage: "repotruck doctor [options]",
        examples: ["repotruck doctor", "repotruck doctor --fix"],
        flags: [
          {
            flag: "--fix",
            description: "apply inventory repairs, recover unfinished moves, and offer login",
          },
          {
            flag: "--dir <root>",
            description: "check and fix inventory in this workspace",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "stats",
        summary: "Language, category, disk and health scorecard",
        usage: "repotruck stats [options]",
        examples: ["repotruck stats", "repotruck stats --json"],
        flags: [
          {
            flag: "--health",
            description: "workspace health scorecard and grade",
          },
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "completions",
        summary: "Generate shell completion scripts",
        usage: "repotruck completions <shell>",
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
        summary: "Read and write repotruck settings",
        usage: "repotruck config <action> [key] [value]",
        examples: [
          "repotruck config list",
          "repotruck config get sync.concurrency",
          "repotruck config set sync.depth 1",
          "repotruck config unset sync.depth",
        ],
      },
      {
        name: "update",
        summary: "Check npm for a newer release and self-update",
        usage: "repotruck update [options]",
        examples: ["repotruck update", "repotruck update --json"],
        flags: [
          {
            flag: "--json",
            description: "machine-readable JSON output",
          },
        ],
      },
      {
        name: "mcp",
        summary: "Serve the workspace as an MCP server (stdio or HTTP)",
        usage: "repotruck mcp [options]",
        examples: ["repotruck mcp", "repotruck mcp --http", "repotruck mcp --http --port 8923"],
        flags: [
          {
            flag: "--http",
            description: "Streamable HTTP instead of stdio",
          },
          {
            flag: "--port <number>",
            description: "HTTP port (default: 3000)",
          },
          {
            flag: "--host <hostname>",
            description: "bind address (non-localhost needs --token) (default: 127.0.0.1)",
          },
          {
            flag: "--token <token>",
            description: "required bearer token",
          },
          {
            flag: "--base-url <url>",
            description: "GitHub Enterprise API URL",
          },
        ],
      },
    ],
  },
];

export const GLOBAL_FLAGS: readonly { flag: string; description: string }[] = [
  {
    flag: "--about",
    description: "application description and GitHub link",
  },
  {
    flag: "-d, --dir <root>",
    description: "workspace root override",
  },
  {
    flag: "-c, --concurrency <number>",
    description: "global concurrency limit (default: 3)",
  },
  {
    flag: "--verbose",
    description: "detailed diagnostic logging",
  },
  {
    flag: "--no-color",
    description: "disable terminal colors",
  },
];

# repotruck

[![npm version](https://img.shields.io/npm/v/repotruck.svg)](https://www.npmjs.com/package/repotruck)
[![npm downloads](https://img.shields.io/npm/dm/repotruck.svg)](https://www.npmjs.com/package/repotruck)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Clone and mirror your GitHub repositories into organized local directory layouts, with an `AGENTS.md` workspace map and a built-in MCP server for coding agents.

## Overview

repotruck bulk-clones your GitHub repositories into a predictable directory layout, keeps them updated with fast-forward pulls, and writes an `AGENTS.md` map so coding agents can navigate the workspace. It remembers every workspace it has touched, lets you move repositories into custom paths without breaking its memory, re-files everything when you switch presets, and can create brand-new repositories on GitHub — fresh or imported from a local directory — directly into their target layout. It also ships a Model Context Protocol (MCP) server (`repotruck mcp`) so MCP-capable agents (Claude Code, Cursor, Copilot, …) can drive the whole workspace — discover, search, sync, clone, create, move, reorganize — as native tools.

## Requirements

- Runtime: Node.js >= 20 for the CLI commands; Node.js >= 26.4 or Bun >= 1.3.14 for the interactive dashboard.
- [git](https://git-scm.com) on your `PATH` (clone, pull, move and create all drive git).
- A GitHub account with repositories (user and/or organization), or a GitHub Enterprise instance.
- Optional: the [GitHub CLI](https://cli.github.com) (`gh`) for the easiest authentication path.

## Install

Published on [npm](https://www.npmjs.com/package/repotruck):

```bash
npx repotruck
bunx repotruck
npm i -g repotruck
```

## Quickstart

```bash
mkdir my-workspace && cd my-workspace
gh auth login
repotruck sync
```

- The first sync outside any workspace creates a new workspace at the default root (see [Workspace memory](#workspace-memory)): `AGENTS.md`, one directory per repository laid out by the active preset (default: `categorized`), and a record for the workspace in the central `repotruck.json` kept in the app config dir. Running inside an existing workspace (a registered workspace root above the current directory) keeps syncing that workspace.
- Authentication is resolved automatically: `REPOTRUCK_TOKEN` first, then `gh`, then a cached device-flow token.
- Re-running `repotruck sync` later fast-forward-pulls every tracked repository (`[pulling]` lines) instead of cloning.
- Prefer a visual overview? Run `repotruck` with no arguments to open the interactive dashboard (requires the dashboard runtime above).

## Commands

| Command | Flags | What it does |
| --- | --- | --- |
| `repotruck clone <url>` | `-d, --dir <root>`, `-p, --preset <id>`, `--depth <n>`, `--blobless`, `--base-url <url>`, `--json` | Clones a single repository (URL or `owner/name`) into the workspace layout; fast-forward-pulls if the destination already exists. |
| `repotruck create <name>` | `--from <dir>`, `--at <relative-path>`, `--public`, `--private`, `--description <text>`, `--org <name>`, `-d, --dir <root>`, `--base-url <url>` | Creates the repository on GitHub and registers it locally. `--from` imports an existing local directory (a Git repository must have a clean tree); `--at` places it at a custom path; visibility defaults to private unless `--public` is passed (`--public` and `--private` are mutually exclusive). |
| `repotruck sync` | `-d, --dir <root>`, `-p, --preset <id>`, `-s, --scope <scope>`, `-l, --limit <n>`, `-c, --concurrency <n>`, `--depth <n>`, `--blobless`, `--stash`, `--divergence <strategy>`, `--base-url <url>`, `--include <glob>`, `--exclude <glob>`, `--watch [seconds]`, `--json` | Bulk clone/update without the dashboard. `--scope` is `user`, `org:<name>`, or `all`. `--include`/`--exclude` filter repositories before `--limit`. `--watch` keeps syncing at a fixed interval (default 300s; Ctrl+C stops) and never exits non-zero mid-watch. Exits 1 if any repository failed. `--divergence` decides what happens to repositories with local commits ahead of origin. |
| `repotruck reorganize <preset>` | `--scan`, `--dry-run`, `--keep-custom`, `-d, --dir <root>`, `--json` | Moves every tracked repository to its path for a new preset (built-in or custom — see [Custom presets](#custom-presets)). `--scan` also discovers untracked Git repositories on disk and adopts them; `--dry-run` prints the plan without touching anything; `--keep-custom` leaves manually placed repositories where they are. |
| `repotruck move <owner/name> <relative-path>` | `-d, --dir <root>` | Moves a tracked repository to a custom path and marks it as manually placed; refuses to overwrite an occupied destination; moving a repository to its current path is a no-op. |
| `repotruck forget <repo>` | `-d, --dir <root>` | Stops tracking a repository (`owner/name`, alias, or relative path) and removes its aliases; the clone stays on disk untouched. |
| `repotruck prune` | `--dry-run`, `-d, --dir <root>`, `--base-url <url>`, `--json` | Untracks repositories that GitHub answers with 404 (deleted or inaccessible); their aliases are removed too. Repositories with unclear answers (permission errors, network failures) are kept and reported, and the run exits 1. `--dry-run` only lists. See [What prune considers gone](#what-prune-considers-gone). |
| `repotruck delete <repo>` | `--yes`, `-d, --dir <root>` | Like `forget` (untrack, remove aliases), but also removes the repository directory from disk (the CLI removes it permanently; the dashboard parks it in `.repotruck/trash` so `z` can undo). Requires `--yes`; refuses to delete the workspace root itself. |
| `repotruck archive <repo>` | `-d, --dir <root>`, `--base-url <url>` | Archives the repository on GitHub and re-files it under the `archived` category. If the local move fails, re-running the command completes it. |
| `repotruck status` | `-d, --dir <root>`, `--json` | Per-repository health report: dirty/clean, ahead/behind (or `no upstream`), `MISSING on disk`, `not a git repository`, category, custom mark, aliases — plus workspace last sync. |
| `repotruck workspaces [list\|remove <path>]` | `--json` | Lists registered workspaces (sorted by last use, missing directories flagged) or removes one from the registry. |
| `repotruck root [path]` | `--reset` | With no arguments prints the effective default root and whether a settings override is set. With a path, sets the default root. `--reset` clears the override. |
| `repotruck config <action> [key] [value]` | — | Reads and writes settings: `config get <key>`, `config set <key> <value>`, `config unset <key>`, `config list`. Keys: `defaultRoot`, `sync.concurrency`, `sync.depth`, `sync.blobless`, `sync.stash`, `sync.divergence`, `github.baseUrl`. |
| `repotruck preset <list\|add\|remove>` | — | Manages custom directory-layout presets stored in settings.json (see [Custom presets](#custom-presets)). `preset add <id> <segments...>` defines one, `preset remove <id>` deletes it, `preset list` shows built-ins and custom presets. |
| `repotruck backup [list\|restore <snapshot>]` | `-d, --dir <root>`, `--yes`, `--json` | Lists the automatic workspace snapshots in `<root>/.repotruck/backups`, or restores one (`--yes` required; it replaces the current inventory). |
| `repotruck auth <login\|logout\|status>` | `--base-url <url>` (login), `--json` (status) | Manages GitHub authentication. `login` initiates OAuth device flow (or reports existing env token); `logout` removes cached credentials; `status` reports the active authentication source. |
| `repotruck doctor` | `--json`, `--fix` | Runs diagnostic health checks on git, gh CLI, token authentication, configuration, and workspace roots. `--fix` starts `repotruck auth login` when no token is found. |
| `repotruck stats` | `-d, --dir <root>`, `--json` | Computes workspace metrics including category counts, language distribution, stale repositories (>180 days inactive), and disk footprint. |
| `repotruck completions <bash\|zsh\|fish\|powershell>` | — | Generates shell tab-completion scripts for bash, zsh, fish, and PowerShell. Subcommands of `alias`, `auth`, `preset`, and `instructions` are completed too, and flag values like `--preset` / `--scope` / `--kind` are completed dynamically via a hidden `repotruck __complete` helper. |
| `repotruck search-code <pattern>` | `-d, --dir <root>`, `--lang <lang>`, `--kind <kind>`, `--limit <n>`, `--rebuild`, `--regex`, `--json` | Tree-sitter powered symbol and code search across tracked repositories (respects each repo's root `.gitignore`). `--regex` treats the pattern as a case-insensitive regular expression. |
| `repotruck run <command...>` | `-d, --dir <root>`, `-r, --repo <ref>`, `-c, --concurrency <n>`, `--json` | Executes a shell command across tracked workspace repositories in parallel and reports per-repository exit codes and durations. `-r` targets specific repositories (repeatable; `owner/name`, alias, or path); without it the command runs in every tracked repository. |
| `repotruck instructions template` | `-d, --dir <root>`, `--clear` | Manages AGENTS.md instruction templates: with no name lists the templates (`node`, `python`, `monorepo`); with a name applies one; `--clear` removes the applied template block. |
| `repotruck update` | `--json` | Checks npm registry for a newer release and self-updates global installs (`npm i -g repotruck@latest`, or `bun add -g repotruck@latest` for bun-managed globals); npx/bunx runs get per-method guidance. Respects `REPOTRUCK_NO_UPDATE_CHECK`. |
| `repotruck open <repo> [app]` | `-d, --dir <root>` | Opens a tracked repository in an external app (claude, cursor, vscode, etc.); without an app argument it lists detected applications (exit 0). |
| `repotruck alias set <alias> <repo>` | `-d, --dir <root>` | Sets a short alias for a tracked repository. Target follows moves and reorganizations. |
| `repotruck alias remove <alias>` / `alias list` | `-d, --dir <root>`, `--json` (list) | Removes an alias or lists all configured aliases. |
| `repotruck mcp` | `--http`, `--port <n>`, `--host <addr>`, `--token <token>`, `--base-url <url>` | Runs the built-in Model Context Protocol server over stdio or Streamable HTTP. `--base-url` targets a GitHub Enterprise API for the server's GitHub calls. |

### Global Flags

- `-V, --version`: Prints CLI version.
- `-h, --help`: Prints usage and help text.
- `-c, --concurrency <number>`: Sets parallel worker concurrency (consumed by `sync` and `run`; other commands ignore it).
- `--verbose`: Enables verbose debug logging (sets `REPOTRUCK_VERBOSE=1`).
- `--no-color`: Disables ANSI terminal coloring (sets `NO_COLOR=1`).

Every workspace command accepts `-d, --dir <root>` (except global commands `workspaces`, `update`, `root`, `auth`, `doctor`, `completions`, `preset`, and `mcp`) to specify workspace root.

### What prune considers gone

`repotruck prune` checks every tracked repository on GitHub (in parallel, with a conditional-request cache in `github-cache.json` so unchanged repositories answer 304 without a payload; set `REPOTRUCK_NO_API_CACHE` to bypass it). An HTTP 404 answer counts as gone — the repository was deleted, or it is private and you lost access; GitHub makes the two indistinguishable, so prune reports `deleted or inaccessible` and only untracks (disk is never touched). Anything that is not a clear 404 — permission errors (403), authentication failures, or network problems after the retry window — never untracks anything: those repositories are kept, listed as `kept (…) — unclear answer`, and the run exits 1, so an unclear answer can never destroy tracking data.

## GitHub Enterprise (GHE)

repotruck natively supports GitHub Enterprise Server and GitHub AE instances alongside github.com:

- **Configuration:** Set the base URL globally via `repotruck config set github.baseUrl https://ghe.example.com/api/v3` or per command with `--base-url https://ghe.example.com/api/v3`.
- **URL Normalization:** Providing `https://ghe.example.com` automatically normalizes to `https://ghe.example.com/api/v3`. Standard `github.com` resolves to `https://api.github.com`.
- **Authentication:** `REPOTRUCK_TOKEN` takes highest precedence. Device flow authentication (`repotruck auth login --base-url <url>`) targets the configured enterprise endpoint.
- **SSH Limitation:** SSH cloning (`git@...`) is supported only for `github.com`. For GitHub Enterprise hosts, repotruck automatically clones and fetches via HTTPS using scoped `http.<origin>/.extraheader` Git authorization tokens to ensure reliable access without SSH key friction.

## Sync updates and divergence

Every sync updates each tracked repository with `git fetch --prune` first, then decides per repository:

| Repository state | Default (`--divergence fail`) | `rebase` | `reset` | `skip` |
| --- | --- | --- | --- | --- |
| Clean, up to date | nothing to do (`up to date`) | same | same | same |
| Behind only (no local commits) | fast-forward pull (`updated`) | same | same | same |
| Local commits ahead only | fails the repository with guidance | rebases local commits onto origin | **discards local commits** (`reset --hard`) | leaves the repository untouched, reported as skipped |
| Diverged (ahead and behind) | fails the repository with guidance | rebases local commits onto origin | **discards local commits** (`reset --hard`) | leaves the repository untouched, reported as skipped |
| Dirty worktree | fails the repository (`dirty worktree`) unless `--stash` is set | same; with `--stash`, changes are stashed first and restored afterwards | same | same |

`--stash` stashes uncommitted changes before the update and pops the stash afterwards; if the pop conflicts, the repository fails with the git error. Skipped repositories print `[skipped] owner/name (ahead N — divergence skip)` and never make the run exit non-zero; only failed repositories do.

## Presets

Directories follow `<owner>/<category>/<repo>`-style layouts. Repositories that are not yours (not your login and not one of your active organizations) are always placed under a `community/` prefix — in every preset. Categories are `source`, `forks`, or `archived` (archived wins over fork). In `topic-focused`, `language-first` and `language-categorized`, the language segment is the repository's primary language, or `other` when unknown.

| Preset | Your repository | Community repository |
| --- | --- | --- |
| `categorized` | `monalisa/source/api` | `community/acme/source/api` |
| `flat-by-owner` | `monalisa/api` | `community/acme/api` |
| `topic-focused` | `monalisa/TypeScript/web` | `community/acme/Go/service` |
| `language-first` | `TypeScript/monalisa/api` | `community/Go/acme/service` |
| `category-first` | `source/monalisa/api` | `community/forks/acme/left-pad` |
| `language-categorized` | `monalisa/source/TypeScript/api` | `community/acme/forks/Go/cli` |
| `flat` | `api` | `community/service` |
| `category-flat` | `source/api` | `community/forks/left-pad` |
| `language-flat` | `TypeScript/api` | `community/Go/service` |
| `category-language` | `source/TypeScript/api` | `community/forks/JavaScript/left-pad` |
| `language-category` | `TypeScript/source/api` | `community/Go/source/service` |
| `owner-language-category` | `monalisa/TypeScript/source/api` | `community/acme/Go/source/service` |
| `category-owner-language` | `source/monalisa/TypeScript/api` | `community/forks/acme/JavaScript/left-pad` |
| `category-language-owner` | `source/TypeScript/monalisa/api` | `community/source/Go/acme/service` |
| `language-owner-category` | `TypeScript/monalisa/source/api` | `community/Go/acme/source/service` |
| `language-category-owner` | `TypeScript/source/monalisa/api` | `community/Go/source/acme/service` |

Archived and forked repositories use their category segment in presets that include category: `monalisa/archived/old-project`, `forks/monalisa/left-pad` or `source/TypeScript/monalisa/api`. Presets with a language segment keep it for archived and forked repositories too, and use `other` when the language is unknown: `monalisa/other/unknown-lang`.

Switch layouts any time with `repotruck reorganize <preset>` (add `--dry-run` to preview, `--keep-custom` to spare manually placed repositories, `--scan` to also adopt strays found on disk).

### Custom presets

You can define your own layouts from four segment tokens — `owner`, `category`, `language`, `name` — where `name` must come last and the community prefix still applies to repositories that are not yours:

```bash
repotruck preset add lang-owner language owner name
repotruck reorganize lang-owner --dry-run
```

This stores the preset in `settings.json` (`presets: { "lang-owner": { "segments": ["language", "owner", "name"] } }`) and makes it usable everywhere a built-in preset id is accepted: `sync -p`, `clone -p`, `reorganize`, the dashboard's reorganize preview, and the MCP tools. `repotruck preset list` shows built-ins plus your customs; `repotruck preset remove <id>` deletes one. Segment order is free (1–4 distinct tokens ending in `name`), so `repotruck preset add custom-flat name` gives you a custom single-level workspace with community repos still grouped under `community/`.

## Workspace memory

All workspace records live in one central `repotruck.json` in the app config dir (`<appConfigDir>/repotruck.json` — it never sits inside your workspaces). Each entry remembers the workspace's absolute root, preset, last sync, last use, aliases and the full repository inventory, so repotruck can see and recall every workspace it has ever written. The workspace directories themselves hold only `AGENTS.md` and your repositories. The dashboard's `[w] Workspaces` picker (and `repotruck workspaces list`) reads this file to let you jump between workspaces; `repotruck workspaces remove <path>` forgets one.

Root resolution, used by every workspace command:

1. `-d, --dir <root>` when given;
2. otherwise the nearest registered workspace root found walking up from the current directory (running inside an existing workspace still binds to it);
3. otherwise the configured default root, when one is set with `repotruck root <path>` (persisted as `defaultRoot` in `settings.json` inside the app config dir; an invalid stored value is ignored);
4. otherwise the OS default root:

| Platform | Default root |
| --- | --- |
| Windows | `%USERPROFILE%\repotruck` |
| macOS | `$HOME/repotruck` |
| Linux | `$HOME/repotruck` |

The current directory is never turned into a workspace implicitly: with no `-d`, no walk-up match and no override, bulk commands land in the OS default root (creating it on first write). `move` and `reorganize` still require an existing workspace and fail with a clear error when the resolved root has no record in the central `repotruck.json`. Manually moved repositories are flagged `custom: true`; `reorganize` skips them with `--keep-custom` and re-files them (clearing the flag) by default.

The config directory follows your platform convention and `REPOTRUCK_CONFIG_DIR` (see [Environment variables](#environment-variables)): `%APPDATA%\repotruck` on Windows, `~/Library/Application Support/repotruck` on macOS, and `$XDG_CONFIG_HOME/repotruck` or `~/.config/repotruck` on Linux. Workspaces created by older releases stored their inventory in a `repotruck.json` inside the workspace root; such legacy files are imported into the central file and removed on first use.

## Backups

repotruck maintains automatic backup safeguards for its persistent state:
- If `repotruck.json` is corrupted or unreadable when loaded, it is automatically preserved as `repotruck.json.bak` before any operation can overwrite it.
- Every workspace save first writes a timestamped snapshot of the previous state into `<root>/.repotruck/backups/` (5 generations kept).
- `repotruck backup list` shows the snapshots for a workspace and `repotruck backup restore <snapshot> --yes` restores one, replacing the current inventory.

## Settings

`settings.json` in the app config dir keeps your defaults. CLI flags always win over settings; unset keys fall back to built-in defaults.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `defaultRoot` | absolute path | OS default | Default workspace root (also written by `repotruck root <path>`). |
| `sync.concurrency` | positive integer | `3` | Parallel repository updates for `repotruck sync` (`-c, --concurrency` overrides). |
| `sync.depth` | positive integer | off | Shallow clones (`--depth`) for new clones only. |
| `sync.blobless` | boolean | `false` | Blobless partial clones (`--filter=blob:none`) for new clones only. |
| `sync.stash` | boolean | `false` | Stash dirty worktrees before updating and restore afterwards. |
| `sync.divergence` | `fail`/`rebase`/`reset`/`skip` | `fail` | What to do with repositories that have local commits ahead of origin (see the table above). |
| `github.baseUrl` | url | `https://api.github.com` | Base URL for GitHub API requests (GHE endpoint). |
| `theme` | `default`/`light`/`contrast` | `default` | Dashboard palette (`REPOTRUCK_THEME` overrides; takes effect on the next dashboard start). |

Read and write them with `repotruck config get <key>`, `repotruck config set <key> <value>`, or see everything with `repotruck config list`.

## AGENTS.md

Every workspace root contains an `AGENTS.md` that tells coding agents what they are looking at. It starts with an auto-generated marker and is rewritten on every sync, clone, move, create and reorganize — do not edit it by hand. Sections:

- **Workspace Metadata** — active preset, last sync time, repository counts (internal vs. community).
- **Internal Projects** — your repositories with their relative paths.
- **Community Repositories (community/)** — external repositories with their paths, marked archived/fork and language.
- **Agent Rules** — each directory is an independent Git project, global searches should exclude `.git/`, `node_modules/`, `dist/`, community repositories are read-only references, and agents should prefer the repotruck MCP tools (see [MCP server](#mcp-server)) or the CLI for workspace navigation and updates.
- **Custom Instructions** — a preserved block delimited by `<!-- repotruck:custom-instructions begin (this section is preserved verbatim on every rewrite) -->` and `<!-- repotruck:custom-instructions end -->`. Hand-edit anything between the two markers and every rewrite (sync, clone, move, create, reorganize) keeps your text byte-for-byte while regenerating the rest of the file. Fresh workspaces get a placeholder inviting you to add instructions.
- Aliased repositories show an `(alias: x)` badge on their entry line.

## MCP server

repotruck ships a built-in [Model Context Protocol](https://modelcontextprotocol.io) server: `repotruck mcp` speaks MCP over stdio and exposes the whole workspace as agent-friendly tools — discovery, listing, search, sync, clone, create, move, reorganize, lifecycle (forget/delete/prune/status/archive/open), aliases, run/stats/doctor — plus resources (AGENTS.md, inventory, tree) and prompts. Connect it once and your agent can find a workspace, resolve `owner/name` to an absolute path, read the AGENTS.md map, and clone or reorganize repositories without shelling out.

### Transports

stdio (default) — one process, one client:

```bash
repotruck mcp
```

Streamable HTTP (opt-in, either/or — a single process serves stdio *or* HTTP, never both):

```bash
repotruck mcp --http                     # 127.0.0.1:3000, localhost-only
repotruck mcp --http --port 8923         # custom port
repotruck mcp --http --host 0.0.0.0 --token <value>   # non-localhost bind, token required
```

- `--port` (default `3000`) and `--host` (default `127.0.0.1`) control the bind address.
- A non-localhost `--host` refuses to start without `--token`: every request must then carry `Authorization: Bearer <value>`, otherwise the server answers `401`.
- On localhost without a token the server applies the MCP SDK's DNS-rebinding guards (non-localhost `Host` or `Origin` headers are rejected with `403`).
- The HTTP leg is stateless (no `mcp-session-id`), which matches the workspace-files nature of repotruck state; long sync/clone calls stream `notifications/progress` over SSE while they run.
- `--base-url <url>` points the server's GitHub API calls at a GitHub Enterprise instance (same normalization as the CLI's `--base-url`).
- The HTTP adapter comes from `@modelcontextprotocol/node`, pinned at `2.1.1` while `@modelcontextprotocol/server` is on the 2.3.x line — the packages version independently (peer range `^2.3.0` accepts it and they interoperate); the pin avoids silent drift between the two.

### Connect your client

Claude Code (one-liner):

```bash
claude mcp add repotruck -- repotruck mcp
```

Or any MCP client that reads an `mcpServers` config (Cursor `~/.cursor/mcp.json`, VS Code `.vscode/mcp.json`, Claude Code `.mcp.json`, …):

```json
{
  "mcpServers": {
    "repotruck": {
      "command": "npx",
      "args": ["-y", "repotruck", "mcp"]
    }
  }
}
```

Bun users can swap `"command": "npx", "args": ["-y", "repotruck", "mcp"]` for `"command": "bunx", "args": ["repotruck", "mcp"]`; global installs use `"command": "repotruck", "args": ["mcp"]` directly. HTTP-capable clients can point at `http://127.0.0.1:3000` instead of spawning a process.

Authentication is shared with the CLI: run `gh auth login` once (recommended — the server reads the gh token non-interactively), or complete a device-flow login via the CLI first so a token is cached in `<appConfigDir>/auth.json`. The stdio server process never prints to stdout except the MCP protocol itself, so it is safe behind any stdio client.

### Tools

| Tool | What the agent can do |
| --- | --- |
| `repotruck_list_workspaces` | List every registered workspace (path, preset, counts, last sync/use, missing flag). |
| `repotruck_workspace_status` | Inspect one workspace: initialized?, preset, last sync, internal/community/custom counts, aliases, AGENTS.md presence. |
| `repotruck_list_repos` | List tracked repositories with relative + absolute paths, category, language, `custom` flag, on-disk flag; filter by internal/community, category, custom; `limit`/`offset` paginate and `totalCount` reports the full count. |
| `repotruck_search_repos` | Substring search across owner, name, path, language and alias. |
| `repotruck_resolve_repo` | Resolve an alias, relative path, or `owner/name` to its inventory entry and absolute path. |
| `repotruck_agents_md` | Read the raw AGENTS.md workspace map. |
| `repotruck_status` | Per-repository Git health: missing-on-disk, dirty/clean, ahead/behind vs upstream, category, aliases. |
| `repotruck_sync` | Bulk clone / fast-forward update (`user`, `org:<name>`, or `all` scope, optional limit and preset, plus the CLI's include/exclude globs, depth, blobless, stash, divergence and concurrency); creates the workspace when missing. |
| `repotruck_clone` | Clone or update a single repository by URL or `owner/name` into the preset layout. |
| `repotruck_create` | Create a new GitHub repository (optionally from a local directory, at a custom path, in an org). |
| `repotruck_move` | Move a tracked repository to a custom path; inventory, AGENTS.md and aliases rewrite themselves. |
| `repotruck_reorganize` | Re-file everything for a new preset (`dryRun` to preview, `scan` to adopt strays, `keepCustom` to spare manual placements). |
| `repotruck_forget` | Untrack a repository (inventory + AGENTS.md + aliases) while keeping its files on disk. |
| `repotruck_delete` | Untrack a repository AND permanently remove its directory from disk (`confirm: "yes"` required). |
| `repotruck_prune` | Untrack repositories deleted from GitHub (`dryRun` previews; unclear answers are kept and reported; disk untouched). |
| `repotruck_archive` | Archive on GitHub and move the local directory into the archived category of the layout. |
| `repotruck_open` | Launch an app (vscode, cursor, claude, codex, …) detached with its working directory in a tracked repository. |
| `repotruck_run` | Run a shell command across every (or selected) tracked repositories in parallel, with per-repo exit codes and truncated output. |
| `repotruck_stats` | Workspace metrics: language distribution, category counts, stale repositories, disk footprint. |
| `repotruck_doctor` | Run the doctor health checks (git, gh, token, registry, workspace roots). |
| `repotruck_workspaces_remove` | Remove a workspace record from the central registry (files untouched). |
| `repotruck_alias_set` / `repotruck_alias_remove` | Manage short aliases usable as references everywhere. |
| `repotruck_search_github` | Search GitHub for repositories to clone next (stars, language, description). |
| `repotruck_search_code` | Tree-sitter symbol search across every tracked repository (ts/tsx/js/py/go/rs); kind/lang filters, limit, `rebuild`. First search builds the index (~3 MB/s). |

Workspace root resolution matches the CLI: an explicit `root` argument wins; otherwise the server walks up from its working directory for a registered workspace root, then falls back to the configured default root and the OS default. If your client spawns the server in your project directory and the project lives inside a workspace, tools bind to that workspace automatically; otherwise pass `root` explicitly or run `repotruck root <path>` once.

Tool results are JSON (the AGENTS.md tool returns raw markdown); failures come back as `isError` results with a single-line reason, so agents can read and react to them. Input-validation failures are also `isError` results, never exceptions.

Every tool carries full annotations: read-only tools (`list_*`, `search_*`, `status`, `agents_md`, …) are `readOnlyHint` + `idempotentHint`; `sync`/`clone` are `idempotentHint` + `openWorldHint`; `move`, `reorganize`, `forget`, `prune`, `archive` and `alias_remove` are `destructiveHint` (+ `idempotentHint`); `search_github` is `openWorldHint` too — for clients that gate destructive or network-reaching calls.

`repotruck_sync` and `repotruck_clone` honor the MCP progress protocol: clients that send a `_meta.progressToken` receive `notifications/progress` updates (`repo i/N`) as repositories complete, replayed from the same per-repo event stream the dashboard consumes.

### Resources and prompts

Three resources over fixed URIs (no URL-encoded path parameters — the root is resolved server-side with the same rules as the tools), plus a matching resource-template pair per workspace so an agent can address any registered workspace by its URL-encoded absolute root path:

| URI | Content |
| --- | --- |
| `repotruck://agents-md` | The workspace AGENTS.md map (markdown). |
| `repotruck://inventory` | The `repotruck.json` inventory as JSON (repos, preset, aliases, lastSync). |
| `repotruck://tree` | A depth-limited directory tree of the workspace root (plain text). |
| `repotruck://agents-md/{root}` | Same as `agents-md`, for a specific workspace root (URL-encoded). |
| `repotruck://inventory/{root}` | Same as `inventory`, for a specific workspace root (URL-encoded). |
| `repotruck://tree/{root}` | Same as `tree`, for a specific workspace root (URL-encoded). |

Two prompts:

| Prompt | Renders instructions for… |
| --- | --- |
| `sync-and-summarize` | Running a sync (scope/org/limit args) and summarizing new repositories and failures. |
| `suggest-agent-rules` | Reading the map + inventory and proposing grounded AGENTS.md agent rules. |

## Keyboard shortcuts (dashboard)

Shortcuts added this release: `S` (sort descending toggle), `Home`/`End`/`PgUp`/`PgDn` (list navigation), `Left` (wizard back), status-panel scrolling, and a working overlay with a double-`q` quit guard while a sync runs:

| Key | Action |
| --- | --- |
| `Tab` | Cycle focus: sidebar, repository list, status panel |
| `Up` / `Down` | Move the cursor in the focused region; in the status panel they scroll the status log; in the help modal they scroll the key list |
| `Space` | Select/deselect the highlighted repository; in the sidebar, toggle the row under the cursor |
| `a` | Select all filtered repositories (press again to clear) |
| `/` | Search repositories by owner or name (case-insensitive substring), filtered live as you type. Enter applies and closes, empty Enter clears, Escape closes and restores; with no modal open, Escape clears the active search |
| `s` | Cycle sort: name, language, updated (newest first), back to API order. `S` (shift) flips ascending/descending (shown in the counts line). Search and sort never change what is selected |
| `?` | Help screen listing every shortcut |
| `i` | Show details for the highlighted repository: description, stars, updated, tracked path, alias, and local ahead/behind (or `no upstream` / `not on disk`) |
| `c` | Open the clone modal (URL or `owner/name`) |
| `m` | Open the move modal for the highlighted repository |
| `u` | Untrack the highlighted repository (`repotruck forget` semantics — the clone stays on disk). Asks `y/N` first; `n` or Escape cancels |
| `D` | Delete the highlighted repository from disk (`repotruck delete --yes` semantics). Asks `y/N` first; only `y` confirms |
| `R` | Reorganize the workspace: pick a preset, preview the dry-run move plan, then Enter applies (`k` toggles keep-custom, on by default in the dashboard — unlike the CLI) |
| `w` | Open the workspace picker |
| `x` | Inside the workspace picker: remove the highlighted workspace from the registry (disk untouched). Otherwise: dismiss the update toast (remembered once per version) |
| `n` | Open the new-repository wizard |
| `p` | Cycle the preset (affects new clones) |
| `o` | Open the highlighted repository in an app (detected apps; dashboard resumes after the app exits). List focus only |
| `r` | Set an alias for the highlighted repository (list focus only) |
| `d` | Open the default-root modal: shows the effective root (settings override vs OS default) and saves a new one |
| `Enter` | List focus: open the start preview for the selected repositories, then `Enter` again confirms and starts syncing (`Escape` cancels). Sidebar focus: confirm the row. Wizard: advance steps |
| `q` | Quit. While a sync is running, the first `q` shows `sync in progress — press q again to quit`; only a second `q` (within 3s) quits. The footer shows a `working…` summary while anything runs |
| `Escape` | Close any open modal (cancels the create wizard at any step); with no modal open and a search active, clear the search |
| `Home` / `End` / `PgUp` / `PgDn` | Jump to the top/bottom or page through the repository list (page size = the visible viewport) |
| `z` | Undo the last move or delete: restores the directory and its inventory entry (dashboard deletes park directories in `.repotruck/trash` first) |
| Mouse wheel / click | The wheel scrolls the repository list; a click focuses a pane and moves the list cursor to the clicked row |

The dashboard palette can be switched with `repotruck config set theme light|contrast` (or `REPOTRUCK_THEME`); it applies on the next start. `NO_COLOR` still wins over every color.

The create wizard runs name, source  (new repository, or import an existing local directory — the `--from` flow; a Git repository with a clean tree), owner (Personal or one of your organizations), path (pre-filled with the preset target, editable), description (optional), then visibility (Private pre-selected, `Space` flips).

Pressing `Enter` on the repository list no longer syncs immediately: it opens the start preview — the effective root line followed by a directory tree of every selected repository's destination under that root (`[clone]` for new destinations, `[update]` for existing ones, `[custom]` for manually placed ones, capped at 40 tree lines with an `... and N more` tail). `Enter` confirms and starts the sync; `Escape` cancels without touching anything.

## Authentication

repotruck resolves credentials in this order:

1. **`REPOTRUCK_TOKEN` environment variable** — if set, repotruck uses this Personal Access Token directly.
2. **GitHub CLI** — runs `gh auth token`; install and run `gh auth login` once.
3. **Cached device-flow token** — read from `<appConfigDir>/auth.json`.
4. **Device flow** — initiated with `repotruck auth login` (or automatic fallback if client ID is configured).

Token safety: tokens are never written into workspace files. Clones and pulls use a one-shot credential header (or a tokenized URL that is reset to the clean `https://github.com/owner/repo.git` origin immediately after cloning), so no token ever lands in `.git/config`. Failures print the first error line only, with the token redacted.

## `repotruck.json` reference

The app config dir holds a single central `repotruck.json` that records every workspace:

```json
{
  "version": 1,
  "workspaces": [
    {
      "root": "C:\\work\\my-workspace",
      "preset": "categorized",
      "lastSync": "2026-10-23T10:00:00.000Z",
      "lastUsed": "2026-10-23T10:05:00.000Z",
      "repos": [
        {
          "owner": "monalisa",
          "name": "api",
          "relativePath": "monalisa/source/api",
          "category": "source",
          "internal": true,
          "language": "Go",
          "updatedAt": "2026-10-01T00:00:00.000Z",
          "custom": true
        }
      ],
      "aliases": { "api": "monalisa/source/api" }
    }
  ]
}
```

- `version` — schema version, currently `1`. Older file versions are upgraded automatically through a migration chain; a file written by a newer repotruck is rejected with an explicit error instead of being reset.
- `workspaces[]` — one entry per workspace, keyed by its absolute `root`. Each entry also carries a `lastUsed` stamp (bumped on every write).
- `preset` — active preset: `categorized`, `flat-by-owner`, `topic-focused`, `language-first`, `category-first`, `language-categorized`, `flat`, `category-flat`, etc.
- `lastSync` — ISO timestamp of the last successful bulk sync, or `null`.
- `repos[]` — one entry per tracked repository: `owner`, `name`, `relativePath` (workspace-relative, POSIX separators), `category` (`source`, `forks`, or `archived`), `internal`, `language` (or `null`), `updatedAt` (or `null`), and `custom` (`true` when the repository was manually placed; `move` sets it, `reorganize --keep-custom` respects it).
- `aliases` — optional map of alias → workspace-relative path. `repotruck open` accepts an alias as the repository reference; `move` and `reorganize` rewrite alias targets automatically when paths change.

## Environment variables

| Variable | Effect |
| --- | --- |
| `REPOTRUCK_TOKEN` | Personal Access Token override (takes highest precedence for all GitHub API and clone authentication). |
| `REPOTRUCK_CONFIG_DIR` | Overrides the app config directory that holds `repotruck.json`, `settings.json` and `auth.json`. |
| `REPOTRUCK_VERBOSE` | Enables verbose diagnostic logging (equivalent to `--verbose`). |
| `NO_COLOR` | Disables ANSI terminal coloring (equivalent to `--no-color`). |
| `REPOTRUCK_NO_SSH` | Set to any value to disable the SSH availability probe; sync uses HTTPS exclusively. |
| `REPOTRUCK_NO_UPDATE_CHECK` | Set to any value to disable update checks entirely (dashboard toast and `repotruck update` both go quiet; nothing is written to `update.json`). |
| `REPOTRUCK_OAUTH_CLIENT_ID` | OAuth App client ID for the device-flow login (see [Authentication](#authentication)). |
| `REPOTRUCK_THEME` | Dashboard palette override: `default`, `light` or `contrast` (wins over the `theme` setting). |
| `REPOTRUCK_NO_API_CACHE` | Set to any value to disable the GitHub conditional-request cache (`github-cache.json`); every API call hits the network. |

## Windows Terminal

The dashboard renders best in [Windows Terminal](https://aka.ms/terminal). If the layout looks garbled in the legacy console, run repotruck inside Windows Terminal (or any modern terminal emulator). The dashboard requires Node.js >= 26.4 or Bun >= 1.3.14; on older Node versions, use the headless commands or run via `bunx repotruck`.

## License

[MIT](./LICENSE) — Copyright (c) 2026 sametcn99

# Repotruck — Complete Reference & Agent Guide

> Bulk-clone and organize your GitHub repositories into predictable preset layouts with an `AGENTS.md` map and a built-in Model Context Protocol (MCP) server for AI coding agents.

- **Canonical URL**: https://sametcn99.github.io/repotruck/
- **Repository**: https://github.com/sametcn99/repotruck
- **License**: MIT
- **Author**: sametcn99

---

## 1. Overview & Architecture

Repotruck bridges local developer filesystems and remote GitHub organizations. It is engineered to give developers and autonomous AI coding agents (Claude, Cursor, Copilot, Codex, Windsurf, Roo Code) structured, predictable, and self-documenting multi-repository workspaces.

### Key Capabilities
- **Three Interaction Surfaces**: An interactive terminal dashboard (TUI), 27 headless CLI commands, and a 25-tool native Model Context Protocol (MCP) server.
- **16 Deterministic Presets**: Organize repositories by owner, classification (`source`, `forks`, `archived`), language, or custom segment combinations.
- **Automated AGENTS.md Maps**: Every workspace root receives a machine-readable directory map, repository metadata, and coding agent rules rewritten on every sync or move.
- **Tree-sitter Symbol Search**: Fast AST symbol indexing across all repositories in the workspace for functions, classes, interfaces, types, enums, methods, and constants.
- **Strict Credential Hygiene**: Zero token persistence in `.git/config` or workspace files. Clones and updates pass ephemeral in-memory credential headers with automatic error redaction.
- **Atomic Operations & Safety**: Reorganizing layouts uses a journaled two-phase move with rollback recovery. Dashboard deletions move to `.repotruck/trash` with undo support. Automated 5-generation workspace backups.

---

## 2. Installation & Runtimes

### Quick Run
```bash
# Run the interactive dashboard or any subcommand directly
npx repotruck
bunx repotruck

# Global installation
npm i -g repotruck
bun add -g repotruck
```

### Runtime Requirements
| Surface | Runtime Requirement | Description |
|---|---|---|
| **Headless CLI & MCP Server** | Node.js >= 20.0 or any modern Bun | Runs `sync`, `clone`, `status`, `reorganize`, `mcp`, `search-code`, etc. No TTY or graphics required. |
| **Interactive Dashboard (TUI)** | Node.js >= 26.4 or Bun >= 1.3.14 | Full three-pane terminal UI powered by OpenTUI with mouse support and color themes. |

`repotruck doctor` automatically detects and diagnoses runtime compatibility.

---

## 3. Authentication & Security

Repotruck resolves GitHub credentials in the following priority order:
1. **GitHub CLI (`gh auth login`)**: Preferred. Repotruck invokes `gh auth token` dynamically.
2. **Environment Variable**: `GITHUB_TOKEN` or `GH_TOKEN` or `REPOTRUCK_TOKEN`.
3. **GitHub Device Authorization Flow**: If no token exists, setting `REPOTRUCK_OAUTH_CLIENT_ID` starts a device authorization grant directly against GitHub (`https://github.com/login/device/code`).

### Token Safety Guarantees
- **No Disk Storage**: Tokens are never committed to disk, written to `.git/config`, or leaked into workspace inventories.
- **One-Shot In-Memory Headers**: Clones and updates invoke Git with ephemeral `-c http.extraHeader="AUTHORIZATION: basic ..."` parameters.
- **Clean Remote URLs**: Remotes are immediately set to standard HTTPS URLs (`https://github.com/owner/repo.git`).
- **Redacted Diagnostics**: Tokens are automatically stripped from any network or subprocess failure outputs.

### GitHub Enterprise
Target any private GitHub Enterprise instance by passing `--base-url <url>` or setting:
```bash
repotruck config set github.baseUrl https://github.mycompany.com/api/v3
```

---

## 4. Complete CLI Command Reference (27 Commands)

### Group 1: Sync & Clone

#### `repotruck sync [options]`
Bulk clone or fast-forward-update repositories without interactive prompts. Exits 1 if any repository fails.
- **Usage**: `repotruck sync [options]`
- **Flags**:
  - `-s, --scope <scope>`: `"user"` (default), `"org:<name>"`, or `"all"`
  - `-l, --limit <n>`: Sync only the first N repositories of the scope in API order
  - `-c, --concurrency <n>`: Parallel execution limit (default 3; settable via `sync.concurrency`)
  - `--depth <n>`: Shallow clone with given commit depth (new clones only)
  - `--blobless`: Blobless partial clone via `git clone --filter=blob:none` (new clones only)
  - `--stash`: Stash uncommitted changes before updating and re-apply afterwards
  - `--divergence <strategy>`: Action for ahead-of-origin repositories: `fail` (default), `rebase`, `reset`, or `skip`
  - `--include <glob>`: Only sync repositories whose `owner/name` matches the glob
  - `--exclude <glob>`: Skip repositories whose `owner/name` matches the glob
  - `--watch [seconds]`: Keep syncing at fixed interval (default 300s; Ctrl+C stops)
  - `--json`: Output machine-readable JSON summary
- **Examples**:
  ```bash
  repotruck sync
  repotruck sync --scope all --concurrency 5
  repotruck sync --scope org:acme --limit 20
  repotruck sync -p language-first --stash --divergence rebase
  repotruck sync --include "core-*" --exclude "*-legacy"
  repotruck sync --watch 60
  ```

#### `repotruck clone <url> [options]`
Clone a single GitHub repository into the layout; fast-forward pulls if already present on disk.
- **Usage**: `repotruck clone <url> [options]`
- **Flags**:
  - `-p, --preset <id>`: Target layout preset
  - `--depth <n>`: Create a shallow clone with given depth
  - `--blobless`: Create a blobless partial clone
  - `--json`: Machine-readable JSON output
- **Examples**:
  ```bash
  repotruck clone owner/repo
  repotruck clone https://github.com/owner/repo -p flat-by-owner
  repotruck clone owner/repo --depth 1 --blobless
  ```

#### `repotruck create <name> [options]`
Create a new GitHub repository and register it in the workspace. Private by default.
- **Usage**: `repotruck create <name> [options]`
- **Flags**:
  - `--from <dir>`: Import an existing local directory (clean Git tree required)
  - `--at <relative-path>`: Place repository at a custom workspace-relative path
  - `--public / --private`: Visibility (default is private)
  - `--description <text>`: Short repository description
  - `--org <name>`: Create inside a specific organization
- **Examples**:
  ```bash
  repotruck create my-service --description "Auth service"
  repotruck create cli-tool --from ./cli-tool --at tools/cli
  repotruck create shared-ui --org acme --public
  ```

#### `repotruck scan [directory] [options]`
Recursively scan a directory for Git repositories, detect unregistered repositories, and optionally adopt or move them into the active preset layout.
- **Usage**: `repotruck scan [directory] [options]`
- **Flags**:
  - `-m, --move`: Adopt and move unregistered repositories into their target preset directory
  - `--dry-run`: Preview planned moves without modifying files
  - `--json`: Machine-readable JSON output
- **Examples**:
  ```bash
  repotruck scan
  repotruck scan ~/code
  repotruck scan --move --dry-run
  repotruck scan --move
  ```

#### `repotruck reorganize <preset> [options]`
Move every tracked repository to its destination path for a new preset layout. Uses a two-phase atomic move journal (`.repotruck/journal.json`).
- **Usage**: `repotruck reorganize <preset> [options]`
- **Flags**:
  - `--dry-run`: Show the complete move plan without touching disk
  - `--scan`: Discover untracked Git repositories on disk and adopt them
  - `--keep-custom`: Keep manually placed repositories where they are
  - `--resume`: Resume an interrupted reorganization from its journal
  - `--json`: Machine-readable JSON output
- **Examples**:
  ```bash
  repotruck reorganize language-first --dry-run
  repotruck reorganize categorized --keep-custom
  repotruck reorganize flat-by-owner --scan
  ```

---

### Group 2: Repository Lifecycle

#### `repotruck move <repo> <destination>`
Move a tracked repository to a custom relative path. Workspace inventory, AGENTS.md, and aliases update automatically.
- **Usage**: `repotruck move <repo> <destination>`
- **Example**: `repotruck move acme/api services/api`

#### `repotruck forget <repo>`
Untrack a repository from the workspace inventory; directory and files remain untouched on disk.
- **Usage**: `repotruck forget <repo>`
- **Example**: `repotruck forget acme/api`

#### `repotruck delete <repo> --yes`
Stop tracking a repository and permanently remove its directory from disk. Requires `--yes`.
- **Usage**: `repotruck delete <repo> --yes`
- **Example**: `repotruck delete acme/old-api --yes`

#### `repotruck archive <repo>`
Archive the repository on GitHub and re-file it locally under the `archived/` category.
- **Usage**: `repotruck archive <repo>`
- **Example**: `repotruck archive acme/deprecated-service`

#### `repotruck prune [options]`
Untrack repositories that have been deleted or made inaccessible on GitHub (returns 404). Unclear network/permission errors are preserved.
- **Usage**: `repotruck prune [options]`
- **Flags**:
  - `--dry-run`: Preview repositories that would be pruned
  - `--json`: Machine-readable JSON output
- **Example**: `repotruck prune --dry-run`

---

### Group 3: Status, Inspection & Code Search

#### `repotruck status [options]`
Comprehensive status matrix across all tracked repositories: dirty state, ahead/behind commit counts, category, aliases, and diff stats.
- **Usage**: `repotruck status [options]`
- **Flags**:
  - `-D, --detail`: Show detailed unpushed commits and modified files with visual diff stats
  - `-f, --filter <type>`: Filter repositories: `dirty`, `uncommitted`, `unpushed`, `unpulled`, `all`
  - `-c, --check`: Exit non-zero if any repo has uncommitted/unpushed changes or is missing
  - `--json`: Machine-readable JSON output
- **Examples**:
  ```bash
  repotruck status
  repotruck status -D
  repotruck status --filter dirty
  repotruck status --check
  ```

#### `repotruck stats [options]`
Display aggregated workspace statistics: language distribution, category breakdown (`source`, `forks`, `archived`), stale repositories (>=180 days without commit), and total disk footprint.
- **Usage**: `repotruck stats [options]`
- **Example**: `repotruck stats`

#### `repotruck search-code <pattern> [options]`
Search indexed symbols across every tracked repository using Tree-sitter AST parsing. Respects each repository's `.gitignore`.
- **Usage**: `repotruck search-code <pattern> [options]`
- **Flags**:
  - `--kind <kind>`: Filter symbols: `function`, `class`, `interface`, `type`, `enum`, `method`, `const`
  - `--lang <lang>`: Filter by language (`ts`, `tsx`, `js`, `py`, `go`, `rs`)
  - `-l, --limit <n>`: Maximum number of matches (default 50)
  - `--regex`: Treat pattern as a case-insensitive regular expression
  - `--offline`: Require local/cached grammars without downloading
  - `--rebuild`: Force rebuild of the Tree-sitter symbol index
  - `--json`: Machine-readable JSON output
- **Examples**:
  ```bash
  repotruck search-code UserService
  repotruck search-code handleAuth --kind function
  repotruck search-code "Client$" --regex --lang ts --limit 25
  ```

#### `repotruck run <command...> [options]`
Execute a shell command in parallel across all or selected tracked repositories. Reports per-repository exit codes, durations, and outputs.
- **Usage**: `repotruck run <command...> [options]`
- **Flags**:
  - `-r, --repo <ref>`: Target specific repositories (repeatable; alias, owner/name, or path)
  - `-c, --concurrency <n>`: Parallel execution limit (default 3)
  - `--json`: Machine-readable JSON output
- **Examples**:
  ```bash
  repotruck run git status -s
  repotruck run bun test
  repotruck run -r acme/api -r acme/web "npm run build" -c 2
  ```

#### `repotruck open <repo> [app]`
Launch a repository in an editor or coding agent. Omit app to list detected applications on PATH.
- **Builtins**: `claude`, `cursor`, `vscode`, `codex`, `gemini`, `aider`
- **Example**: `repotruck open api claude`

#### `repotruck alias <set|remove|list>`
Manage short identifiers for repositories. Aliases survive moves and reorganizations and are reflected in `AGENTS.md`.
- **Examples**:
  ```bash
  repotruck alias set api acme/api
  repotruck alias list
  repotruck alias remove api
  ```

---

### Group 4: Workspace Memory & Presets

#### `repotruck workspaces [list|remove]`
Inspect or clean up the central machine-wide workspace registry (`records.json`).
- **Examples**:
  ```bash
  repotruck workspaces
  repotruck workspaces remove ~/old-workspace
  ```

#### `repotruck root [path] [--reset]`
Print, set, or reset the default workspace root used when running outside a registered workspace directory.
- **Examples**:
  ```bash
  repotruck root
  repotruck root ~/projects
  repotruck root --reset
  ```

#### `repotruck preset <list|add|remove>`
Manage custom directory layout presets composed of `owner`, `category`, `language`, and `name` tokens (name must come last).
- **Examples**:
  ```bash
  repotruck preset list
  repotruck preset add lang-owner language owner name
  repotruck preset remove lang-owner
  ```

#### `repotruck backup [list|restore <snapshot>]`
List or restore automated workspace snapshots kept in `<root>/.repotruck/backups/` (up to 5 generations preserved). Restoring requires `--yes`.
- **Examples**:
  ```bash
  repotruck backup list
  repotruck backup restore 20261024T120000.json --yes
  ```

#### `repotruck instructions template [name] [--clear]`
Apply predefined AGENTS.md instruction templates (`node`, `python`, `monorepo`) or clear the active template block.
- **Examples**:
  ```bash
  repotruck instructions template
  repotruck instructions template monorepo
  repotruck instructions template --clear
  ```

---

### Group 5: Settings, Health & Agents

#### `repotruck config <get|set|unset|list> [key] [value]`
Read and update global settings stored in `settings.json`.
- **Examples**:
  ```bash
  repotruck config list
  repotruck config get sync.concurrency
  repotruck config set sync.concurrency 5
  repotruck config set sync.divergence rebase
  repotruck config unset sync.depth
  ```

#### `repotruck doctor [--fix]`
Run diagnostics for git binary, gh CLI, GitHub token authentication, central store, and workspace health. `--fix` starts device-flow login if unauthenticated and resumes leftover reorganization journals.
- **Example**: `repotruck doctor --fix`

#### `repotruck mcp [options]`
Launch the Model Context Protocol (MCP) server for AI coding agents.
- **Flags**:
  - `--http`: Serve Streamable HTTP instead of stdio
  - `--port <n>`: HTTP port (default 3000)
  - `--host <addr>`: Bind address (default 127.0.0.1; non-localhost requires `--token`)
  - `--token <token>`: Require `Authorization: Bearer <token>` on all requests
  - `--base-url <url>`: Target GitHub Enterprise API
- **Examples**:
  ```bash
  repotruck mcp
  repotruck mcp --http --port 3000 --token "agent-key"
  ```

#### `repotruck update`
Check npm registry for newer versions and self-update global installations.

#### `repotruck completions <bash|zsh|fish|powershell>`
Generate shell tab-completion scripts with automated installation instructions.

---

## 5. Complete Presets Matrix (16 Built-in Presets)

All non-owned (external) repositories automatically receive a `community/` directory prefix:

| Preset Name | Segment Hierarchy | Example Target Path |
|---|---|---|
| `categorized` (default) | `[owner, category, name]` | `acme/source/web` |
| `flat-by-owner` | `[owner, name]` | `acme/web` |
| `topic-focused` | `[owner, language, name]` | `acme/typescript/web` |
| `language-first` | `[language, owner, name]` | `typescript/acme/web` |
| `category-first` | `[category, owner, name]` | `source/acme/web` |
| `language-categorized` | `[owner, category, language, name]` | `acme/source/typescript/web` |
| `flat` | `[name]` | `web` |
| `category-flat` | `[category, name]` | `source/web` |
| `language-flat` | `[language, name]` | `typescript/web` |
| `category-language` | `[category, language, name]` | `source/typescript/web` |
| `language-category` | `[language, category, name]` | `typescript/source/web` |
| `owner-language-category`| `[owner, language, category, name]` | `acme/typescript/source/web` |
| `category-owner-language`| `[category, owner, language, name]` | `source/acme/typescript/web` |
| `category-language-owner`| `[category, language, owner, name]` | `source/typescript/acme/web` |
| `language-owner-category`| `[language, owner, category, name]` | `typescript/acme/source/web` |
| `language-category-owner`| `[language, category, owner, name]` | `typescript/source/acme/web` |

Categories are computed dynamically: `archived` (if repository is archived on GitHub), `forks` (if repository is a fork), or `source` (original code).

---

## 6. AGENTS.md Workspace Map Specification

Every workspace root carries an `AGENTS.md` file rewritten on every change.

### Map Structure
```markdown
<!-- AUTO-GENERATED by repotruck. Do not edit by hand; this file is rewritten on every sync or clone. -->

# Repository Workspace Map

## Workspace Metadata
- Preset: `categorized`
- Instructions template: `node`
- Last sync: 2026-10-25T19:00:00Z
- Total repositories: 32 (28 internal, 4 community)

## Internal Projects
- `acme/web` — `acme/source/web` (typescript) (alias: frontend)
- `acme/api` — `acme/source/api` (go) (alias: backend)

## Community Repositories (community/)
- `facebook/react` — `community/facebook/source/react` (javascript)

## Agent Rules
- Each directory is an independent Git project; run Git commands inside the project directory, never from the workspace root.
- Exclude `.git/`, `node_modules/`, and `dist/` directories from global searches.
- Repositories under `community/` are read-only references; never suggest commit or push for them without an explicit user request.
- When a repotruck MCP server is connected, prefer its tools (repotruck_list_repos, repotruck_resolve_repo, repotruck_sync, ...) for workspace navigation and updates; otherwise use the `repotruck` CLI.

## Custom Instructions
<!-- repotruck:template begin -->
...template body...
<!-- repotruck:template end -->
<!-- repotruck:custom-instructions begin (this section is preserved verbatim on every rewrite) -->
(add your own instructions for coding agents here — they survive repotruck rewrites)
<!-- repotruck:custom-instructions end -->
```

---

## 7. Model Context Protocol (MCP) Server (25 Tools)

Repotruck embeds an MCP server allowing agents to manipulate the workspace directly.

### Claude Code Setup
```bash
claude mcp add repotruck -- repotruck mcp
```

### Configuration for Cursor / Windsurf / Roo Code
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

### Complete Tool List (25 Tools)
1. **`repotruck_list_workspaces`**: Discover all registered workspaces.
2. **`repotruck_workspace_status`**: Get preset, repository counts, aliases, and last sync.
3. **`repotruck_list_repos`**: List tracked repositories with absolute paths and metadata.
4. **`repotruck_search_repos`**: Search repositories by owner, path, language, or alias.
5. **`repotruck_resolve_repo`**: Resolve an alias or `owner/name` to an absolute disk path.
6. **`repotruck_agents_md`**: Read the `AGENTS.md` workspace map.
7. **`repotruck_status`**: Per-repository Git health and upstream sync status.
8. **`repotruck_sync`**: Bulk clone/update with scope, concurrency, stash, and divergence options.
9. **`repotruck_clone`**: Clone or update a single repository into layout.
10. **`repotruck_create`**: Create a GitHub repository, optionally from a local directory.
11. **`repotruck_move`**: Relocate a repository to a custom path.
12. **`repotruck_reorganize`**: Re-file all repositories for a new preset layout.
13. **`repotruck_forget`**: Untrack a repository while preserving files on disk.
14. **`repotruck_delete`**: Untrack a repository and delete directory (`confirm: true`).
15. **`repotruck_prune`**: Untrack repositories returning 404 on GitHub.
16. **`repotruck_archive`**: Archive on GitHub and move under `archived/`.
17. **`repotruck_open`**: Launch editor or coding agent in a repository.
18. **`repotruck_run`**: Execute shell commands across repositories in parallel.
19. **`repotruck_stats`**: Aggregate language distribution, categories, and disk footprint.
20. **`repotruck_doctor`**: Verify git, gh, GitHub token, central store, and workspace health.
21. **`repotruck_workspaces_remove`**: Remove a workspace record from registry.
22. **`repotruck_alias_set`**: Assign a short repository alias.
23. **`repotruck_alias_remove`**: Remove a repository alias.
24. **`repotruck_search_github`**: Search GitHub for repositories to clone next.
25. **`repotruck_search_code`**: Tree-sitter symbol search across tracked repositories.

### Resources & Prompts
- **Resources**: `repotruck://agents-md`, `repotruck://inventory`, `repotruck://tree`, `repotruck://agents-md/{root}`, `repotruck://inventory/{root}`, `repotruck://tree/{root}`.
- **Prompts**: `sync-and-summarize`, `suggest-agent-rules`.

---

## 8. Configuration & Divergence Strategies

Stored in `settings.json` within the app config directory (`~/.config/repotruck/` or `%APPDATA%\repotruck\`):

| Key | Default | Description |
|---|---|---|
| `defaultRoot` | `(not set)` | Fallback workspace root when walking up finds no workspace |
| `github.baseUrl` | `https://api.github.com` | Custom GitHub Enterprise API base URL |
| `theme` | `default` | TUI dashboard palette: `default`, `light`, or `contrast` |
| `sync.concurrency` | `3` | Parallel repository update limit |
| `sync.depth` | `(off)` | Commit depth for shallow clones of new repositories |
| `sync.blobless` | `false` | Enable blobless partial clones (`--filter=blob:none`) |
| `sync.stash` | `false` | Automatically stash uncommitted changes before updating |
| `sync.divergence` | `fail` | Strategy for repositories ahead of origin: `fail`, `rebase`, `reset`, or `skip` |

### Divergence Behaviors
- **`fail` (default)**: Halts with an error message; `sync` exits with code 1. Prevents any accidental history destruction.
- **`rebase`**: Automatically executes `git rebase origin/<branch>` on local commits.
- **`reset`**: Discards local commits and hard-resets working tree to upstream remote.
- **`skip`**: Leaves diverging repositories untouched and proceeds with the remaining queue.

---

## 9. FAQ

### How does repotruck authenticate?
The GitHub CLI is preferred: run `gh auth login` once and repotruck automatically reuses its session token. Alternatively, set `REPOTRUCK_OAUTH_CLIENT_ID` for headless device-flow authentication or export `GITHUB_TOKEN`.

### What is AGENTS.md for?
It is a structured map created in the workspace root for AI coding agents. Agents read it to determine where projects live, which repositories are internal vs. third-party community references, and what rules to observe.

### Does changing the preset move my repositories?
Changing a preset only affects new clones and creations. To re-file existing repositories, run `repotruck reorganize <preset>`. Preview it first with `--dry-run`.

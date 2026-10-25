---
name: repotruck-mcp
description: Interact with the Repotruck Model Context Protocol (MCP) server, utilizing its 25 tools, 6 resources, and 2 prompts for workspace orchestration.
---

# Repotruck MCP Server Skill

Use this skill when integrating an AI coding agent (Claude Code, Cursor, Windsurf, Roo Code, etc.) with Repotruck via the Model Context Protocol (MCP).

## Server Modes & Connection

Repotruck supports two MCP transport modes:
1. **stdio (Default)**: Best for local agent CLI tools and desktop IDEs.
2. **Streamable HTTP (`--http`)**: Best for remote containers and shared agents.

### Adding to Claude Code
```bash
claude mcp add repotruck -- repotruck mcp
```

### Generic Client Configuration (`mcpServers`)
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

### Running Streamable HTTP Server
```bash
repotruck mcp --http --port 3000 --token "secret-token"
```

---

## Complete MCP Tool Reference (25 Tools)

### 1. Workspace Discovery & Navigation
- **`repotruck_list_workspaces`**: Discover every registered workspace across the host machine.
- **`repotruck_workspace_status`**: Retrieve current workspace metadata: preset layout, total repository counts (internal vs community), aliases, and last sync timestamp.
- **`repotruck_list_repos`**: List all tracked repositories with absolute paths, relative paths, owner/name, category (`source`, `forks`, `archived`), and primary language.
- **`repotruck_search_repos`**: Query repositories by owner, relative path, language, category, or alias.
- **`repotruck_resolve_repo`**: Convert a repository alias or `owner/name` into an exact absolute filesystem path.
- **`repotruck_agents_md`**: Read the contents of the `AGENTS.md` workspace map directly without touching the filesystem.
- **`repotruck_tree`**: Retrieve a depth-limited directory hierarchy of the workspace.

### 2. Synchronization & Cloning
- **`repotruck_sync`**: Run a workspace sync with options for scope (`user`, `org:<name>`, `all`), limit, include/exclude globs, concurrency, shallow depth, blobless filters, stash, and divergence strategies (`fail`, `rebase`, `reset`, `skip`).
- **`repotruck_clone`**: Clone a GitHub repository by URL or `owner/name` into the active preset layout; fast-forward pulls if already present.

### 3. Repository Creation & Lifecycle
- **`repotruck_create`**: Create a new GitHub repository (public or private), optionally importing an existing local directory.
- **`repotruck_move`**: Relocate a repository to a custom relative path; updates aliases and AGENTS.md automatically.
- **`repotruck_reorganize`**: Re-file all repositories according to a new preset layout (supports `dryRun`, `keepCustom`, and `scan`).
- **`repotruck_forget`**: Untrack a repository from the workspace while preserving files on disk.
- **`repotruck_delete`**: Untrack a repository and permanently delete its directory from disk (`confirm: true` required).
- **`repotruck_prune`**: Untrack repositories that return 404 on GitHub.
- **`repotruck_archive`**: Archive a repository on GitHub and re-file it under the `archived/` directory.

### 4. Git Health, Batch Execution & Search
- **`repotruck_status`**: Inspect Git working tree health per repository: dirty status, ahead/behind commit counts, and untracked files.
- **`repotruck_stats`**: Aggregate workspace metrics: language distribution, category breakdown, stale repositories (>=180 days), and total disk footprint.
- **`repotruck_run`**: Execute an arbitrary shell command across all (or selected) repositories in parallel, returning exit codes, stdout, and stderr.
- **`repotruck_search_code`**: Fast Tree-sitter symbol search across all tracked repositories with filtering by symbol kind (`function`, `class`, `interface`, `type`, `const`) and language.
- **`repotruck_search_github`**: Search GitHub for repositories to clone next.
- **`repotruck_open`**: Open a repository in an editor or agent (e.g. `claude`, `cursor`, `vscode`).

### 5. Diagnostics, Workspaces & Aliases
- **`repotruck_doctor`**: Verify git, gh, GitHub token, central store, and workspace health.
- **`repotruck_workspaces_remove`**: Remove a workspace record from the central registry (files untouched).
- **`repotruck_alias_set`**: Assign a convenient short alias to a repository.
- **`repotruck_alias_remove`**: Remove an existing repository alias.

---

## MCP Resources & Templates

Agents can inspect workspace state via read-only MCP URIs:
- **`repotruck://agents-md`**: The `AGENTS.md` workspace map (Markdown).
- **`repotruck://inventory`**: The workspace inventory JSON (repository metadata, categories, paths).
- **`repotruck://tree`**: Formatted text tree of the workspace root.
- **`repotruck://agents-md/{root}`**: `AGENTS.md` for a specific URL-encoded workspace root.
- **`repotruck://inventory/{root}`**: Inventory for a specific URL-encoded workspace root.
- **`repotruck://tree/{root}`**: Directory tree for a specific URL-encoded workspace root.

---

## MCP Prompts

- **`sync-and-summarize`**: Runs a workspace sync and provides a structured summary of newly arrived, updated, and failed repositories.
- **`suggest-agent-rules`**: Analyzes the workspace map and inventory to propose 5-10 project-specific agent rules.

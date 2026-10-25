---
name: repotruck-workspace
description: Manage and navigate GitHub workspace repositories, 16 presets, Tree-sitter code search, batch execution, and AGENTS.md maps using repotruck.
---

# Repotruck Workspace Management Skill

Use this skill when an AI agent needs to inspect, clone, sync, reorganize, or search across GitHub repositories in a local developer workspace using `repotruck`.

## Overview

`repotruck` mirrors GitHub accounts and organizations into predictable directory layouts, maintains an `AGENTS.md` map for agent navigation, and provides headless CLI subcommands and a Model Context Protocol (MCP) server.

## Installation & Execution

```bash
# Run on-demand without installing
npx repotruck <command> [flags]
bunx repotruck <command> [flags]

# Or install globally
npm i -g repotruck
bun add -g repotruck
```

## Core Agent Workflows

### 1. Workspace Discovery & Status
Always check repository health before executing modifications:
```bash
# Per-repository status: dirty, ahead/behind, diff stats, aliases
repotruck status

# Detailed diff statistics with unpushed commits and modified files
repotruck status -D

# Filter by state (dirty, uncommitted, unpushed, unpulled, all)
repotruck status --filter dirty

# CI check: exit non-zero if any repo has uncommitted/unpushed changes
repotruck status --check

# Global workspace statistics (languages, categories, stale >=180d, disk usage)
repotruck stats
```

### 2. Bulk Synchronization
Fetch and clone repositories across user or organization scopes:
```bash
# Sync user account repositories (default)
repotruck sync

# Sync an entire organization with concurrency limit
repotruck sync --scope org:my-org -c 5

# Sync shallow with blobless filter (fastest clone)
repotruck sync --depth 1 --blobless

# Stash uncommitted changes and rebase upstream divergence
repotruck sync --stash --divergence rebase

# Filter by glob pattern
repotruck sync --include "backend-*" --exclude "*-deprecated"
```

### 3. Cloning & Creating
```bash
# Clone a single repo into the layout (URL or owner/name)
repotruck clone owner/repo

# Create a new repository on GitHub (private by default)
repotruck create new-api --description "Microservice backend"

# Import an existing local directory into a new GitHub repo
repotruck create cli-tool --from ./local-cli --org my-org --public
```

### 4. Layout Presets & Reorganization
Repotruck supports 16 built-in directory layouts. Repositories owned by external accounts automatically land under `community/`:

| Preset ID | Segment Hierarchy | Typical Use Case |
|---|---|---|
| `categorized` (default) | `[owner, category, name]` | Balanced hierarchy (`source`, `forks`, `archived`) |
| `flat-by-owner` | `[owner, name]` | Mirrors GitHub orgs and user namespaces directly |
| `topic-focused` | `[owner, language, name]` | Groups by primary programming language per owner |
| `language-first` | `[language, owner, name]` | Grouped by language across all owners |
| `category-first` | `[category, owner, name]` | Top-level separation of `source`, `forks`, `archived` |
| `language-categorized` | `[owner, category, language, name]` | Multi-tier deep classification |
| `flat` | `[name]` | Single directory containing all repositories |
| `category-flat` | `[category, name]` | Fast lookup grouped only by repo category |
| `language-flat` | `[language, name]` | Grouped only by programming language |
| `category-language` | `[category, language, name]` | Categories divided by language |
| `language-category` | `[language, category, name]` | Languages divided by category |
| `owner-language-category` | `[owner, language, category, name]` | Deep ownership-first layout |
| `category-owner-language` | `[category, owner, language, name]` | Category-first full taxonomy |
| `category-language-owner` | `[category, language, owner, name]` | Category and language top tiers |
| `language-owner-category` | `[language, owner, category, name]` | Language and owner top tiers |
| `language-category-owner` | `[language, category, owner, name]` | Language and category top tiers |

#### Reorganizing the Workspace:
Re-filing repositories is atomic and recorded in a rollback journal (`.repotruck/journal.json`):
```bash
# Preview moves without touching files
repotruck reorganize language-first --dry-run

# Reorganize and preserve manually placed repositories
repotruck reorganize categorized --keep-custom

# Discover untracked repositories on disk and adopt them
repotruck reorganize flat-by-owner --scan
```

### 5. Repository Lifecycle
```bash
# Move a repo to a custom path (aliases and AGENTS.md follow)
repotruck move owner/repo custom/path

# Untrack a repository without deleting files on disk
repotruck forget owner/repo

# Untrack and delete repository directory permanently
repotruck delete owner/repo --yes

# Archive on GitHub and move to archived/ category
repotruck archive owner/repo

# Untrack repositories deleted on GitHub (answers 404)
repotruck prune --dry-run
```

### 6. Tree-Sitter Code Search
Repotruck embeds Tree-sitter parsers to index symbol definitions across all repositories:
```bash
# Search symbol names across all tracked repos
repotruck search-code UserService

# Filter by symbol kind (function, class, interface, type, enum, method, const)
repotruck search-code handleAuth --kind function

# Filter by language (ts, tsx, js, py, go, rs)
repotruck search-code "Client" --lang ts --limit 20
```

### 7. Multi-Repo Batch Execution
```bash
# Run a shell command in parallel across all tracked repositories
repotruck run "git status -s"

# Target specific repositories by alias, path, or owner/name
repotruck run -r core-api -r web-client "bun test" -c 4
```

### 8. Workspaces & Settings
```bash
# List all registered workspaces on this machine
repotruck workspaces

# View or set default workspace root
repotruck root ~/workspaces/dev

# Read and write settings
repotruck config list
repotruck config set sync.concurrency 5
repotruck config set sync.divergence rebase

# Restore an automated workspace snapshot (5 generations kept)
repotruck backup list
repotruck backup restore <snapshot>.json --yes
```

## AGENTS.md Specification & Rules

Repotruck automatically writes an `AGENTS.md` map into the workspace root on every sync, clone, move, and create.

### Agent Rules:
1. **Independent Projects**: Every repository is a self-contained Git project. Run Git and package manager commands inside the project directory, never from the workspace root.
2. **Search Exclusions**: Exclude `.git/`, `node_modules/`, `.repotruck/`, and `dist/` directories from workspace searches.
3. **Community Repositories**: Repositories located under `community/` are third-party / non-owned. Treat them as read-only references; never commit or push unless explicitly requested.
4. **Custom Instructions**: The block between `<!-- repotruck:custom-instructions begin -->` and `<!-- repotruck:custom-instructions end -->` is preserved verbatim on every rewrite. Agents can add durable guidelines there.
5. **Tool Preference**: When connected to the Repotruck MCP server (`npx -y repotruck mcp`), prefer MCP tools (`repotruck_list_repos`, `repotruck_resolve_repo`, `repotruck_sync`) over raw shell invocations.

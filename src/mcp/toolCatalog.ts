/**
 * MCP tool catalog — the documentation mirror of the tools registered by
 * src/mcp/tools/*.ts. Consumed by the AGENTS.md guide
 * (src/services/agentsMdGuide.ts); tests/mcp-tool-catalog.test.ts connects a
 * real server over InMemoryTransport and fails when either side drifts, so
 * this list always matches the registered surface exactly.
 */

export interface McpToolDoc {
  readonly name: string;
  readonly title: string;
  readonly description: string;
}

export interface McpPromptDoc {
  readonly name: string;
  readonly title: string;
  readonly description: string;
}

export const MCP_TOOL_CATALOG: readonly McpToolDoc[] = [
  {
    name: "repotruck_list_workspaces",
    title: "List workspaces",
    description:
      "List every registered repotruck workspace: absolute path, preset, repository count, last sync time, last use time, and whether the directory is still on disk. Use this first to discover which workspace roots exist before calling other tools.",
  },
  {
    name: "repotruck_workspace_status",
    title: "Workspace status",
    description:
      "Inspect one workspace: whether it is initialized (registered in the central repotruck.json), the active preset, last sync time, repository counts split by internal/community/custom, and the alias map. Read-only.",
  },
  {
    name: "repotruck_agents_md",
    title: "Read AGENTS.md",
    description:
      "Return the raw AGENTS.md workspace map for a workspace: workspace metadata, every repository with its relative path, agent rules, and the preserved custom instructions block. Read this to understand the workspace before working in it.",
  },
  {
    name: "repotruck_list_repos",
    title: "List repositories",
    description:
      "List the repositories tracked by a workspace, with workspace-relative and absolute paths, category (source/forks/archived), language, updatedAt, custom flag, pinned status and aliases. Optional filters: internal vs community, category, custom, pinned, profile. Requires an initialized workspace.",
  },
  {
    name: "repotruck_search_repos",
    title: "Search repositories",
    description:
      "Case-insensitive substring search over a workspace's tracked repositories: matches owner, name, owner/name, relative path, language and alias. Returns matches with absolute paths. Requires an initialized workspace.",
  },
  {
    name: "repotruck_resolve_repo",
    title: "Resolve repository reference",
    description:
      "Resolve a repository reference (alias, workspace-relative path, or owner/name) inside a workspace to its inventory entry and absolute path on disk. Use this before reading or editing a repository to learn where it lives.",
  },
  {
    name: "repotruck_status",
    title: "Repository git status",
    description:
      "Per-repository Git health for a workspace, exactly like `repotruck status`: for every tracked repository reports missing-on-disk, dirty or clean tree, ahead/behind counts against upstream, linked worktrees, category, custom flag, aliases, and optional diff details or remote PR/CI checks. Read-only.",
  },
  {
    name: "repotruck_sync",
    title: "Sync workspace",
    description:
      "Clone or fast-forward-update repositories in bulk into the workspace layout, exactly like `repotruck sync`. Scope: user (your repositories), org:<name>, or all (your repositories plus every active organization). Creates the workspace (a record in the central repotruck.json + AGENTS.md) when missing. Requires GitHub authentication (GitHub CLI token or cached device-flow token). Emits notifications/progress updates when the client sends a progress token.",
  },
  {
    name: "repotruck_clone",
    title: "Clone repository",
    description:
      "Clone a single GitHub repository (URL or owner/name) into the workspace layout, or fast-forward-pull it when the destination already exists. Registers the repository in the central repotruck.json and in AGENTS.md. Requires GitHub authentication. Emits notifications/progress updates when the client sends a progress token.",
  },
  {
    name: "repotruck_create",
    title: "Create repository",
    description:
      "Create a new GitHub repository and register it in the workspace, exactly like `repotruck create`. Optionally import an existing local directory (--from semantics: a Git repository must have a clean tree) and place it at a custom workspace-relative path. Requires GitHub authentication.",
  },
  {
    name: "repotruck_search_github",
    title: "Search GitHub",
    description:
      "Search repositories on GitHub by keyword and optional qualifiers (org, lang, minStars, topics), just like `repotruck discover`. Use this to find repositories to clone with repotruck_clone. Requires GitHub authentication.",
  },
  {
    name: "repotruck_move",
    title: "Move repository",
    description:
      "Move a tracked repository to a custom workspace-relative path and mark it as manually placed (custom), exactly like `repotruck move`. Rewrites the central repotruck.json, AGENTS.md and alias targets. Refuses to overwrite an occupied destination.",
  },
  {
    name: "repotruck_reorganize",
    title: "Reorganize workspace",
    description:
      "Move every tracked repository to its path for a new preset, exactly like `repotruck reorganize`. Use dryRun first to preview the plan. scan also adopts untracked Git repositories found on disk; keepCustom leaves manually placed repositories where they are.",
  },
  {
    name: "repotruck_forget",
    title: "Forget repository",
    description:
      "Stop tracking a repository without touching its files on disk: removes the entry (and its aliases) from the central repotruck.json and the AGENTS.md map, exactly like `repotruck forget`. The cloned directory stays where it is; re-tracking it later is a reorganize scan away.",
  },
  {
    name: "repotruck_prune",
    title: "Prune deleted repositories",
    description:
      "Untrack repositories that were deleted from GitHub (or became inaccessible): checks every tracked repository against the GitHub API and removes the missing ones from the central repotruck.json and AGENTS.md, exactly like `repotruck prune`. Use dryRun first to preview. Files on disk are never touched. Requires GitHub authentication.",
  },
  {
    name: "repotruck_archive",
    title: "Archive repository",
    description:
      "Archive a repository on GitHub and move its local directory into the archived category of the workspace layout, exactly like `repotruck archive`: the GitHub repository is archived, the inventory category becomes archived, the directory moves and alias targets are rewritten. Requires GitHub authentication.",
  },
  {
    name: "repotruck_delete",
    title: "Delete repository",
    description:
      'Stop tracking a repository AND permanently remove its directory from disk, exactly like `repotruck delete --yes`. This is irreversible; confirm must be the literal string "yes". Use repotruck_forget to keep the files on disk.',
  },
  {
    name: "repotruck_search_code",
    title: "Search code symbols or text",
    description:
      "Search an indexed symbol name (or raw source lines when text=true) across every tracked repository in a workspace, exactly like `repotruck search-code`: a tree-sitter symbol index over ts/tsx/js/python/go/rust sources returning repo:path:line hits with symbol kind and export status. Read-only.",
  },
  {
    name: "repotruck_run",
    title: "Run command in repositories",
    description:
      "Run a shell command in every selected tracked repository of a workspace (in parallel), exactly like `repotruck run`. With no repos selection the command runs in every tracked repository on disk. Per-repository results report exit code, duration and truncated output; a non-zero exit marks the result failed and the whole call isError.",
  },
  {
    name: "repotruck_open",
    title: "Open repository in an app",
    description:
      "Launch an application (vscode, cursor, claude, codex, gemini, aider, a custom apps.json entry, or any PATH executable) with its working directory set to a tracked repository, exactly like `repotruck open`. The app is started detached from the MCP server; the tool returns as soon as the process is launched. Resolve the repository first with repotruck_resolve_repo if you only know part of its name.",
  },
  {
    name: "repotruck_alias_set",
    title: "Set alias",
    description:
      "Set a short alias (letters, digits, dots, dashes, underscores) for a tracked repository, usable as a reference in other tools. Exactly like `repotruck alias set`.",
  },
  {
    name: "repotruck_alias_remove",
    title: "Remove alias",
    description:
      "Remove a repository alias, exactly like `repotruck alias remove`. List current aliases with repotruck_workspace_status.",
  },
  {
    name: "repotruck_stats",
    title: "Workspace statistics",
    description:
      "Workspace metrics, exactly like `repotruck stats`: language distribution, category counts (source/forks/archived/custom), stale repositories (>=180 days inactive) and disk footprint of the repositories on disk. Read-only.",
  },
  {
    name: "repotruck_doctor",
    title: "Run health checks",
    description:
      "Run the repotruck doctor diagnostics, exactly like `repotruck doctor`: checks git, the GitHub CLI, token authentication, the central registry, and workspace roots on disk. Read-only.",
  },
  {
    name: "repotruck_workspaces_remove",
    title: "Remove workspace record",
    description:
      "Remove a workspace from the central repotruck.json registry, exactly like `repotruck workspaces remove <path>`. Only the record is removed; files on disk (including AGENTS.md and repositories) are untouched.",
  },
];

export const MCP_PROMPT_CATALOG: readonly McpPromptDoc[] = [
  {
    name: "sync-and-summarize",
    title: "Sync workspace and summarize new repositories",
    description:
      "Instructions for running a repotruck sync over the workspace and then summarizing what arrived: new repositories, their languages and paths, and any failures.",
  },
  {
    name: "suggest-agent-rules",
    title: "Suggest agent rules for this workspace",
    description:
      "Instructions for reading the workspace map and inventory and then proposing grounded AGENTS.md agent rules: per-category guidance, language conventions, alias usage, and safe defaults.",
  },
];

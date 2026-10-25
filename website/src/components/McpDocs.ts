export interface McpToolDoc {
  readonly tool: string;
  readonly action: string;
}

// 25 tools matching the committed MCP server.
export const MCP_TOOL_ROWS: readonly McpToolDoc[] = [
  { tool: "repotruck_list_workspaces", action: "discover every registered workspace" },
  { tool: "repotruck_workspace_status", action: "preset, counts, aliases, last sync" },
  { tool: "repotruck_list_repos", action: "tracked repositories with absolute paths" },
  { tool: "repotruck_search_repos", action: "search by owner, path, language or alias" },
  { tool: "repotruck_resolve_repo", action: "alias or owner/name to an absolute path" },
  { tool: "repotruck_agents_md", action: "read the AGENTS.md workspace map" },
  { tool: "repotruck_status", action: "per-repository Git health and upstream sync" },
  {
    tool: "repotruck_sync",
    action:
      "bulk clone / fast-forward update with the CLI's scope, limit, include/exclude, depth, blobless, stash, divergence and concurrency knobs",
  },
  { tool: "repotruck_clone", action: "clone or update a single repository" },
  { tool: "repotruck_create", action: "create a GitHub repo, optionally from a local dir" },
  { tool: "repotruck_move", action: "relocate a repository to a custom path" },
  { tool: "repotruck_reorganize", action: "re-file everything for a new preset" },
  { tool: "repotruck_forget", action: "untrack a repository while keeping files on disk" },
  {
    tool: "repotruck_delete",
    action: "untrack a repository and remove its directory (confirm required)",
  },
  { tool: "repotruck_prune", action: "untrack repositories deleted on GitHub" },
  { tool: "repotruck_archive", action: "archive on GitHub and re-file under archived" },
  { tool: "repotruck_open", action: "launch an editor or coding agent in a repository" },
  {
    tool: "repotruck_run",
    action: "run a shell command across every or selected repository in parallel",
  },
  {
    tool: "repotruck_stats",
    action: "language distribution, category counts, stale repositories, disk footprint",
  },
  { tool: "repotruck_doctor", action: "run the git/gh/token/registry/workspace health checks" },
  {
    tool: "repotruck_workspaces_remove",
    action: "remove a workspace record from the registry (files untouched)",
  },
  { tool: "repotruck_alias_set", action: "set a short repository alias" },
  { tool: "repotruck_alias_remove", action: "remove a repository alias" },
  { tool: "repotruck_search_github", action: "find repositories to clone next" },
  { tool: "repotruck_search_code", action: "tree-sitter symbol search across all tracked repos" },
];

export interface McpResourceDoc {
  readonly uri: string;
  readonly content: string;
}

// Three fixed URIs plus one resource-template pair per registered workspace.
export const MCP_RESOURCE_ROWS: readonly McpResourceDoc[] = [
  { uri: "repotruck://agents-md", content: "the AGENTS.md workspace map (markdown)" },
  { uri: "repotruck://inventory", content: "the workspace inventory as JSON" },
  { uri: "repotruck://tree", content: "a depth-limited directory tree of the workspace root" },
  {
    uri: "repotruck://agents-md/{root}",
    content: "the same map for a specific workspace root (URL-encoded)",
  },
  {
    uri: "repotruck://inventory/{root}",
    content: "the same inventory for a specific workspace root (URL-encoded)",
  },
  {
    uri: "repotruck://tree/{root}",
    content: "the same tree for a specific workspace root (URL-encoded)",
  },
];

export interface McpPromptDoc {
  readonly prompt: string;
  readonly description: string;
}

export const MCP_PROMPT_ROWS: readonly McpPromptDoc[] = [
  {
    prompt: "sync-and-summarize",
    description:
      "Run a workspace sync and summarize newly arrived vs updated vs failed repositories, languages, and paths.",
  },
  {
    prompt: "suggest-agent-rules",
    description:
      "Inspect the AGENTS.md workspace map and inventory to propose 5-10 grounded agent rules (categories, dominant languages, safe directories).",
  },
];

export const CLAUDE_CODE_ADD_COMMAND = "claude mcp add repotruck -- repotruck mcp";

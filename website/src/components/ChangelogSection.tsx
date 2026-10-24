interface ChangelogEntry {
  readonly sprint: string;
  readonly hash: string | null;
  readonly title: string;
  readonly points: readonly string[];
}

// Entries track the commit history of the main branch (one commit per sprint).
// The newest entry covers the current unreleased working tree.
const ENTRIES: readonly ChangelogEntry[] = [
  {
    sprint: "Unreleased",
    hash: null,
    title: "Security hardening and CLI surface completion",
    points: [
      "Security hardening: GitHub token moved out of git argv into GIT_CONFIG_* env vars, quoted shell fallbacks, constant-time MCP bearer compare",
      "Custom presets (repotruck preset add), backup list/restore, sync --watch, doctor --fix, and config unset",
      "PowerShell completions plus dynamic flag-value completion; --json on workspaces, stats, doctor, reorganize, prune, alias list, auth status and update",
      "prune keeps and reports unclear answers instead of aborting; prune and status checks run in parallel",
      "MCP parity: sync knobs, new tools run/stats/delete/doctor/workspaces_remove (25 total), per-workspace resource templates",
      "TUI overhaul: running overlay with double-q quit guard, untrack confirmation, NO_COLOR parity, live search, sort descending (S), Home/End/PgUp/PgDn, status scrolling, wizard back-navigation, ModalShell/SelectList refactor",
      "TUI extras: mouse support (wheel scrolls, click focuses and positions the cursor), theme selection (config set theme light|contrast), and z-undo for move/delete via .repotruck/trash",
      "GitHub conditional requests: getRepo sends If-None-Match with a persistent github-cache.json, so prune re-checks are 304-cheap (REPOTRUCK_NO_API_CACHE opts out)",
      "Rate-limit waits now run up to 15 minutes with a visible notice; workspace locks are keyed per store file",
      "bun run docs:check: CI now fails when README/website drift from the real CLI command surface",
    ],
  },
  {
    sprint: "Sprint 8",
    hash: "743d478",
    title: "Website docs and changelog parity",
    points: [
      "Docs and changelog subpages for the website with shared chrome and per-page SEO entries",
      "CLI reference expanded to every committed command with flags, examples, settings and divergence tables",
      "MCP docs aligned with the committed server: tool list, mcpServers config snippets and client setup",
    ],
  },
  {
    sprint: "Sprint 7",
    hash: "c828991",
    title: "Core libraries",
    points: [
      "Tree-sitter symbol search across tracked repositories with vendored WASM grammars (TypeScript, JavaScript, Python, Rust, Go)",
      "run — parallel shell command execution across tracked repositories with per-repo exit codes",
      "AGENTS.md instruction templates (node, python, monorepo)",
      "Workspace backup snapshots — timestamped generations under <root>/.repotruck/backups",
    ],
  },
  {
    sprint: "Sprint 6",
    hash: "9f40f0f",
    title: "Authentication, GHE, platform and CLI wiring",
    points: [
      "repotruck auth — manage authentication (env token, cached credentials, gh-cli, OAuth device flow)",
      "repotruck doctor — verify git/gh dependencies, configuration, auth, and workspace health",
      "repotruck stats — language breakdown, category counts, disk usage, and stale repo inspection",
      "repotruck completions <bash|zsh|fish> — shell completion scripts with installation guidance",
      "GHE support: --base-url flag, settings resolution, and origin-derived extraheader",
      "CLI wiring for search-code, run, and instructions template with uniform JSON error envelopes",
    ],
  },
  {
    sprint: "Sprint 5",
    hash: "c35c911",
    title: "MCP expansion and HTTP transport",
    points: [
      "20 MCP tools with full readOnly and idempotent annotations",
      "repotruck mcp --http with Streamable HTTP transport and bearer token security",
      "3 fixed URI resources (agents-md, inventory, tree) and 2 prompts (sync-and-summarize, suggest-agent-rules)",
      "Streaming SSE progress notifications during bulk sync and clone operations",
    ],
  },
  {
    sprint: "Sprint 4",
    hash: "e0081fc",
    title: "TUI accessibility and modal flows",
    points: [
      "Search modal (/), sort cycling (s), help modal (?), and detailed repository inspector (i)",
      "Untrack (u), delete with confirmation (D), and preset reorganization wizard (R)",
      "Responsive panel widths and accessible keyboard focus cycling across all viewports",
    ],
  },
  {
    sprint: "Sprint 3",
    hash: "62e8b7b",
    title: "Repository lifecycle",
    points: [
      "repotruck forget <repo> — stop tracking, clone stays on disk untouched",
      "repotruck prune — untrack repositories deleted on GitHub (preview with --dry-run)",
      "repotruck delete <repo> — untrack and permanently remove the directory (--yes required)",
      "repotruck archive <repo> — archive on GitHub and re-file under the archived category",
      "repotruck status — per-repository dirty state, ahead/behind, category and aliases",
    ],
  },
  {
    sprint: "Sprint 2",
    hash: "1e4189d",
    title: "Sync engine hardening",
    points: [
      "Shallow and partial clones: --depth <n> and --blobless on sync and clone",
      "-c, --concurrency <n> plus the sync.concurrency setting (default 3)",
      "Rate-limit handling: 403/429 with Retry-After, exponential backoff for secondary limits",
      "Divergence strategies: --divergence fail (default) / rebase / reset / skip, plus --stash for dirty trees",
      "repotruck config get/set/list for defaultRoot and the sync.* settings",
      "Atomic workspace writes with a repotruck.json.lock, and real-git integration tests (local remotes, fake rate limits)",
    ],
  },
  {
    sprint: "Sprint 1",
    hash: "720c5e1",
    title: "Stabilization and release blockers",
    points: [
      "Invalid repotruck.json is backed up to repotruck.json.bak with an explicit error instead of silent reset",
      "MCP server help strings repaired (mojibake → real em-dashes) across all user-facing output",
      "workspaces remove now matches before deleting; --public/--private made symmetric and honest",
      "Prerelease-aware update checks; ws and react-devtools-core dependencies removed",
      "CI gains an npm pack + clean-install + repotruck --version smoke step",
    ],
  },
  {
    sprint: "0.1.0",
    hash: "0c8587f",
    title: "Initial baseline",
    points: [
      "Bulk clone and fast-forward sync with preset layouts and an AGENTS.md workspace map",
      "create, move, reorganize, alias, open, workspaces, root, update and the MCP server (14 tools)",
    ],
  },
];

export function ChangelogSection() {
  return (
    <section className="section changelog" id="changelog" aria-label="Changelog">
      <h2>Changelog</h2>
      <div className="badge-row">
        <a href="https://www.npmjs.com/package/repotruck">
          <img
            src="https://img.shields.io/npm/v/repotruck.svg"
            alt="repotruck package version on npm"
          />
        </a>
        <p className="muted badge-note">
          One entry per sprint commit; the top entry tracks the unreleased working tree. The badge
          reads “invalid” until the first npm publish — it turns live on its own once the package is
          public.
        </p>
      </div>
      <ol className="changelog-list">
        {ENTRIES.map((entry) => (
          <li className="panel changelog-entry" key={entry.sprint}>
            <div className="changelog-head">
              <h3>
                {entry.sprint}: {entry.title}
              </h3>
              {entry.hash !== null ? (
                <a
                  className="muted"
                  href={`https://github.com/sametcn99/repotruck/commit/${entry.hash}`}
                >
                  {entry.hash}
                </a>
              ) : (
                <span className="muted">unreleased</span>
              )}
            </div>
            <ul>
              {entry.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

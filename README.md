# <img src="https://raw.githubusercontent.com/sametcn99/repotruck/main/website/public/favicon.svg" width="28" height="28" alt="repotruck logo"> repotruck

[![npm version](https://img.shields.io/npm/v/repotruck.svg)](https://www.npmjs.com/package/repotruck)
[![npm downloads](https://img.shields.io/npm/dm/repotruck.svg)](https://www.npmjs.com/package/repotruck)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/sametcn99/repotruck/actions/workflows/ci.yml/badge.svg)](https://github.com/sametcn99/repotruck/actions/workflows/ci.yml)

repotruck mirrors your GitHub into a predictable local workspace: every repository cloned or fast-forward-updated in organized directory layouts, an `AGENTS.md` map so coding agents can navigate it, and one tool to keep everything in sync. Drive it three ways — an interactive terminal dashboard, a fully headless CLI, or the built-in MCP server.

> **[Read the full documentation](https://sametcn99.github.io/repotruck/)** — every command and flag, the 16 built-in presets, MCP tools, settings, keyboard shortcuts and the reference.

The **About** page is available from the TUI's System menu or `v` then `o`. Run
`repotruck --about` (or `repotruck about`) for the same description and GitHub link without opening the TUI.
The TUI checks your current GitHub session and shows **Give star** only when you have not starred the project. Click it once (or press `s` / Enter); the button disappears after GitHub confirms the star. Press `r` to retry a failed status check.

## The dashboard

Run `repotruck` with no arguments and the interactive terminal UI takes over:

```bash
repotruck
```

Three panes share the screen. **Scope** opens on the active workspace when it has tracked repositories. Enable your personal account or an organization to bring additional GitHub repositories into the list. The **repository list** shows tracked paths relative to the workspace root, and supports live search, sorting and multi-select. A **status panel** streams everything as it happens. Every workspace operation is reachable from the keyboard:

| Key               | Action                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Enter`           | Open the start preview — a tree of where every selected repository will land (`[clone]`, `[update]`, `[custom]`) — then `Enter` again to sync |
| `n`               | New-repository wizard: name → source (new, or import a local directory) → owner → path → description → visibility                             |
| `c` / `m`         | Clone a repository by URL or `owner/name` / move the highlighted repository to a custom path                                                  |
| `u` / `D`         | Untrack (files stay on disk) / delete from disk — dashboard deletes are parked in `.repotruck/trash` and `z` undoes them                      |
| `R`               | Reorganize: pick a preset, preview the move plan, apply                                                                                       |
| `w` / `d`         | Switch between remembered workspaces / set the default root                                                                                   |
| `o` / `r` / `i`   | Open in an app (claude, cursor, vscode, …) / set an alias / inspect repository details                                                        |
| `/` `s` `S` `a`   | Search, cycle sort, flip sort direction, select all                                                                                           |
| `Tab` / `?` / `q` | Cycle pane focus / full shortcut list / quit (double-`q` while a sync runs)                                                                   |

The mouse works too — the wheel scrolls, a click focuses and moves the cursor. Themes: `default`, `light` and `contrast`. The dashboard needs Node.js >= 26.4 with `--experimental-ffi` or Bun >= 1.3.14; everything below runs headless on Node.js >= 20.

The `categorized` preset groups forks by the GitHub account they were forked from, for example `sametcn99/forks/meta/react`. To move existing checkouts into these folders, open the layout preview with `R` or run `repotruck reorganize categorized --keep-custom --dry-run`. Review the plan, then run the command without `--dry-run` to apply it. Add `--scan` to include checkouts outside the workspace inventory. Repotruck uses GitHub to resolve source owners for older forks.

**Pages (TUI v2).** The Views menu groups workspace, inspection, automation, organization and system pages. Press `F10` to open it, `←` / `→` to change groups, `↑` / `↓` to choose a view, and `Enter` to open it. Press `?` or `F1` for shortcuts on the current page. You can also open pages with `v` followed by the page letter (`v s` Sync Center, `v t` Status Matrix, `v e` Code Search, `v r` Run Console, `v a` Settings, …), cycle with `[` / `]`, return with `Escape`, or pick them from the `:` palette. Right-clicking (or pressing `→` on) a repository opens a context menu with every repo-targeted action. Data pages copy their table as JSON with `J` (the `--json` counterpart), and the palette's Command Form edits any command's flags with the equivalent CLI line built live at the bottom.

<!-- screenshots:start -->
<details>
<summary><b>Screenshots</b> — every page, modal and dialog (auto-captured from the TUI with mock data; regenerate with <code>bun run shots:gen</code>)</summary>

  <h4>Cockpit</h4>
    <p><sub><b>Cockpit</b> — scope sidebar · live repository list · activity panel</sub><br /><img src="website/public/screenshots/cockpit.svg" alt="Cockpit — scope sidebar · live repository list · activity panel" width="880" /></p>
    <p><sub><b>Inspector</b> — right pane tab [2]: live git state of the cursor repo</sub><br /><img src="website/public/screenshots/cockpit-inspector.svg" alt="Inspector — right pane tab [2]: live git state of the cursor repo" width="880" /></p>
    <p><sub><b>Health & Doctor</b> — right pane tab [3]: workspace stats and doctor checks</sub><br /><img src="website/public/screenshots/cockpit-health.svg" alt="Health & Doctor — right pane tab [3]: workspace stats and doctor checks" width="880" /></p>
    <p><sub><b>Repo context menu</b> — → or right-click: every repo-targeted action in one list</sub><br /><img src="website/public/screenshots/context-menu.svg" alt="Repo context menu — → or right-click: every repo-targeted action in one list" width="880" /></p>
    <p><sub><b>Help</b> — ? — keybindings plus the registry-generated views and parity line</sub><br /><img src="website/public/screenshots/help.svg" alt="Help — ? — keybindings plus the registry-generated views and parity line" width="880" /></p>
    <p><sub><b>Command palette</b> — : / Ctrl+K — fuzzy search across every CLI command</sub><br /><img src="website/public/screenshots/omnibar.svg" alt="Command palette — : / Ctrl+K — fuzzy search across every CLI command" width="880" /></p>
    <p><sub><b>Command form</b> — palette → form: full flag editing with the live CLI line</sub><br /><img src="website/public/screenshots/command-form.svg" alt="Command form — palette → form: full flag editing with the live CLI line" width="880" /></p>
    <p><sub><b>Sync preview</b> — Enter on a selection: where every repo will land before it runs</sub><br /><img src="website/public/screenshots/start-preview.svg" alt="Sync preview — Enter on a selection: where every repo will land before it runs" width="880" /></p>

  <h4>Pages</h4>
    <p><sub><b>Sync Center</b> — v s — every sync flag, watch mode and the equivalent CLI command</sub><br /><img src="website/public/screenshots/sync-center.svg" alt="Sync Center — v s — every sync flag, watch mode and the equivalent CLI command" width="880" /></p>
    <p><sub><b>Discover</b> — v d — qualified GitHub search, tracked markers, bulk clone</sub><br /><img src="website/public/screenshots/discover.svg" alt="Discover — v d — qualified GitHub search, tracked markers, bulk clone" width="880" /></p>
    <p><sub><b>Scan & Adopt</b> — v n — unregistered repositories with adopt (scan --move)</sub><br /><img src="website/public/screenshots/scan.svg" alt="Scan & Adopt — v n — unregistered repositories with adopt (scan --move)" width="880" /></p>
    <p><sub><b>Conflicts</b> — v x — failed-sync candidates with continue/abort actions</sub><br /><img src="website/public/screenshots/conflicts.svg" alt="Conflicts — v x — failed-sync candidates with continue/abort actions" width="880" /></p>
    <p><sub><b>Status Matrix</b> — v t — every repository × dirty/ahead/behind/missing</sub><br /><img src="website/public/screenshots/status-matrix.svg" alt="Status Matrix — v t — every repository × dirty/ahead/behind/missing" width="880" /></p>
    <p><sub><b>Status detail</b> — Enter expands a row: outgoing commits and diff stats (-D)</sub><br /><img src="website/public/screenshots/status-detail.svg" alt="Status detail — Enter expands a row: outgoing commits and diff stats (-D)" width="880" /></p>
    <p><sub><b>Status remote</b> — u adds open PR counts and CI state columns (--remote)</sub><br /><img src="website/public/screenshots/status-remote.svg" alt="Status remote — u adds open PR counts and CI state columns (--remote)" width="880" /></p>
    <p><sub><b>Code Search</b> — v e / @ — symbol, text and regex search, results by repository</sub><br /><img src="website/public/screenshots/code-search.svg" alt="Code Search — v e / @ — symbol, text and regex search, results by repository" width="880" /></p>
    <p><sub><b>Stats & health</b> — v i — scorecard grades, languages, disk and stale repos</sub><br /><img src="website/public/screenshots/stats.svg" alt="Stats & health — v i — scorecard grades, languages, disk and stale repos" width="880" /></p>
    <p><sub><b>Changelog</b> — v c — conventional commits across the workspace</sub><br /><img src="website/public/screenshots/changelog.svg" alt="Changelog — v c — conventional commits across the workspace" width="880" /></p>
    <p><sub><b>Run Console</b> — v r / ! — one command across repos with per-repo results</sub><br /><img src="website/public/screenshots/run-console.svg" alt="Run Console — v r / ! — one command across repos with per-repo results" width="880" /></p>
    <p><sub><b>Presets</b> — v p — built-in and custom layout presets, token builder</sub><br /><img src="website/public/screenshots/presets.svg" alt="Presets — v p — built-in and custom layout presets, token builder" width="880" /></p>
    <p><sub><b>Profiles & pins</b> — v f — pinned repos and named profiles feeding sync/run scopes</sub><br /><img src="website/public/screenshots/profiles.svg" alt="Profiles & pins — v f — pinned repos and named profiles feeding sync/run scopes" width="880" /></p>
    <p><sub><b>Trash & backups</b> — v b — soft-deleted repos and snapshot generations</sub><br /><img src="website/public/screenshots/trash-backups.svg" alt="Trash & backups — v b — soft-deleted repos and snapshot generations" width="880" /></p>
    <p><sub><b>Worktrees</b> — v w — workspace-wide linked worktree browser</sub><br /><img src="website/public/screenshots/worktrees.svg" alt="Worktrees — v w — workspace-wide linked worktree browser" width="880" /></p>
    <p><sub><b>Agents & MCP</b> — v g — AGENTS.md templates, exports and the MCP server</sub><br /><img src="website/public/screenshots/agents.svg" alt="Agents & MCP — v g — AGENTS.md templates, exports and the MCP server" width="880" /></p>
    <p><sub><b>About</b> — v o — Repotruck description and GitHub project</sub><br /><img src="website/public/screenshots/about.svg" alt="About — v o — Repotruck description and GitHub project" width="880" /></p>
    <p><sub><b>Settings</b> — v a — configuration, auth, update and completions</sub><br /><img src="website/public/screenshots/settings.svg" alt="Settings — v a — configuration, auth, update and completions" width="880" /></p>

  <h4>Modals & dialogs</h4>
    <p><sub><b>Clone</b> — c — clone by URL or owner/name</sub><br /><img src="website/public/screenshots/clone-modal.svg" alt="Clone — c — clone by URL or owner/name" width="880" /></p>
    <p><sub><b>Create wizard</b> — n — new repository, step by step</sub><br /><img src="website/public/screenshots/create-wizard.svg" alt="Create wizard — n — new repository, step by step" width="880" /></p>
    <p><sub><b>Move</b> — m — custom path, undoable with z</sub><br /><img src="website/public/screenshots/move-modal.svg" alt="Move — m — custom path, undoable with z" width="880" /></p>
    <p><sub><b>Alias</b> — r — short names usable everywhere</sub><br /><img src="website/public/screenshots/alias-modal.svg" alt="Alias — r — short names usable everywhere" width="880" /></p>
    <p><sub><b>Open in app</b> — o — detected editors and agent CLIs</sub><br /><img src="website/public/screenshots/open-modal.svg" alt="Open in app — o — detected editors and agent CLIs" width="880" /></p>
    <p><sub><b>Details</b> — i — GitHub metadata plus local git state</sub><br /><img src="website/public/screenshots/detail-modal.svg" alt="Details — i — GitHub metadata plus local git state" width="880" /></p>
    <p><sub><b>Reorganize</b> — R — preset picker with a live dry-run preview</sub><br /><img src="website/public/screenshots/reorganize-modal.svg" alt="Reorganize — R — preset picker with a live dry-run preview" width="880" /></p>
    <p><sub><b>Worktree manager</b> — W — per-repo linked worktrees</sub><br /><img src="website/public/screenshots/worktree-modal.svg" alt="Worktree manager — W — per-repo linked worktrees" width="880" /></p>
    <p><sub><b>Workspace picker</b> — w — switch or remove registered workspaces</sub><br /><img src="website/public/screenshots/workspace-picker.svg" alt="Workspace picker — w — switch or remove registered workspaces" width="880" /></p>
    <p><sub><b>Default root</b> — d — show and set the fallback workspace root</sub><br /><img src="website/public/screenshots/root-modal.svg" alt="Default root — d — show and set the fallback workspace root" width="880" /></p>
    <p><sub><b>Device-flow login</b> — auth login — non-blocking URL + code while polling</sub><br /><img src="website/public/screenshots/device-flow.svg" alt="Device-flow login — auth login — non-blocking URL + code while polling" width="880" /></p>
    <p><sub><b>Permanent delete</b> — delete --yes — armed only by typing the repository name</sub><br /><img src="website/public/screenshots/permanent-delete.svg" alt="Permanent delete — delete --yes — armed only by typing the repository name" width="880" /></p>
    <p><sub><b>Delete to trash</b> — D — y/n confirm, parked in .repotruck/trash (z undoes)</sub><br /><img src="website/public/screenshots/confirm-delete.svg" alt="Delete to trash — D — y/n confirm, parked in .repotruck/trash (z undoes)" width="880" /></p>

</details>
<!-- screenshots:end -->

## Install

```bash
npm i -g repotruck     # or try it first: npx repotruck (bunx repotruck on Bun)
```

### Headless vs. dashboard runtime

| Surface | Runtime requirement |
| --- | --- |
| Headless CLI (`sync`, `clone`, `status`, `move`, `reorganize`, `create`, `workspaces`, `search-code`, `mcp`, ...) and the MCP server | Node.js >= 20 or any recent Bun |
| Interactive dashboard (running `repotruck` with no arguments) | Node.js >= 26.4 with `--experimental-ffi` or Bun >= 1.3.14 |

If the dashboard runtime is missing, every headless subcommand still works; `repotruck doctor` reports the dashboard runtime status as a warning.

You need [git](https://git-scm.com) on your `PATH` and a GitHub account (github.com or GitHub Enterprise). Authentication is resolved automatically — `REPOTRUCK_TOKEN`, then the [GitHub CLI](https://cli.github.com) (`gh auth login`, recommended), then a cached device-flow token.

## Headless CLI

Every dashboard action is also a plain subcommand — scriptable, CI-friendly, no TTY required. `repotruck <command> --help` prints the live flag list.

**Workspace & sync**

- `repotruck sync` — bulk clone / fast-forward-update tracked repositories (`--scope user\|org:<name>\|all`, include/exclude filters, `--watch`)
- `repotruck clone <url>` — clone or update a single repository into the layout
- `repotruck create <name>` — create a repository on GitHub, fresh or imported from a local directory (`--from`)
- `repotruck reorganize <preset>` — re-file everything into a new layout (`--dry-run`, `--scan`, `--keep-custom`)
- `repotruck scan [dir]` — discover unregistered git repositories and optionally adopt/move them into the layout (`--move`, `--dry-run`)

**Repository lifecycle**

- `repotruck move <owner/name> <path>` — custom path; memory and aliases follow
- `repotruck forget <repo>` — untrack, the clone stays on disk
- `repotruck delete <repo> --yes` — untrack and permanently remove the directory
- `repotruck archive <repo>` — archive on GitHub and re-file under `archived`
- `repotruck prune` — untrack repositories GitHub answers 404 for; unclear answers never untrack

**Inspection & bulk operations**

- `repotruck status` — per-repository git health: dirty, ahead/behind, diff stats with visual bars (`-D`), filter (`-f`), CI exit check (`-c`)
- `repotruck stats` — languages, categories, stale repositories, disk footprint
- `repotruck search-code <pattern>` — tree-sitter symbol search across the workspace
- `repotruck run <command...>` — run a shell command across every (or selected) repository in parallel
- `repotruck open <repo> [app]` — open a repository in claude, cursor, vscode, …
- `repotruck alias set <alias> <repo>` / `alias remove` / `alias list` — short names usable everywhere

VS Code and Cursor open the selected repository folder. Custom launchers can pass that same folder to their executable by including `"{repoDir}"` as a separate item in `args` in `apps.json`.

**Workspace memory & settings**

- `repotruck workspaces list\|remove` — the central workspace registry
- `repotruck root [path]` — show or set the default workspace root
- `repotruck config get\|set\|unset\|list` — settings (`sync.*`, `github.baseUrl`, `theme`, …)
- `repotruck preset add\|remove\|list` — custom layouts built from `owner`/`category`/`language`/`name` segments
- `repotruck backup list\|restore` — automatic workspace snapshots (5 generations kept)
- `repotruck instructions <template>` — AGENTS.md instruction templates (`node`, `python`, `monorepo`)

**Auth, health & housekeeping**

- `repotruck auth login\|logout\|status` — device flow, cached tokens, gh integration
- `repotruck doctor` — health checks for git, gh, token, config and workspace roots (`--fix`)
- `repotruck update` — check npm for a newer release and self-update
- `repotruck completions bash\|zsh\|fish\|powershell` — shell tab-completion

## Coding agents

The central `repotruck.json` inventory records repository paths, GitHub descriptions and topics. Repotruck generates each workspace’s `AGENTS.md` from that inventory and preserves the custom-instructions block. The inventory and `config.json` settings live in the same per-user directory. Repotruck copies legacy data on first access.

| Platform | User data directory |
| --- | --- |
| Linux | `~/.repotruck` |
| Windows | `%LOCALAPPDATA%\repotruck` |
| macOS | `~/Library/Application Support/repotruck` |

Use `repotruck workspaces add <absolute-path>` to create or register a workspace and `repotruck root <absolute-path>` to choose the default. The TUI's `w` picker offers the same controls. When run without an explicit workspace path, Repotruck uses that default from any directory. Commands that accept `--dir` can select a different workspace for a single invocation.

Use `repotruck doctor --dir <workspace>` to compare the inventory with the Git checkouts on disk. Add `--fix` or use **Health → F** in the TUI to apply the proposed inventory repairs. On top of that, `repotruck mcp` exposes the whole surface as an MCP server (stdio, or Streamable HTTP with `--http`) through 25 agent tools:

```bash
claude mcp add repotruck -- repotruck mcp
```

Any MCP client works with `command: "npx"` and `args: ["-y", "repotruck", "mcp"]`. See the [MCP documentation](https://sametcn99.github.io/repotruck/#mcp) for tools, resources and prompts.

GitHub Enterprise is supported everywhere via `--base-url` or `config set github.baseUrl` — [details in the reference](https://sametcn99.github.io/repotruck/#reference).

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for details on setting up the development environment, running checks and tests, and our pull request process.

## License

[MIT](./LICENSE)

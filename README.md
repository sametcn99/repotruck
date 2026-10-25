# <img src="https://raw.githubusercontent.com/sametcn99/repotruck/main/website/public/favicon.svg" width="28" height="28" alt="repotruck logo"> repotruck

[![npm version](https://img.shields.io/npm/v/repotruck.svg)](https://www.npmjs.com/package/repotruck)
[![npm downloads](https://img.shields.io/npm/dm/repotruck.svg)](https://www.npmjs.com/package/repotruck)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/sametcn99/repotruck/actions/workflows/ci.yml/badge.svg)](https://github.com/sametcn99/repotruck/actions/workflows/ci.yml)

repotruck mirrors your GitHub into a predictable local workspace: every repository cloned or fast-forward-updated in organized directory layouts, an `AGENTS.md` map so coding agents can navigate it, and one tool to keep everything in sync. Drive it three ways — an interactive terminal dashboard, a fully headless CLI, or the built-in MCP server.

> **[Read the full documentation](https://sametcn99.github.io/repotruck/)** — every command and flag, the 16 built-in presets, MCP tools, settings, keyboard shortcuts and the reference.

## The dashboard

Run `repotruck` with no arguments and the interactive terminal UI takes over:

```bash
repotruck
```

Three panes share the screen. A **Scope** sidebar holds your account (checked by default), your organizations, filters and the active preset — one checkbox each. The **repository list** supports live search, sorting and multi-select. A **status panel** streams everything as it happens. Every workspace operation is reachable from the keyboard:

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

The mouse works too — the wheel scrolls, a click focuses and moves the cursor. Themes: `default`, `light` and `contrast`. The dashboard needs Node.js >= 26.4 or Bun >= 1.3.14; everything below runs headless on Node.js >= 20.

## Install

```bash
npm i -g repotruck     # or try it first: npx repotruck (bunx repotruck on Bun)
```

### Headless vs. dashboard runtime

| Surface | Runtime requirement |
| --- | --- |
| Headless CLI (`sync`, `clone`, `status`, `move`, `reorganize`, `create`, `workspaces`, `search-code`, `mcp`, ...) and the MCP server | Node.js >= 20 or any recent Bun |
| Interactive dashboard (running `repotruck` with no arguments) | Node.js >= 26.4 or Bun >= 1.3.14 |

If the dashboard runtime is missing, every headless subcommand still works; `repotruck doctor` reports the dashboard runtime status as a warning.

You need [git](https://git-scm.com) on your `PATH` and a GitHub account (github.com or GitHub Enterprise). Authentication is resolved automatically — `REPOTRUCK_TOKEN`, then the [GitHub CLI](https://cli.github.com) (`gh auth login`, recommended), then a cached device-flow token.

## Headless CLI

Every dashboard action is also a plain subcommand — scriptable, CI-friendly, no TTY required. `repotruck <command> --help` prints the live flag list.

**Workspace & sync**

- `repotruck sync` — bulk clone / fast-forward-update tracked repositories (`--scope user\|org:<name>\|all`, include/exclude filters, `--watch`)
- `repotruck clone <url>` — clone or update a single repository into the layout
- `repotruck create <name>` — create a repository on GitHub, fresh or imported from a local directory (`--from`)
- `repotruck reorganize <preset>` — re-file everything into a new layout (`--dry-run`, `--scan`, `--keep-custom`)

**Repository lifecycle**

- `repotruck move <owner/name> <path>` — custom path; memory and aliases follow
- `repotruck forget <repo>` — untrack, the clone stays on disk
- `repotruck delete <repo> --yes` — untrack and permanently remove the directory
- `repotruck archive <repo>` — archive on GitHub and re-file under `archived`
- `repotruck prune` — untrack repositories GitHub answers 404 for; unclear answers never untrack

**Inspection & bulk operations**

- `repotruck status` — per-repository git health: dirty, ahead/behind, missing on disk
- `repotruck stats` — languages, categories, stale repositories, disk footprint
- `repotruck search-code <pattern>` — tree-sitter symbol search across the workspace
- `repotruck run <command...>` — run a shell command across every (or selected) repository in parallel
- `repotruck open <repo> [app]` — open a repository in claude, cursor, vscode, …
- `repotruck alias set <alias> <repo>` / `alias remove` / `alias list` — short names usable everywhere

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

Every workspace root carries an `AGENTS.md` map — metadata, the repository inventory, agent rules — rewritten on every change, with a custom-instructions block preserved verbatim. On top of that, `repotruck mcp` exposes the whole surface as an MCP server (stdio, or Streamable HTTP with `--http`) through 25 agent tools:

```bash
claude mcp add repotruck -- repotruck mcp
```

Any MCP client works with `command: "npx"` and `args: ["-y", "repotruck", "mcp"]`. See the [MCP documentation](https://sametcn99.github.io/repotruck/#mcp) for tools, resources and prompts.

GitHub Enterprise is supported everywhere via `--base-url` or `config set github.baseUrl` — [details in the reference](https://sametcn99.github.io/repotruck/#reference).

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for details on setting up the development environment, running checks and tests, and our pull request process.

## License

[MIT](./LICENSE)

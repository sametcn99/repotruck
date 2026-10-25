# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-25

### Added

- `scan` CLI command: remote repository discovery and search across user or organization accounts without cloning (`repotruck scan [--limit <n>] [--min-stars <n>] [--archived] [--forks] [--topics <list>] [--sort <criteria>]`).
- `status -D, --detail` flag: per-repository diff statistics for dirty repositories detailing insertions, deletions, modified files, and untracked status.
- MCP prompts: added `daily-sync` and `triage-changes` prompts for agentic orchestration.
- Modular CLI architecture: the monolithic `cli.ts` is split into `cli/` (program setup, shared helpers, one file per command), each command registering via `register(program, ctx)`.
- `core/` use-case layer unifying repeated flows across CLI, MCP, and TUI: typed alias operations (`setWorkspaceAlias`, `removeWorkspaceAlias`), lifecycle operations (`moveRepo`, `forgetRepo`, `deleteRepo`, `archiveRepo`, `pruneRepos`), and workspace status (`getWorkspaceStatus`), all built on the atomic `updateWorkspace` pattern.
- Modular MCP server: `mcp/server.ts` is split into `mcp/tools/*` (workspace, repos, sync, lifecycle, aliases, github, search, prompts) over a shared `ToolContext`.
- `scripts/size-check.ts` enforcing a 600-line budget per source file, wired into CI.
- Clean CLI exit semantics: `CliExit` control-flow signal replaces direct `process.exit` in commands, letting `finally` blocks run and stdout flush; a 2s watchdog in the CLI entry guarantees termination. Documented exceptions remain only in signal handlers.
- Doctor "TUI runtime" warning check and a headless-vs-dashboard runtime table in the README.
- On-demand, SHA-256-verified tree-sitter grammar downloads (`grammarStore`): embedded manifest with real computed hashes, resolution order `REPOTRUCK_GRAMMARS_DIR` → app cache → vendored → download, atomic cache writes, `search-code --offline`, and a doctor grammar-cache status check. Grammar assets ship via the manually-triggered `release-grammars` workflow; until it runs, resolution stays local and offline-clean.

### Changed

- Package size reduced from ~7.5 MB to ~592 kB unpacked (14 → 7 files): bundled grammars removed from the npm package in favor of on-demand downloads.
- MCP tools for aliases, lifecycle, status, move, and prune are thin adapters over the `core/` layer.

## [0.2.0] - 2026-10-25

### Added

- Multi-process atomic workspace locking (`workspaceLock.ts`) with reentrant acquisition, heartbeat liveness, tokenized ownership checks, and concurrency protection.
- Case-insensitive repository alias map persistence with synchronous and multi-process integrity guarantees.
- Windows shell quoting security hardening (`shellQuote.ts`) defending against command injection (`%VAR%`, `!VAR!`, `&`, `|`, `<`, `>`, `^`, delimiters, parentheses, and wildcards) with non-backtracking MSVCRT backslash doubling before quotes and closing bounds.
- Double caret escaping for Windows `.cmd` and `.bat` shims (`npm.cmd`) in runner, launcher, and update services.
- Strict rejection of carriage return (`\r`) and newline (`\n`) characters in command tokens and arguments on Windows with `ShellQuoteError`.
- GitHub Actions OIDC Trusted Publishing with automated provenance attestation on npm releases.
- Grouped Dependabot configuration for Bun and GitHub Actions ecosystems with WebAssembly ABI pinning.
- Crash-safe reorganizer journal (`.repotruck/reorganize-journal.json`) with `reorganize --resume` reconciliation, `doctor` detection, `doctor --fix` repair, and two-phase case-only renames on case-insensitive filesystems.
- Injectable `fs` dependency for directory moves (EXDEV fallback and failure cleanup testable) and an aggregate coverage gate (`scripts/check-coverage.ts`) in CI, backed by new auth, single-clone, and CLI-support test suites (hermetic, local-git only).

### Changed

- Replaced custom spawn escaping on Windows with cross-spawn-derived logic featuring corrected MSVCRT backslash sequence handling.
- Pinned all GitHub Actions steps across CI, Release, and Pages workflows to full commit SHAs with version annotations.
- Streamlined MCP server node dependency documentation with permanent interoperability notes.

### Security

- Hardened child-process shell execution fallback mechanisms across CLI run, launch, update, and MCP detached tools.
- Removed long-lived `NPM_TOKEN` publishing credentials from workflow definitions in favor of short-lived OIDC tokens.

## [0.1.0] - 2026-10-24

### Added

- Initial open-source release of repotruck: workspace management, repository cloning, fast-forward updating, and AGENTS.md map generation.
- Interactive terminal dashboard built on OpenTUI.
- Built-in Model Context Protocol (MCP) server supporting stdio and HTTP transports.
- 16 built-in directory layout presets and custom path placement workflows.

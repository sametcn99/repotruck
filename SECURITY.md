# Security Policy

## Supported Versions

repotruck is pre-1.0 and receives security fixes only on the latest published
npm release.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately to the repository owner via
GitHub security advisories (**Security > Report a vulnerability** on this
repository), or email the address listed on the owner's GitHub profile.

Do not open public issues for suspected security problems. Include reproduction
steps and, where possible, a minimal example. You should receive a response
within a few days.

## Scope notes

- repotruck stores a GitHub token in `auth.json` inside the app config dir
  (permissions `0600` where the platform supports it) and never writes tokens
  into git child-process command lines.
- The MCP HTTP transport refuses non-localhost binds without `--token` and
  validates Host/Origin headers on localhost; bearer tokens are compared in
  constant time.
- Child-process shell execution policy:
  - `repotruck run` and `launch` execute commands through a shell only as an
    ENOENT fallback (e.g. when invoking `.cmd`/`.bat` shims or shell builtins).
  - `repotruck update` on Windows always spawns through `cmd.exe` (`shell: true`),
    applying double escaping (`cmdShim: true`) for `npm` (invoking `npm.cmd`) and
    standard single shell escaping for `bun` (`bun.exe`).
  - MCP detached commands execute through a shell only as an ENOENT fallback
    with standard single shell quoting.
- On Windows (`cmd.exe`), argument content and command tokens are protected against
  shell syntax and environment variable injection (`%VAR%`, `!VAR!`, `&`, `|`, `<`, `>`,
  `^`, `()`, quotes, delimiters) using cross-spawn-derived escaping with corrected
  backslash-sequence handling (proper MSVCRT 2N/2N+1 backslash doubling before quotes
  and at argument end) combined with cmd.exe caret (`^`) escaping. Arguments or command
  tokens containing carriage return (`\r`) or newline (`\n`) cannot be safely escaped for
  `cmd.exe` and are rejected with a `ShellQuoteError`.
- For `.cmd`/`.bat` shims (such as `npm.cmd`), meta-characters receive double caret
  escaping (`cmdShim: true`) in `repotruck update` (for `npm`) and in `runner`/`launcher`
  when an explicit `.cmd` or `.bat` extension is present. Detached MCP child-process
  spawns execute with standard single shell quoting without shim double escaping.
- On POSIX platforms, arguments are quoted using strict single quotes so that
  argument content cannot be reinterpreted as shell syntax.
- Residual limitations: Extensionless commands resolved via `PATH` to batch shims
  (such as `code` pointing to `code.cmd`) are quoted with single escaping rather than
  double escaping unless invoked with an explicit `.cmd`/`.bat` extension. Systems
  configured with delayed environment variable expansion enabled registry-wide
  (`/v:on`) fall outside the standard cmd.exe execution model.

## Supply Chain & Package Integrity

- **OIDC Trusted Publishing:** Releases to the npm registry use GitHub Actions OpenID
  Connect (OIDC) Trusted Publishing (`id-token: write`). Static secret tokens (`NPM_TOKEN`)
  are eliminated from continuous integration and release workflows. Packages are published
  with cryptographic provenance attestations (`--provenance`) linking published npm artifacts
  directly to the specific GitHub Actions workflow run and commit SHA.
  > [!NOTE]
  > Before publishing, a Trusted Publisher must be configured manually in npmjs.com package
  > settings for `repotruck` (bound to repository `sametcn99/repotruck` and workflow `release.yml`).
- **Immutable Action Pinning:** All GitHub Actions across continuous integration, release,
  and deployment workflows are pinned to immutable 40-character commit SHAs with version
  annotations (e.g. `actions/checkout@11bd7190... # v4.2.2`). Dependencies are monitored
  and kept current using automated weekly Dependabot scans.

## Tree-Sitter Grammar Integrity & Downloads

repotruck uses tree-sitter grammars (compiled WebAssembly binaries) for AST-aware code search across supported languages (`ts`, `tsx`, `js`, `python`, `go`, `rust`).

- **Resolution Hierarchy:** Grammars are resolved in a deterministic precedence order:
  1. Local environment override via `REPOTRUCK_GRAMMARS_DIR`
  2. Persistent local application cache (`<appConfigDir>/grammars`)
  3. Bundled and vendored distribution files (`dist/grammars` in npm packages, `vendor/grammars` in source checkouts)
  4. On-demand download from project releases via HTTPS
- **Origin & Integrity Verification:** When on-demand downloads are active, grammars are fetched exclusively from official repotruck release assets (`grammars-v1`). Every downloaded binary is hashed using SHA-256 and verified against the embedded manifest before being accepted or cached. Any digest mismatch is rejected immediately with a `GrammarIntegrityError`.
- **Atomic Caching:** Downloaded binaries are written to the cache directory using temporary files and atomic rename operations (`writeBufferAtomic`). Corrupted or interrupted transfers are deleted during failure handling and leave no partial files or poisoned cache entries.
- **Offline & Air-Gapped Environments:** When running in offline mode (`offline: true` or `--offline`), network requests are disabled. If a required grammar is missing from local paths, repotruck aborts grammar resolution with an actionable `GrammarOfflineError` rather than attempting external connections.
- **Package Size Optimization:** Tree-sitter WebAssembly grammars are excluded from the npm package distribution (`dist/grammars`) to keep the unpacked package footprint below 1 MB (~600 KB compared to ~7.5 MB when bundled). Grammars are fetched on-demand during code search or resolved locally.
- **Deterministic Manifest:** The built-in `DEFAULT_GRAMMAR_MANIFEST` defines cryptographic SHA-256 digests and exact file sizes for all six supported language grammars, generated deterministically from vendor binaries via `scripts/generate-grammar-manifest.ts`.
- **Handling Unpublished Release Assets:** When release assets on tag `grammars-v1` are not yet published, download requests return HTTP 404 and produce an actionable error guiding users to set `REPOTRUCK_GRAMMARS_DIR` or populate the local cache directory manually.
- **Automated Release Workflow:** Grammar assets are managed via `.github/workflows/release-grammars.yml`, requiring manual invocation (`workflow_dispatch`), commit-SHA-pinned actions, and automated manifest consistency checks before asset publication.

# Contributing to repotruck

Thank you for your interest in contributing to repotruck! We welcome contributions, bug reports, and suggestions from everyone.

## Development Environment Requirements

- **Bun**: `>= 1.2` (primary runtime and package manager)
- **Node.js**: `>= 20` (Node 26 recommended for latest terminal features)
- **Git**: `>= 2.30`

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/sametcn99/repotruck.git
   cd repotruck
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Build the CLI and bundles:
   ```bash
   bun run build
   ```

## Development Commands

Always verify your changes with the standard check suite before opening a pull request:

- **Format and Lint:**
  ```bash
  bun run check
  ```
  Runs [Biome](https://biomejs.dev/) to format and lint TypeScript code across the repository.

- **Type Check:**
  ```bash
  bun run typecheck
  ```
  Runs TypeScript type checking without emitting output files (`tsc --noEmit`).

- **Run Tests:**
  ```bash
  bun test
  ```
  Runs the full test suite. On Windows, PowerShell users should ensure environment variables and temp files are cleaned up between runs.

- **Check Documentation Synchronization:**
  ```bash
  bun run docs:check
  ```
  Ensures CLI options and markdown documentation remain in sync.

## Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

- `feat:` Introduces a new feature or capability.
- `fix:` Patches a bug or addresses unexpected behavior.
- `docs:` Documentation improvements or additions.
- `test:` Adding or updating tests.
- `refactor:` Code refactoring without behavioral changes.
- `chore:` Routine maintenance, dependency updates, and build configuration.

Example:
```
feat(cli): add --filter flag to workspace list command
fix(windows): escape double carets in batch shim arguments
docs(mcp): document streamable HTTP authentication options
```

## Pull Request Guidelines

1. Ensure all checks (`bun run check`, `bun run typecheck`, `bun run docs:check`, and `bun test`) pass cleanly.
2. If introducing new functionality or addressing bugs, include targeted unit and integration tests.
3. Keep pull requests focused on a single change or objective.
4. Document user-facing changes in `CHANGELOG.md` under `[Unreleased]`.

# repotruck auth.md

Authentication guide for AI coding agents and automated workflows using the `repotruck` CLI and MCP server.

## Overview

`repotruck` is an open-source CLI and Model Context Protocol (MCP) tool that runs locally on developer workstations and CI runners. It interacts directly with GitHub's APIs (`api.github.com`) and local git workspaces.

The repotruck website (`https://sametcn99.github.io/repotruck/`) is a static documentation site and does not host user accounts, OAuth authorization servers, or remote API gateways.

## How Agents Authenticate

When coding agents execute `repotruck` or connect to its local MCP server (`npx -y repotruck mcp`):

### 1. GitHub CLI (`gh`) Integration (Recommended)
If `gh` is logged in on the host machine (`gh auth status`), repotruck automatically retrieves the GitHub token via `gh auth token`.
- Scopes used: `repo`, `read:org`
- Setup: `gh auth login`

### 2. Environment Variables
In containerized, sandbox, or CI/CD agent environments:
```bash
export GITHUB_TOKEN="ghp_..."
# or
export GH_TOKEN="ghp_..."
```

### 3. GitHub Device Authorization Flow
For standalone headless setups, setting `REPOTRUCK_OAUTH_CLIENT_ID` activates GitHub's standard device authorization grant (`https://github.com/login/device/code`).

## Credential Hygiene & Safety Guarantees

- **No Disk Persistence**: Access tokens are never written to `.git/config`, workspace trees, or repository configuration.
- **Ephemeral Header Transport**: Clones and updates pass tokens via ephemeral in-memory credential headers (`-c http.extraHeader=...`).
- **Clean Remotes**: Clone origin URLs are immediately reset to clean HTTPS URLs without embedded credentials.
- **Automatic Redaction**: Error strings and diagnostic traces redact tokens before outputting to stderr.

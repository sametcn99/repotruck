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
- `repotruck run` executes commands through a shell only as an ENOENT
  fallback, with every argument quoted so argument content cannot be
  reinterpreted as shell syntax.

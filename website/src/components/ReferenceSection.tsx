const AUTH_STEPS: readonly { source: string; detail: string }[] = [
  {
    source: "REPOTRUCK_TOKEN",
    detail: "environment variable — this Personal Access Token is used directly when set.",
  },
  {
    source: "GitHub CLI",
    detail: "runs gh auth token; install gh and run gh auth login once.",
  },
  {
    source: "cached device-flow token",
    detail: "read from auth.json in the app config dir.",
  },
  {
    source: "device flow",
    detail:
      "started with repotruck auth login, or as automatic fallback when REPOTRUCK_OAUTH_CLIENT_ID is configured.",
  },
];

const ROOT_STEPS: readonly string[] = [
  "-d, --dir <root> when given",
  "the nearest registered workspace root found walking up from the current directory",
  "the configured default root (repotruck root <path>, stored as defaultRoot in settings.json)",
  "the OS default root",
];

const DEFAULT_ROOT_ROWS: readonly { platform: string; root: string }[] = [
  { platform: "Windows", root: "%USERPROFILE%\\repotruck" },
  { platform: "macOS", root: "$HOME/repotruck" },
  { platform: "Linux", root: "$HOME/repotruck" },
];

const ENV_ROWS: readonly { variable: string; effect: string }[] = [
  {
    variable: "REPOTRUCK_TOKEN",
    effect: "Personal Access Token override; highest precedence for all GitHub API and clone auth.",
  },
  {
    variable: "REPOTRUCK_CONFIG_DIR",
    effect:
      "Overrides the app config directory that holds repotruck.json, settings.json and auth.json.",
  },
  { variable: "REPOTRUCK_VERBOSE", effect: "Verbose diagnostic logging (same as --verbose)." },
  { variable: "NO_COLOR", effect: "Disables ANSI terminal coloring (same as --no-color)." },
  {
    variable: "REPOTRUCK_NO_SSH",
    effect: "Disables the SSH availability probe; sync uses HTTPS exclusively.",
  },
  {
    variable: "REPOTRUCK_NO_UPDATE_CHECK",
    effect:
      "Disables update checks entirely — the dashboard toast and repotruck update both go quiet.",
  },
  {
    variable: "REPOTRUCK_OAUTH_CLIENT_ID",
    effect: "OAuth App client ID for the device-flow login.",
  },
  {
    variable: "REPOTRUCK_THEME",
    effect: "Dashboard palette override: default, light or contrast (wins over the theme setting).",
  },
  {
    variable: "REPOTRUCK_NO_API_CACHE",
    effect:
      "Disables the GitHub conditional-request cache (github-cache.json); every API call hits the network.",
  },
  {
    variable: "REPOTRUCK_GRAMMARS_DIR",
    effect: "Overrides the local directory for Tree-sitter WASM grammars used by search-code.",
  },
];

const INVENTORY_SNIPPET = `{
  "version": 1,
  "workspaces": [
    {
      "root": "C:\\\\work\\\\my-workspace",
      "preset": "categorized",
      "lastSync": "2026-10-23T10:00:00.000Z",
      "repos": [
        {
          "owner": "monalisa",
          "name": "api",
          "relativePath": "monalisa/source/api",
          "category": "source",
          "internal": true,
          "language": "Go",
          "custom": true
        }
      ],
      "aliases": { "api": "monalisa/source/api" }
    }
  ]
}`;

const APPS_SNIPPET = `[
  {
    "name": "my-agent",
    "command": "agent-cli",
    "args": ["--workspace"]
  }
]`;

export function ReferenceSection() {
  return (
    <section className="section" id="reference" aria-label="Reference">
      <h2>Reference</h2>
      <p className="section-sub">
        The deeper rules repotruck runs on: authentication, workspace memory, backups, the AGENTS.md
        map, GitHub Enterprise, environment variables and the central inventory file.
      </p>

      <div className="panel ref-panel" id="ref-auth" data-toc-sub="Authentication">
        <span className="panel-label">auth</span>
        <h3>Authentication</h3>
        <p>Credentials resolve in this order; the first hit wins:</p>
        <ol>
          {AUTH_STEPS.map((step) => (
            <li key={step.source}>
              <code>{step.source}</code> — {step.detail}
            </li>
          ))}
        </ol>
        <p className="ref-note">
          Token safety: tokens never land in workspace files or <code>.git/config</code>. Clones and
          pulls use a one-shot credential header, the origin is reset to the clean HTTPS URL
          immediately after cloning, and failures print the first error line only, with the token
          redacted.
        </p>
      </div>

      <div className="panel ref-panel" id="ref-memory" data-toc-sub="Workspace memory">
        <span className="panel-label">memory</span>
        <h3>Workspace memory</h3>
        <p>
          All workspace records live in one central <code>repotruck.json</code> in the app config
          dir — never inside your workspaces. Each entry remembers the workspace root, preset, last
          sync, last use, aliases and the full repository inventory, so repotruck can recall every
          workspace it has ever written. The workspace directories themselves hold only{" "}
          <code>AGENTS.md</code> and your repositories.
        </p>
        <p>Every workspace command resolves its root the same way:</p>
        <ol>
          {ROOT_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Platform</th>
              <th scope="col">Default root</th>
            </tr>
          </thead>
          <tbody>
            {DEFAULT_ROOT_ROWS.map((row) => (
              <tr key={row.platform}>
                <td data-label="Platform" className="path">
                  {row.platform}
                </td>
                <td data-label="Default root">
                  <code>{row.root}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ref-note">
          The config dir follows your platform convention (<code>%APPDATA%\\repotruck</code> on
          Windows, <code>~/Library/Application Support/repotruck</code> on macOS,{" "}
          <code>$XDG_CONFIG_HOME/repotruck</code> or <code>~/.config/repotruck</code> on Linux);
          <code>REPOTRUCK_CONFIG_DIR</code> overrides it. The current directory is never turned into
          a workspace implicitly. Manually moved repositories are flagged <code>custom: true</code>;{" "}
          <code>reorganize --keep-custom</code> spares them. Legacy workspace-local{" "}
          <code>repotruck.json</code> files are imported and removed on first use.
        </p>
      </div>

      <div className="grid-2">
        <div className="panel ref-panel" id="ref-backups" data-toc-sub="Backups">
          <span className="panel-label">backups</span>
          <h3>Backups and trash safety</h3>
          <ul>
            <li>
              A corrupted or unreadable <code>repotruck.json</code> is preserved as{" "}
              <code>repotruck.json.bak</code> before anything can overwrite it.
            </li>
            <li>
              Every workspace save first writes a timestamped snapshot of the previous state into{" "}
              <code>&lt;root&gt;/.repotruck/backups/</code> (5 generations kept).
            </li>
            <li>
              <code>repotruck backup list</code> shows the snapshots;{" "}
              <code>repotruck backup restore &lt;snapshot&gt; --yes</code> restores one.
            </li>
            <li>
              Deletes initiated from the dashboard park clones in{" "}
              <code>&lt;root&gt;/.repotruck/trash</code>; press <code>z</code> on the dashboard to
              undo moves and deletes immediately.
            </li>
          </ul>
        </div>

        <div className="panel ref-panel" id="ref-prune" data-toc-sub="Pruning">
          <span className="panel-label">prune</span>
          <h3>What prune considers gone</h3>
          <p>
            Only a clear HTTP 404 untracks a repository — deleted, or private with access lost;
            GitHub makes the two indistinguishable, so prune reports{" "}
            <em>deleted or inaccessible</em> and never touches disk. Permission errors,
            authentication failures and network problems after the retry window keep the repository
            tracked, list it as <em>kept — unclear answer</em>, and make the run exit 1, so an
            unclear answer can never destroy tracking data.
          </p>
        </div>
      </div>

      <div className="panel ref-panel" id="ref-agents" data-toc-sub="AGENTS.md">
        <span className="panel-label">agents</span>
        <h3>AGENTS.md</h3>
        <p>
          Every workspace root carries an <code>AGENTS.md</code> map for coding agents. It starts
          with an auto-generated marker and is rewritten on every sync, clone, move, create and
          reorganize — do not edit it by hand (except inside the custom-instructions markers).
          Sections:
        </p>
        <ul>
          <li>
            <strong>Workspace Metadata</strong> — active preset, last sync, internal vs. community
            counts.
          </li>
          <li>
            <strong>Internal Projects</strong> / <strong>Community Repositories</strong> — every
            tracked repository with its relative path (archived/fork marks, language, alias badges).
          </li>
          <li>
            <strong>Agent Rules</strong> — each directory is an independent Git project, searches
            exclude <code>.git/</code>, <code>node_modules/</code> and <code>dist/</code>, community
            repositories are read-only references, prefer the MCP tools or CLI for workspace
            navigation.
          </li>
          <li>
            <strong>Custom Instructions</strong> — the block between{" "}
            <code>{"<!-- repotruck:custom-instructions begin -->"}</code> and{" "}
            <code>{"<!-- repotruck:custom-instructions end -->"}</code> is preserved byte-for-byte
            on every rewrite; everything else regenerates.
          </li>
        </ul>
      </div>

      <div className="panel ref-panel" id="ref-enterprise" data-toc-sub="GitHub Enterprise">
        <span className="panel-label">ghe</span>
        <h3>GitHub Enterprise</h3>
        <ul>
          <li>
            Set the endpoint globally with{" "}
            <code>repotruck config set github.baseUrl https://ghe.example.com/api/v3</code> or per
            command with <code>--base-url</code>; a bare host normalizes to its <code>/api/v3</code>{" "}
            endpoint automatically.
          </li>
          <li>
            <code>REPOTRUCK_TOKEN</code> takes highest precedence; device-flow login (
            <code>repotruck auth login --base-url &lt;url&gt;</code>) targets the enterprise
            endpoint.
          </li>
          <li>
            SSH cloning is supported for <code>github.com</code> only — Enterprise hosts clone and
            fetch over HTTPS using scoped <code>http.&lt;origin&gt;/.extraheader</code> Git
            authorization tokens.
          </li>
        </ul>
      </div>

      <div className="panel ref-panel" id="ref-transports" data-toc-sub="MCP transports">
        <span className="panel-label">transports</span>
        <h3>MCP transports</h3>
        <p>
          <code>repotruck mcp</code> speaks stdio by default (one process, one client — safe behind
          any stdio client). Streamable HTTP is opt-in; a single process serves stdio or HTTP, never
          both:
        </p>
        <ul>
          <li>
            <code>repotruck mcp --http</code> binds <code>127.0.0.1:3000</code>; <code>--port</code>{" "}
            and <code>--host</code> control the bind address.
          </li>
          <li>
            A non-localhost <code>--host</code> refuses to start without <code>--token</code>. Every
            request must then carry <code>Authorization: Bearer &lt;value&gt;</code>.
          </li>
          <li>
            On localhost without a token the server applies the MCP SDK's DNS-rebinding guards. The
            HTTP leg is stateless; long sync/clone calls stream progress over SSE.
          </li>
          <li>
            <code>--base-url &lt;url&gt;</code> points the server's GitHub calls at an enterprise
            instance.
          </li>
        </ul>
      </div>

      <div className="panel ref-panel" id="ref-apps" data-toc-sub="Custom apps">
        <span className="panel-label">apps</span>
        <h3>Custom application launchers</h3>
        <p>
          <code>repotruck open &lt;repo&gt; [app]</code> launches built-in editors and coding agents
          (<code>claude</code>, <code>codex</code>, <code>gemini</code>, <code>aider</code>,{" "}
          <code>vscode</code>, <code>cursor</code>) or any executable on your <code>PATH</code>. To
          register custom editors or tools with fixed flags, create an <code>apps.json</code> file
          in the app config dir:
        </p>
        <div className="panel terminal">
          <div className="copy-row">
            <pre className="copy-command config-snippet">
              <code>{APPS_SNIPPET}</code>
            </pre>
          </div>
        </div>
      </div>

      <div className="panel ref-panel" id="ref-env" data-toc-sub="Environment variables">
        <span className="panel-label">env</span>
        <h3>Environment variables</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Variable</th>
              <th scope="col">Effect</th>
            </tr>
          </thead>
          <tbody>
            {ENV_ROWS.map((row) => (
              <tr key={row.variable}>
                <td data-label="Variable" className="path">
                  {row.variable}
                </td>
                <td data-label="Effect">{row.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel ref-panel" id="ref-inventory" data-toc-sub="repotruck.json">
        <span className="panel-label">inventory</span>
        <h3>repotruck.json</h3>
        <p>
          The app config dir holds this single central file; schema version 1. Older file versions
          upgrade automatically; a file written by a newer repotruck is rejected with an explicit
          error instead of being reset.
        </p>
        <div className="panel terminal">
          <div className="copy-row">
            <pre className="copy-command config-snippet">
              <code>{INVENTORY_SNIPPET}</code>
            </pre>
          </div>
        </div>
        <ul>
          <li>
            <code>workspaces[]</code> — one entry per workspace, keyed by absolute <code>root</code>
            , with <code>preset</code>, <code>lastSync</code>, <code>lastUsed</code>,{" "}
            <code>aliases</code> and the repository inventory.
          </li>
          <li>
            <code>repos[]</code> — <code>owner</code>, <code>name</code>, <code>relativePath</code>{" "}
            (POSIX separators), <code>category</code> (<code>source</code> / <code>forks</code> /{" "}
            <code>archived</code>), <code>internal</code>, <code>language</code>,{" "}
            <code>updatedAt</code> and <code>custom</code> (true when manually placed).
          </li>
          <li>
            <code>aliases</code> — alias to workspace-relative path; <code>move</code> and{" "}
            <code>reorganize</code> rewrite targets automatically.
          </li>
        </ul>
      </div>

      <div className="panel ref-panel" id="ref-terminal" data-toc-sub="Terminal compatibility">
        <span className="panel-label">terminal</span>
        <h3>Terminal compatibility</h3>
        <p>
          The dashboard renders best in modern terminals such as{" "}
          <a href="https://aka.ms/terminal">Windows Terminal</a>. It requires Node.js &gt;= 26.4 or
          Bun &gt;= 1.3.14; on older Node versions use the headless commands or run via{" "}
          <code>bunx repotruck</code>.
        </p>
      </div>
    </section>
  );
}

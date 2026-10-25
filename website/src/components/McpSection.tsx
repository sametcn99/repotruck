import { useEffect, useRef, useState } from "react";
import { CopyButton } from "./CopyButton.tsx";
import { CLAUDE_CODE_ADD_COMMAND, MCP_RESOURCE_ROWS, MCP_TOOL_ROWS } from "./McpDocs.ts";

const MCP_SERVERS_CONFIG = `{
  "mcpServers": {
    "repotruck": {
      "command": "npx",
      "args": ["-y", "repotruck", "mcp"]
    }
  }
}`;

function ConfigBlock() {
  const ref = useRef<HTMLPreElement | null>(null);
  const [aligned, setAligned] = useState(true);

  useEffect(() => {
    setAligned(ref.current?.scrollWidth === ref.current?.clientWidth);
  }, []);

  return (
    <div className="panel terminal mcp-config">
      <span className="panel-label">mcp.json</span>
      <div className="copy-row">
        <pre className="copy-command config-snippet" ref={ref}>
          <code>{MCP_SERVERS_CONFIG}</code>
        </pre>
        <CopyButton command={MCP_SERVERS_CONFIG} />
      </div>
      <p className={`mcp-note${aligned ? "" : " mcp-note-wrap"}`}>
        Works with Claude Code, Cursor, VS Code and every MCP client that reads an mcpServers
        config. Authentication is shared with the CLI: run <code>gh auth login</code> once and the
        server picks up the token.
      </p>
    </div>
  );
}

export function McpSection() {
  return (
    <section className="section" id="mcp" aria-label="MCP server">
      <h2>MCP for coding agents</h2>
      <p className="section-sub">
        repotruck ships a built-in Model Context Protocol server. Connect it once and your agent
        works with the workspace through native tools — no shell acrobatics.
      </p>
      <div className="grid-2">
        <div className="panel terminal">
          <span className="panel-label">shell</span>
          <div className="copy-row">
            <span className="copy-command wrap">
              <span className="prompt">$ </span>
              {CLAUDE_CODE_ADD_COMMAND}
            </span>
            <CopyButton command={CLAUDE_CODE_ADD_COMMAND} />
          </div>
          <p className="mcp-note">
            Or add the JSON on the right to any mcpServers config (global installs can use{" "}
            <code>repotruck mcp</code> directly).
          </p>
        </div>
        <ConfigBlock />
      </div>
      <div className="panel" id="mcp-tools" data-toc-sub="Tools">
        <span className="panel-label">Tools</span>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Tool</th>
              <th scope="col">What the agent can do</th>
            </tr>
          </thead>
          <tbody>
            {MCP_TOOL_ROWS.map((row) => (
              <tr key={row.tool}>
                <td data-label="Tool" className="path">
                  {row.tool}
                </td>
                <td data-label="What the agent can do">{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel" id="mcp-resources" data-toc-sub="Resources">
        <span className="panel-label">Resources</span>
        <p className="section-sub">
          Three fixed URIs over the resolved workspace, plus a matching resource-template pair per
          registered workspace so an agent can address any workspace by its URL-encoded absolute
          root path.
        </p>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">URI</th>
              <th scope="col">Content</th>
            </tr>
          </thead>
          <tbody>
            {MCP_RESOURCE_ROWS.map((row) => (
              <tr key={row.uri}>
                <td data-label="URI" className="path">
                  {row.uri}
                </td>
                <td data-label="Content">{row.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

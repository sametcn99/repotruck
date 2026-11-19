import { useKeyboard } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { listAgentsMdTemplates } from "../../services/templates.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";

const FORMATS = ["agents", "cursor", "claude", "copilot"] as const;
type Format = (typeof FORMATS)[number];

/**
 * `repotruck instructions …` and `repotruck mcp …` as one agents page:
 * AGENTS.md template apply/clear, instruction export with per-format
 * defaults, and MCP server controls with a copyable client config.
 */
export function AgentsView({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [format, setFormat] = useState<Format>("cursor");
  const [port, setPort] = useState(3000);
  const [templates, setTemplates] = useState<readonly { name: string; description: string }[]>([]);

  useEffect(() => {
    setTemplates(
      listAgentsMdTemplates().map((t) => ({ name: t.name, description: t.description })),
    );
  }, []);

  useKeyboard((key) => {
    if (key.name === "f") setFormat(FORMATS[(FORMATS.indexOf(format) + 1) % FORMATS.length]!);
    else if (key.name === "m") void store.startMcpServer(port);
    else if (key.name === "s") store.stopMcpServer();
  });

  const mcpRunning = store.getSnapshot().activeTaskCount > 0 && store.taskLabel("mcp") !== null;
  const half = Math.max(34, Math.floor((width - 6) / 2));

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" flexGrow={1} gap={1}>
        <box border borderColor={theme.border()} flexDirection="column" width={half}>
          <text fg={theme.dim()}>{" AGENTS.md templates (instructions template)"}</text>
          {templates.map((template) => (
            <box key={template.name} flexDirection="column">
              <text fg={theme.normal()}>{` ${template.name} — ${template.description}`}</text>
              <box flexDirection="row" gap={2}>
                <text
                  fg={theme.accent()}
                  onMouseDown={(event) => {
                    event.stopPropagation?.();
                    void store.applyAgentsTemplate(template.name);
                  }}
                >
                  {"  [apply]"}
                </text>
                <text
                  fg={theme.dim()}
                  onMouseDown={(event) => {
                    event.stopPropagation?.();
                    void store.applyAgentsTemplate(template.name, true);
                  }}
                >
                  {"[clear]"}
                </text>
              </box>
            </box>
          ))}
          <text fg={theme.dim()}>{` Export (instructions export)`}</text>
          <box flexDirection="row" gap={1}>
            <text
              fg={theme.accent()}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                setFormat(FORMATS[(FORMATS.indexOf(format) + 1) % FORMATS.length]!);
              }}
            >
              {`[f] format: ${format}`}
            </text>
            <text
              fg={theme.accent()}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                void store.exportInstructions(format);
              }}
            >
              {"[export]"}
            </text>
          </box>
          <text
            fg={theme.dim()}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              store.pushStatus("DONE", "[instructions]", "regenerating AGENTS.md map");
              void store.runWorkspaceMaintenance("instructions");
            }}
          >
            {" [regenerate map]"}
          </text>
        </box>
        <box border borderColor={theme.border()} flexDirection="column" width={half}>
          <text fg={theme.dim()}>{" MCP server (repotruck mcp)"}</text>
          <text fg={mcpRunning ? theme.success() : theme.dim()}>
            {` status: ${mcpRunning ? `running on http://127.0.0.1:${port}/mcp` : "stopped"}`}
          </text>
          <box flexDirection="row" gap={1}>
            <text
              fg={theme.normal()}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                setPort(port + 100 > 9000 ? 3000 : port + 100);
              }}
            >
              {` port: ${port}`}
            </text>
            {mcpRunning ? (
              <text
                fg={theme.error()}
                onMouseDown={(event) => {
                  event.stopPropagation?.();
                  store.stopMcpServer();
                }}
              >
                {" [s] stop"}
              </text>
            ) : (
              <text
                fg={theme.accent()}
                onMouseDown={(event) => {
                  event.stopPropagation?.();
                  void store.startMcpServer(port);
                }}
              >
                {" [m] start --http"}
              </text>
            )}
          </box>
          <text
            fg={theme.accent()}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              const config = `claude mcp add repotruck --transport http --url http://127.0.0.1:${port}/mcp`;
              copyText("client config", config);
              store.pushStatus("DONE", "[mcp]", `client config copied: ${config}`);
            }}
          >
            {" [copy client config]"}
          </text>
          <text
            fg={theme.dim()}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              copyText("stdio config", "claude mcp add repotruck -- repotruck mcp");
              store.pushStatus("DONE", "[mcp]", "stdio client config copied (repotruck mcp)");
            }}
          >
            {" [stdio] copy stdio setup"}
          </text>
          <text fg={theme.dim()}>{" 25 tools · 6 resources · prompts"}</text>
        </box>
      </box>
      <text fg={theme.dim()}>
        {"f export format · m/s MCP start/stop · applies write AGENTS.md immediately · Esc cockpit"}
      </text>
    </box>
  );
}

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { listAgentsMdTemplates } from "../../services/templates.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";
import { visibleSlice } from "../windowing.ts";

const FORMATS = ["agents", "cursor", "claude", "copilot"] as const;
type Format = (typeof FORMATS)[number];

/**
 * `repotruck instructions …` and `repotruck mcp …` as one agents page:
 * AGENTS.md template apply/clear, instruction export with per-format
 * defaults, and MCP server controls with a copyable client config.
 */
export function AgentsView({
  store,
  width,
  height: heightProp,
}: {
  store: Store;
  width: number;
  height?: number;
}) {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height: termHeight } = useTerminalDimensions();
  const height = heightProp ?? Math.max(12, termHeight - 4);
  const [format, setFormat] = useState<Format>("cursor");
  const [port, setPort] = useState(3000);
  const [templates, setTemplates] = useState<readonly { name: string; description: string }[]>([]);
  const [scrollIdx, setScrollIdx] = useState(0);

  useEffect(() => {
    setTemplates(
      listAgentsMdTemplates().map((t) => ({ name: t.name, description: t.description })),
    );
  }, []);

  useKeyboard((key) => {
    if (key.name === "f") setFormat(FORMATS[(FORMATS.indexOf(format) + 1) % FORMATS.length]!);
    else if (key.name === "m") void store.startMcpServer(port);
    else if (key.name === "s") store.stopMcpServer();
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(Math.max(0, templates.length - 1), s + 1));
    }
  });

  const mcpRunning = store.getSnapshot().activeTaskCount > 0 && store.taskLabel("mcp") !== null;
  const stacked = width < 82;
  const half = stacked ? width : Math.max(20, Math.floor((width - 2) / 2));
  const templateBudget = stacked
    ? Math.max(1, Math.floor((height - 14) / 2))
    : Math.max(1, Math.floor((height - 9) / 2));
  const tplWin = visibleSlice(
    Math.min(scrollIdx, Math.max(0, templates.length - 1)),
    templates.length,
    templateBudget,
  );
  const visibleTemplates = templates.slice(tplWin.start, tplWin.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(Math.max(0, templates.length - 1), Math.max(0, s + (isUp ? -1 : 1))),
        );
      }}
    >
      <box
        flexDirection={stacked ? "column" : "row"}
        flexGrow={1}
        gap={stacked ? 0 : 1}
        width="100%"
      >
        <box
          border
          borderColor={theme.border()}
          flexDirection="column"
          width={stacked ? "100%" : half}
          overflow="hidden"
        >
          <text fg={theme.dim()} wrapMode="none">
            {" AGENTS.md templates (instructions template)"}
          </text>
          {visibleTemplates.map((template) => (
            <box key={template.name} flexDirection="column">
              <text fg={theme.normal()} wrapMode="none">
                {` ${template.name} — ${template.description}`}
              </text>
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
          <text fg={theme.dim()} wrapMode="none">{` Export (instructions export)`}</text>
          <box flexDirection="row" flexWrap="wrap" gap={1}>
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
            wrapMode="none"
            onMouseDown={(event) => {
              event.stopPropagation?.();
              store.pushStatus("DONE", "[instructions]", "regenerating AGENTS.md map");
              void store.runWorkspaceMaintenance("instructions");
            }}
          >
            {" [regenerate map]"}
          </text>
        </box>
        <box
          border
          borderColor={theme.border()}
          flexDirection="column"
          width={stacked ? "100%" : half}
          overflow="hidden"
        >
          <text fg={theme.dim()} wrapMode="none">
            {" MCP server (repotruck mcp)"}
          </text>
          <text fg={mcpRunning ? theme.success() : theme.dim()} wrapMode="none">
            {` status: ${mcpRunning ? `running on http://127.0.0.1:${port}/mcp` : "stopped"}`}
          </text>
          <box flexDirection="row" flexWrap="wrap" gap={1}>
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
            wrapMode="none"
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
            wrapMode="none"
            onMouseDown={(event) => {
              event.stopPropagation?.();
              copyText("stdio config", "claude mcp add repotruck -- repotruck mcp");
              store.pushStatus("DONE", "[mcp]", "stdio client config copied (repotruck mcp)");
            }}
          >
            {" [stdio] copy stdio setup"}
          </text>
          <text fg={theme.dim()} wrapMode="none">
            {" 25 tools · 6 resources · prompts"}
          </text>
        </box>
      </box>
      <text fg={theme.dim()} wrapMode="none">
        {"f export format · m/s MCP start/stop · applies write AGENTS.md immediately · Esc cockpit"}
      </text>
    </box>
  );
}

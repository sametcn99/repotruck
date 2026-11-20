import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { listAgentsMdTemplates } from "../../services/templates.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";
import { clampBoxLine, scrollSlice } from "../windowing.ts";

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
  const height = heightProp ?? Math.max(8, termHeight - 11);
  const [format, setFormat] = useState<Format>("cursor");
  const [port, setPort] = useState(3000);
  const [templates, setTemplates] = useState<readonly { name: string; description: string }[]>([]);
  const [scrollIdx, setScrollIdx] = useState(0);

  useEffect(() => {
    setTemplates(
      listAgentsMdTemplates().map((t) => ({ name: t.name, description: t.description })),
    );
  }, []);

  const mcpRunning = store.getSnapshot().activeTaskCount > 0 && store.taskLabel("mcp") !== null;
  const stacked = width < 82;
  const boxInnerCols = stacked
    ? Math.max(10, width - 3)
    : Math.max(10, Math.floor((width - 1) / 2) - 3);
  // Left box has 2 borders + 1 header + 3 bottom export lines = 6 fixed rows inside (height - 1) outer rows.
  const templateBudget = stacked
    ? Math.max(1, Math.floor((height - 12) / 2))
    : Math.max(1, Math.floor((height - 7) / 2));
  const maxScroll = Math.max(0, templates.length - templateBudget);

  useKeyboard((key) => {
    if (key.name === "f") setFormat(FORMATS[(FORMATS.indexOf(format) + 1) % FORMATS.length]!);
    else if (key.name === "m") void store.startMcpServer(port);
    else if (key.name === "s") store.stopMcpServer();
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, Math.min(s, maxScroll) - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(maxScroll, s + 1));
    }
  });

  const tplWin = scrollSlice(scrollIdx, templates.length, templateBudget);
  const visibleTemplates = templates.slice(tplWin.start, tplWin.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(maxScroll, Math.max(0, Math.min(s, maxScroll) + (isUp ? -1 : 1))),
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
          flexGrow={1}
          flexBasis={stacked ? undefined : 0}
          width={stacked ? "100%" : undefined}
          overflow="hidden"
        >
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {clampBoxLine(" AGENTS.md templates (instructions template)", boxInnerCols)}
          </text>
          {visibleTemplates.map((template) => (
            <box key={template.name} flexDirection="column" flexShrink={0}>
              <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
                {clampBoxLine(` ${template.name} — ${template.description}`, boxInnerCols)}
              </text>
              <box flexDirection="row" gap={2} flexShrink={0}>
                <text
                  fg={theme.accent()}
                  wrapMode="none"
                  flexShrink={0}
                  onMouseDown={(event) => {
                    event.stopPropagation?.();
                    void store.applyAgentsTemplate(template.name);
                  }}
                >
                  {"  [apply]"}
                </text>
                <text
                  fg={theme.dim()}
                  wrapMode="none"
                  flexShrink={0}
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
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {" Export (instructions export)"}
          </text>
          <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
            <text
              fg={theme.accent()}
              wrapMode="none"
              flexShrink={0}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                setFormat(FORMATS[(FORMATS.indexOf(format) + 1) % FORMATS.length]!);
              }}
            >
              {` [f] format: ${format}`}
            </text>
            <text
              fg={theme.accent()}
              wrapMode="none"
              flexShrink={0}
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
            flexShrink={0}
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
          flexGrow={1}
          flexBasis={stacked ? undefined : 0}
          width={stacked ? "100%" : undefined}
          overflow="hidden"
        >
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {clampBoxLine(" MCP server (repotruck mcp)", boxInnerCols)}
          </text>
          <text fg={mcpRunning ? theme.success() : theme.dim()} wrapMode="none" flexShrink={0}>
            {clampBoxLine(
              ` status: ${mcpRunning ? `running on http://127.0.0.1:${port}/mcp` : "stopped"}`,
              boxInnerCols,
            )}
          </text>
          <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
            <text
              fg={theme.normal()}
              wrapMode="none"
              flexShrink={0}
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
                wrapMode="none"
                flexShrink={0}
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
                wrapMode="none"
                flexShrink={0}
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
            flexShrink={0}
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
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              copyText("stdio config", "claude mcp add repotruck -- repotruck mcp");
              store.pushStatus("DONE", "[mcp]", "stdio client config copied (repotruck mcp)");
            }}
          >
            {" [stdio] copy stdio setup"}
          </text>
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {" 25 tools · 6 resources · prompts"}
          </text>
        </box>
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          "f export format · m/s MCP start/stop · applies write AGENTS.md immediately · Esc cockpit",
          width,
        )}
      </text>
    </box>
  );
}

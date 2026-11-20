import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { listAgentsMdTemplates } from "../../services/templates.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";
import { PaneTabs } from "../ui/PaneTabs.tsx";
import { clampBoxLine, visibleSlice } from "../windowing.ts";

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
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height: termHeight } = useTerminalDimensions();
  const height = heightProp ?? Math.max(8, termHeight - 11);
  const [format, setFormat] = useState<Format>("cursor");
  const [port, setPort] = useState(3000);
  const [templates, setTemplates] = useState<readonly { name: string; description: string }[]>([]);
  const [pane, setPane] = useState<"templates" | "mcp">("templates");
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    setTemplates(
      listAgentsMdTemplates().map((t) => ({ name: t.name, description: t.description })),
    );
  }, []);

  const mcpRunning = snapshot.activeTaskCount > 0 && store.taskLabel("mcp") !== null;
  const stacked = width < 82;
  const compactPanes = stacked && height < 22;
  const boxInnerCols = stacked
    ? Math.max(10, width - 3)
    : Math.max(10, Math.floor((width - 1) / 2) - 3);
  // Left box has 2 borders + 1 header + 3 bottom export lines = 6 fixed rows inside (height - 1) outer rows.
  const templateBudget = compactPanes
    ? Math.max(1, Math.floor((height - 9) / 2))
    : stacked
      ? Math.max(1, Math.floor((height - 12) / 2))
      : Math.max(1, Math.floor((height - 7) / 2));
  const maxCursor = Math.max(0, templates.length - 1);
  const clampedCursor = Math.min(cursor, maxCursor);
  const focused =
    !snapshot.navFocused &&
    snapshot.dialog === null &&
    snapshot.modal === null &&
    snapshot.contextMenu === null;

  const copyStdioConfig = () => {
    const result = copyText("stdio config", "claude mcp add repotruck -- repotruck mcp");
    store.pushStatus(
      result.ok ? "DONE" : "FAILED",
      "[mcp]",
      result.ok ? "stdio client config copied (repotruck mcp)" : result.message,
    );
  };

  useKeyboard((key) => {
    const snap = store.getSnapshot();
    if (
      snap.navFocused ||
      snap.dialog !== null ||
      snap.modal !== null ||
      snap.contextMenu !== null
    ) {
      return;
    }
    if (key.name === "tab" && compactPanes) {
      setPane(pane === "templates" ? "mcp" : "templates");
    } else if (key.name === "f") {
      setFormat(FORMATS[(FORMATS.indexOf(format) + 1) % FORMATS.length]!);
    } else if (key.name === "m") {
      void store.startMcpServer(port);
    } else if (key.name === "s") {
      store.stopMcpServer();
    } else if (key.name === "e") {
      void store.exportInstructions(format);
    } else if (key.name === "r") {
      store.pushStatus("DONE", "[instructions]", "regenerating AGENTS.md map");
      void store.runWorkspaceMaintenance("instructions");
    } else if (key.name === "p") {
      setPort((p) => (p + 100 > 9000 ? 3000 : p + 100));
    } else if (key.name === "i") {
      copyStdioConfig();
    } else if (key.name === "y") {
      const config = `claude mcp add repotruck --transport http --url http://127.0.0.1:${port}/mcp`;
      const result = copyText("client config", config);
      store.pushStatus(
        result.ok ? "DONE" : "FAILED",
        "[mcp]",
        result.ok ? `client config copied: ${config}` : result.message,
      );
    } else if (key.name === "up" || key.sequence === "k") {
      setCursor((c) => Math.max(0, Math.min(c, maxCursor) - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setCursor((c) => Math.min(maxCursor, Math.min(c, maxCursor) + 1));
    } else if (key.name === "home" || key.sequence === "g") {
      setCursor(0);
    } else if (
      key.name === "end" ||
      key.sequence === "G" ||
      (key.shift === true && key.name === "g")
    ) {
      setCursor(maxCursor);
    } else if (key.name === "return" || key.name === "space") {
      const target = templates[clampedCursor];
      if (target !== undefined) void store.applyAgentsTemplate(target.name);
    } else if (key.name === "x" || key.name === "c") {
      const target = templates[clampedCursor];
      if (target !== undefined) void store.applyAgentsTemplate(target.name, true);
    }
  });

  const tplWin = visibleSlice(clampedCursor, templates.length, templateBudget);
  const visibleTemplates = templates.slice(tplWin.start, tplWin.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) =>
          Math.min(maxCursor, Math.max(0, Math.min(c, maxCursor) + (isUp ? -1 : 1))),
        );
      }}
    >
      {compactPanes ? (
        <PaneTabs
          panes={
            [
              ["templates", "Templates"],
              ["mcp", "MCP server"],
            ] as const
          }
          selected={pane}
          onSelect={setPane}
        />
      ) : null}
      <box
        flexDirection={stacked ? "column" : "row"}
        flexGrow={1}
        gap={stacked ? 0 : 1}
        width="100%"
      >
        <box
          visible={!compactPanes || pane === "templates"}
          border
          borderColor={focused ? theme.focusBorder() : theme.border()}
          flexDirection="column"
          flexGrow={1}
          flexBasis={stacked ? undefined : 0}
          width={stacked ? "100%" : undefined}
          overflow="hidden"
        >
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {clampBoxLine(" AGENTS.md templates (instructions template)", boxInnerCols)}
          </text>
          {visibleTemplates.map((template, offset) => {
            const idx = tplWin.start + offset;
            const isCursor = focused && idx === clampedCursor;
            return (
              <box
                key={template.name}
                flexDirection="column"
                flexShrink={0}
                onMouseDown={() => setCursor(idx)}
              >
                <text
                  fg={isCursor ? theme.cursorFg() : theme.normal()}
                  bg={isCursor ? theme.cursorBg() : undefined}
                  wrapMode="none"
                  flexShrink={0}
                >
                  {clampBoxLine(
                    `${isCursor ? ">" : " "} ${template.name} — ${template.description}`,
                    boxInnerCols,
                  )}
                </text>
                <box flexDirection="row" gap={2} flexShrink={0}>
                  <text
                    fg={theme.accent()}
                    wrapMode="none"
                    flexShrink={0}
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      setCursor(idx);
                      void store.applyAgentsTemplate(template.name);
                    }}
                  >
                    {"  [Enter] Apply"}
                  </text>
                  <text
                    fg={theme.dim()}
                    wrapMode="none"
                    flexShrink={0}
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      setCursor(idx);
                      void store.applyAgentsTemplate(template.name, true);
                    }}
                  >
                    {"[x:clear]"}
                  </text>
                </box>
              </box>
            );
          })}
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
              {"[e] export"}
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
            {" [r] regenerate map"}
          </text>
        </box>
        <box
          visible={!compactPanes || pane === "mcp"}
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
                setPort((p) => (p + 100 > 9000 ? 3000 : p + 100));
              }}
            >
              {` [p] port: ${port}`}
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
              const result = copyText("client config", config);
              store.pushStatus(
                result.ok ? "DONE" : "FAILED",
                "[mcp]",
                result.ok ? `client config copied: ${config}` : result.message,
              );
            }}
          >
            {" [y] copy client config"}
          </text>
          <text
            fg={theme.dim()}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              copyStdioConfig();
            }}
          >
            {" [i] Copy stdio setup"}
          </text>
        </box>
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          "↑↓/jk move · Enter apply · x clear · f format · e export · m/s MCP · Esc cockpit",
          width,
        )}
      </text>
    </box>
  );
}

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import {
  type DiagLevel,
  diagClear,
  diagSnapshot,
  diagSubscribe,
} from "../../services/diagnostics.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyJson } from "../ui/JsonCopy.ts";
import { clampBoxLine, scrollSlice } from "../windowing.ts";

function levelFg(level: DiagLevel): string | undefined {
  if (level === "error") return theme.error();
  if (level === "warn") return theme.warning();
  return theme.dim();
}

function levelTag(level: DiagLevel): string {
  if (level === "error") return "ERR";
  if (level === "warn") return "WRN";
  return "INF";
}

/**
 * The diagnostics log as a page: every captured error/warning (runtime
 * handlers, Octokit request failures, warnQuiet calls and FAILED activity
 * statuses) newest-first, with clear and copy-as-JSON.
 */
export function LogView({
  store,
  width,
  height: heightProp,
}: {
  store: Store;
  width: number;
  height?: number;
}) {
  const entries = useSyncExternalStore(diagSubscribe, diagSnapshot);
  const { height: termHeight } = useTerminalDimensions();
  const height = heightProp ?? Math.max(8, termHeight - 11);
  const [scrollIdx, setScrollIdx] = useState(0);

  const boxInnerCols = Math.max(10, width - 3);
  // Box chrome: 2 borders + 1 header line + 1 footer hint = 4 non-entry rows.
  const viewportRows = Math.max(1, height - 4);
  const rows = [...entries].reverse();
  const win = scrollSlice(scrollIdx, rows.length, viewportRows);
  const visible = rows.slice(win.start, win.end);

  const counts = { error: 0, warn: 0, info: 0 };
  for (const entry of entries) counts[entry.level] += 1;

  useKeyboard((key) => {
    if (key.name === "c") {
      diagClear();
      setScrollIdx(0);
    } else if (key.name === "J" || key.sequence === "J") {
      const result = copyJson("log", {
        command: "log",
        ok: true,
        entries: entries.map((entry) => ({
          ts: entry.ts,
          level: entry.level,
          source: entry.source,
          message: entry.message,
        })),
      });
      store.pushStatus(result.ok ? "DONE" : "FAILED", "[log]", result.message);
    } else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(Math.max(0, rows.length - 1), s + 1));
    }
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(Math.max(0, rows.length - 1), Math.max(0, s + (isUp ? -1 : 1))),
        );
      }}
    >
      <box
        border
        borderColor={counts.error > 0 ? theme.error() : theme.border()}
        flexDirection="column"
        flexGrow={1}
        width="100%"
        padding={0}
        overflow="hidden"
      >
        <text fg={counts.error > 0 ? theme.error() : theme.dim()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(
            ` diagnostics log · ${entries.length} entries · ${counts.error} errors · ${counts.warn} warnings${
              rows.length > viewportRows
                ? ` (showing ${win.start + 1}-${win.end}/${rows.length})`
                : ""
            }`,
            boxInnerCols,
          )}
        </text>
        {visible.length === 0 ? (
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {"  no diagnostics captured yet"}
          </text>
        ) : (
          visible.map((entry) => (
            <text key={entry.id} fg={levelFg(entry.level)} wrapMode="none" flexShrink={0}>
              {clampBoxLine(
                ` ${entry.ts.slice(11, 19)} ${levelTag(entry.level)} ${entry.source}${
                  entry.message.length > 0 ? ` — ${entry.message}` : ""
                }`,
                boxInnerCols,
              )}
            </text>
          ))
        )}
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine("newest first · j/k scroll · c clear · J copy JSON · Esc cockpit", width)}
      </text>
    </box>
  );
}

import { spawn } from "node:child_process";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { clampBoxLine, visibleSlice } from "../windowing.ts";

/**
 * `repotruck sync resolve` as a page: repositories that ended a sync in a
 * conflict/rebase state, the resolution guide, and continue/abort actions
 * executed with git in the repository directory.
 */
export function ConflictResolverView({
  store,
  width,
  height: heightProp,
}: {
  store: Store;
  width?: number;
  height?: number;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { width: termWidth, height: termHeight } = useTerminalDimensions();
  const height = heightProp ?? Math.max(8, termHeight - 11);
  const effectiveWidth = width ?? Math.max(24, termWidth - 4);
  const boxInnerCols = Math.max(10, effectiveWidth - 3);
  const [output, setOutput] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    setOutput((current) =>
      current.length === 0
        ? [
            "run a sync with divergence=rebase to see conflicts here; FAILED rows below also list candidates",
          ]
        : current,
    );
  }, []);

  const failed = snapshot.statuses.filter((entry) => entry.phase === "FAILED").slice(-12);
  // Fixed rows: title (1) + top box borders/header (3) + action row (1) + bottom box borders/header/3 workflow lines (6) + footer (1) = 12.
  const dynamicBudget = Math.max(2, height - 12);
  const outputUsed = Math.min(
    Math.max(1, output.length),
    Math.max(1, Math.floor(dynamicBudget / 2)),
  );
  const failedCap = Math.max(1, dynamicBudget - outputUsed);
  const actualFailedRows = Math.max(1, Math.min(failed.length, failedCap));
  const outputCap = Math.max(1, dynamicBudget - actualFailedRows);
  const maxCursor = Math.max(0, failed.length - 1);
  const clampedCursor = Math.min(cursor, maxCursor);
  const failedWin = visibleSlice(clampedCursor, failed.length, failedCap);
  const visibleFailed = failed.slice(failedWin.start, failedWin.end);
  const focused =
    !snapshot.navFocused &&
    snapshot.dialog === null &&
    snapshot.modal === null &&
    snapshot.contextMenu === null;

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
    if (key.name === "g" && !key.shift) {
      void gitAll(store, "continue", setOutput);
    } else if (key.name === "a") {
      void gitAll(store, "abort", setOutput);
    } else if (key.name === "up" || key.sequence === "k") {
      setCursor((c) => Math.max(0, Math.min(c, maxCursor) - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setCursor((c) => Math.min(maxCursor, Math.min(c, maxCursor) + 1));
    } else if (key.name === "home") {
      setCursor(0);
    } else if (
      key.name === "end" ||
      key.sequence === "G" ||
      (key.shift === true && key.name === "g")
    ) {
      setCursor(maxCursor);
    } else if (key.name === "pageup") {
      setCursor((c) => Math.max(0, Math.min(c, maxCursor) - Math.max(1, failedCap)));
    } else if (key.name === "pagedown") {
      setCursor((c) => Math.min(maxCursor, Math.min(c, maxCursor) + Math.max(1, failedCap)));
    } else if (key.name === "o" || key.name === "return") {
      const target = failed[clampedCursor];
      if (target !== undefined) store.openDetailModal(target.key);
    }
  });

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
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {" Conflicts — sync resolve"}
      </text>
      <box
        border
        borderColor={focused ? theme.focusBorder() : theme.border()}
        flexDirection="column"
        width="100%"
        padding={0}
        overflow="hidden"
        flexShrink={0}
      >
        <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(
            ` recent failures (${failed.length})${
              failed.length > failedCap ? ` · showing ${failedWin.start + 1}-${failedWin.end}` : ""
            }:`,
            boxInnerCols,
          )}
        </text>
        {failed.length === 0 ? (
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {"  none — last sync was clean"}
          </text>
        ) : (
          visibleFailed.map((entry, offset) => {
            const idx = failedWin.start + offset;
            const isCursor = focused && idx === clampedCursor;
            return (
              <text
                key={`${entry.id}`}
                fg={isCursor ? theme.cursorFg() : theme.error()}
                bg={isCursor ? theme.cursorBg() : undefined}
                wrapMode="none"
                flexShrink={0}
                onMouseDown={() => {
                  setCursor(idx);
                  store.openDetailModal(entry.key);
                }}
              >
                {clampBoxLine(
                  `${isCursor ? ">" : " "}✗ ${entry.key} — ${entry.message ?? "failed"}`,
                  boxInnerCols,
                )}
              </text>
            );
          })
        )}
      </box>
      <box flexDirection="row" flexWrap="wrap" gap={2} flexShrink={0}>
        <text
          fg={theme.accent()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            void gitAll(store, "continue", setOutput);
          }}
        >
          {"[g] git rebase --continue"}
        </text>
        <text
          fg={theme.error()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            void gitAll(store, "abort", setOutput);
          }}
        >
          {"[a] git rebase --abort"}
        </text>
      </box>
      <box
        border
        borderColor={theme.border()}
        flexDirection="column"
        flexGrow={1}
        width="100%"
        padding={0}
        overflow="hidden"
      >
        <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
          {" Resolution output & workflow"}
        </text>
        {(() => {
          const seen = new Map<string, number>();
          return output.slice(0, outputCap).map((line) => {
            const count = (seen.get(line) ?? 0) + 1;
            seen.set(line, count);
            return (
              <text key={`${line}#${count}`} fg={theme.dim()} wrapMode="none" flexShrink={0}>
                {clampBoxLine(` ${line}`, boxInnerCols)}
              </text>
            );
          });
        })()}
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(
            " 1. inspect conflicting files via [o] / Enter or open via cockpit [o]",
            boxInnerCols,
          )}
        </text>
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(
            " 2. stage resolved files (git add <file>), then press [g] to continue rebase",
            boxInnerCols,
          )}
        </text>
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(
            " 3. or press [a] to abort the rebase and restore the pre-sync branch state",
            boxInnerCols,
          )}
        </text>
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          "↑↓/jk select · o/Enter detail · g continue · a abort · Esc cockpit",
          effectiveWidth,
        )}
      </text>
    </box>
  );
}

async function gitAll(
  store: Store,
  action: "continue" | "abort",
  setOutput: (lines: string[]) => void,
): Promise<void> {
  const snapshot = store.getSnapshot();
  const failed = snapshot.statuses.filter((entry) => entry.phase === "FAILED").slice(-12);
  const lines: string[] = [];
  for (const entry of failed) {
    const health = snapshot.localHealth.get(entry.key);
    if (health?.relativePath == null) {
      lines.push(`${entry.key}: no local path — skipped`);
      continue;
    }
    const dir = `${store.root}/${health.relativePath}`;
    lines.push(`${entry.key}: git rebase --${action} …`);
    try {
      const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = spawn("git", [`rebase`, `--${action}`], { cwd: dir });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("close", (code) => resolve({ code, stderr }));
      });
      lines.push(
        `${entry.key}: ${result.code === 0 ? "ok" : `exit ${result.code}${result.stderr ? ` — ${result.stderr.split("\n")[0]}` : ""}`}`,
      );
    } catch (error) {
      lines.push(`${entry.key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (lines.length === 0) lines.push("no failed repositories to resolve");
  setOutput(lines);
  store.pushStatus(
    "DONE",
    "[resolve]",
    `sync resolve --action ${action} applied to ${failed.length} repo(s)`,
  );
}

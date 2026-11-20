import { spawn } from "node:child_process";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { PaneTabs } from "../ui/PaneTabs.tsx";
import { clampBoxLine, scrollSlice, visibleSlice } from "../windowing.ts";

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
  const [pane, setPane] = useState<"failures" | "output">("failures");
  const [outputOffset, setOutputOffset] = useState(0);

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
  const compact = height < 16;
  const failedCap = Math.max(1, compact ? height - 5 : Math.floor((height - 8) / 2));
  const outputCap = Math.max(
    1,
    compact ? height - 5 : height - 8 - Math.min(failedCap, Math.max(1, failed.length)),
  );
  const guide = [
    "Inspect conflicting files with o or Enter.",
    "Stage resolved files with git add, then press g to continue.",
    "Press a to abort the rebase and restore the pre-sync branch.",
  ];
  const outputRows = [...output, ...guide];
  const outputWin = scrollSlice(outputOffset, outputRows.length, outputCap);
  const moveOutput = (delta: number) =>
    setOutputOffset(Math.max(0, Math.min(outputRows.length - outputCap, outputWin.start + delta)));

  const resolve = (action: "continue" | "abort") => {
    setOutputOffset(0);
    setPane("output");
    void gitAll(store, action, setOutput);
  };

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
    if (key.name === "tab") {
      setPane(pane === "failures" ? "output" : "failures");
    } else if (key.name === "g" && !key.shift) {
      resolve("continue");
    } else if (key.name === "a") {
      resolve("abort");
    } else if (pane === "output") {
      if (key.name === "up" || key.sequence === "k") moveOutput(-1);
      else if (key.name === "down" || key.sequence === "j") moveOutput(1);
      else if (key.name === "pageup") moveOutput(-outputCap);
      else if (key.name === "pagedown") moveOutput(outputCap);
      else if (key.name === "home") setOutputOffset(0);
      else if (key.name === "end") moveOutput(outputRows.length);
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
        if (pane === "output") {
          moveOutput(isUp ? -1 : 1);
          return;
        }
        setCursor((c) =>
          Math.min(maxCursor, Math.max(0, Math.min(c, maxCursor) + (isUp ? -1 : 1))),
        );
      }}
    >
      <PaneTabs
        panes={
          [
            ["failures", "Failures"],
            ["output", "Resolution output"],
          ] as const
        }
        selected={pane}
        onSelect={setPane}
      />
      <box
        border
        visible={!compact || pane === "failures"}
        borderColor={focused && pane === "failures" ? theme.focusBorder() : theme.border()}
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
            const isCursor = focused && pane === "failures" && idx === clampedCursor;
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
            resolve("continue");
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
            resolve("abort");
          }}
        >
          {"[a] git rebase --abort"}
        </text>
      </box>
      <box
        visible={!compact || pane === "output"}
        border
        borderColor={focused && pane === "output" ? theme.focusBorder() : theme.border()}
        flexDirection="column"
        flexGrow={1}
        width="100%"
        overflow="hidden"
      >
        <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
          {` Resolution output · ${outputWin.start + 1}–${outputWin.end}/${outputRows.length}`}
        </text>
        {outputRows.slice(outputWin.start, outputWin.end).map((line, offset) => (
          <text
            // biome-ignore lint/suspicious/noArrayIndexKey: output is sequential text
            key={outputWin.start + offset}
            fg={theme.dim()}
            wrapMode="none"
            flexShrink={0}
          >
            {clampBoxLine(` ${line}`, boxInnerCols)}
          </text>
        ))}
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          pane === "output" ? "↑↓ scroll · PgUp / PgDn page" : "↑↓ select · [Enter] Details",
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

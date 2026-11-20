import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";
import { renderMarkdownLines } from "../ui/MarkdownPane.tsx";
import { clampBoxLine, scrollSlice, visibleSlice } from "../windowing.ts";

/**
 * `repotruck changelog` as a page: since/until/author/repo filter form,
 * markdown preview and copy-to-clipboard.
 */
export function ChangelogView({
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
  const page = snapshot.changelogPage;
  const [scrollIdx, setScrollIdx] = useState(0);

  useEffect(() => {
    if (page === null) void store.generateChangelog({});
  }, [page, store]);

  const styledLines = page !== null ? renderMarkdownLines(page.markdown, width) : [];
  // Fixed rows outside the inner box's text rows: range row (1) + box borders (2) + footer hint (1) = 4.
  // When styledLines overflows, the "… N more lines" row takes 1 additional row (= 5).
  const fullBoxRows = Math.max(1, height - 4);
  const hasOverflow = styledLines.length > fullBoxRows;
  const viewportRows = hasOverflow ? Math.max(1, height - 5) : fullBoxRows;
  const maxScroll = Math.max(0, styledLines.length - viewportRows);
  const win = scrollSlice(scrollIdx, styledLines.length, viewportRows);
  const preview = styledLines.slice(win.start, win.end);
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
    if (key.sequence === "7") {
      setScrollIdx(0);
      void store.generateChangelog({ since: "7 days ago" });
    } else if (key.name === "g" && !key.shift) {
      setScrollIdx(0);
      void store.generateChangelog({ since: "14 days ago" });
    } else if (key.name === "m") {
      setScrollIdx(0);
      void store.generateChangelog({ since: "30 days ago" });
    } else if (key.name === "c" && page !== null) {
      const result = copyText("changelog", page.markdown);
      store.pushStatus(result.ok ? "DONE" : "FAILED", "[changelog]", result.message);
    } else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, Math.min(s, maxScroll) - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(maxScroll, s + 1));
    } else if (key.name === "home") {
      setScrollIdx(0);
    } else if (
      key.name === "end" ||
      key.sequence === "G" ||
      (key.shift === true && key.name === "g")
    ) {
      setScrollIdx(maxScroll);
    } else if (key.name === "pageup") {
      setScrollIdx((s) => Math.max(0, Math.min(s, maxScroll) - Math.max(1, viewportRows)));
    } else if (key.name === "pagedown") {
      setScrollIdx((s) => Math.min(maxScroll, s + Math.max(1, viewportRows)));
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
          Math.min(maxScroll, Math.max(0, Math.min(s, maxScroll) + (isUp ? -2 : 2))),
        );
      }}
    >
      <box flexDirection="row" flexWrap="wrap" gap={2} flexShrink={0}>
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {"range:"}
        </text>
        <text
          fg={theme.accent()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            setScrollIdx(0);
            void store.generateChangelog({ since: "7 days ago" });
          }}
        >
          {"[7d]"}
        </text>
        <text
          fg={theme.accent()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            setScrollIdx(0);
            void store.generateChangelog({ since: "14 days ago" });
          }}
        >
          {"[g · 14d]"}
        </text>
        <text
          fg={theme.accent()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            setScrollIdx(0);
            void store.generateChangelog({ since: "30 days ago" });
          }}
        >
          {"[m · 30d]"}
        </text>
        {page !== null ? (
          <text
            fg={theme.dim()}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation();
              const result = copyText("changelog", page.markdown);
              store.pushStatus(result.ok ? "DONE" : "FAILED", "[changelog]", result.message);
            }}
          >
            {"[c · copy]"}
          </text>
        ) : null}
      </box>
      <box
        border
        borderColor={focused ? theme.focusBorder() : theme.border()}
        flexDirection="column"
        flexGrow={1}
        width="100%"
        padding={0}
        overflow="hidden"
      >
        {preview.length === 0 ? (
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {" no commits in range (or not a git workspace yet)"}
          </text>
        ) : (
          (() => {
            const seen = new Map<string, number>();
            return preview.map((line) => {
              const count = (seen.get(line.text) ?? 0) + 1;
              seen.set(line.text, count);
              return (
                <text
                  key={`${line.text}#${count}`}
                  fg={line.fg ?? theme.normal()}
                  wrapMode="none"
                  flexShrink={0}
                >
                  {` ${line.text}`}
                </text>
              );
            });
          })()
        )}
      </box>
      {hasOverflow ? (
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {`… ${styledLines.length - preview.length} more lines (full markdown via copy)`}
        </text>
      ) : null}
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine("↑↓/jk/PgUpDn scroll · 7 7d · g 14d · m 30d · c copy · Esc cockpit", width)}
      </text>
    </box>
  );
}

/**
 * `repotruck scan` (+ adopt) and `prune` as a page.
 */
export function ScanAdoptView({
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
  const page = snapshot.scanPage;
  const unregistered = page?.unregistered ?? [];
  const [cursor, setCursor] = useState(0);

  // Action row (1) + box borders (2) + box header line (1) + footer hint (1) = 5 non-data rows.
  const viewportRows = Math.max(1, height - 5);
  const maxCursor = Math.max(0, unregistered.length - 1);
  const clampedCursor = Math.min(cursor, maxCursor);
  const win = visibleSlice(clampedCursor, unregistered.length, viewportRows);
  const visibleUnregistered = unregistered.slice(win.start, win.end);
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
    if (key.name === "s") {
      void store.scanAndAdopt(false);
    } else if (key.name === "a") {
      void store.scanAndAdopt(true);
    } else if (key.name === "p") {
      store.pruneWorkspaceConfirm();
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
    } else if (key.name === "pageup") {
      setCursor((c) => Math.max(0, Math.min(c, maxCursor) - Math.max(1, viewportRows)));
    } else if (key.name === "pagedown") {
      setCursor((c) => Math.min(maxCursor, Math.min(c, maxCursor) + Math.max(1, viewportRows)));
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
          Math.min(maxCursor, Math.max(0, Math.min(c, maxCursor) + (isUp ? -2 : 2))),
        );
      }}
    >
      <box flexDirection="row" flexWrap="wrap" gap={2} flexShrink={0}>
        <text
          fg={theme.accent()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.scanAndAdopt(false);
          }}
        >
          {"[s] scan"}
        </text>
        <text
          fg={theme.accent()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            store.confirmDialog(
              {
                title: "Adopt unregistered repos",
                message: "Move unregistered repositories into the preset layout? (scan --move)",
                confirmLabel: "Adopt",
              },
              () => {
                void store.scanAndAdopt(true);
              },
            );
          }}
        >
          {"[a] adopt (--move)"}
        </text>
        <text
          fg={theme.error()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            store.pruneWorkspaceConfirm();
          }}
        >
          {"[p] prune untrack deleted"}
        </text>
      </box>
      <box
        border
        borderColor={focused ? theme.focusBorder() : theme.border()}
        flexDirection="column"
        flexGrow={1}
        width="100%"
        padding={0}
        overflow="hidden"
      >
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(
            ` unregistered repositories (${unregistered.length} discovered):`,
            boxInnerCols,
          )}
        </text>
        {unregistered.length === 0 ? (
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {"  (none discovered yet — run a scan)"}
          </text>
        ) : (
          visibleUnregistered.map((line, offset) => {
            const idx = win.start + offset;
            const isCursor = focused && idx === clampedCursor;
            return (
              <text
                key={line}
                fg={isCursor ? theme.cursorFg() : theme.normal()}
                bg={isCursor ? theme.cursorBg() : undefined}
                wrapMode="none"
                flexShrink={0}
                onMouseDown={() => setCursor(idx)}
              >
                {clampBoxLine(`${isCursor ? ">" : " "}• ${line}`, boxInnerCols)}
              </text>
            );
          })
        )}
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine("↑↓/jk move · s scan · a adopt · p prune · Esc cockpit", effectiveWidth)}
      </text>
    </box>
  );
}

/**
 * `repotruck worktree scan` as a page: every linked worktree with its
 * parent repository; per-repo management stays in the W modal.
 */
export function WorktreesView({
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
  const page = snapshot.worktreePage;
  const rows = page?.rows ?? [];
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (page === null) void store.scanWorkspaceWorktrees();
  }, [page, store]);

  // Action row (1) + box borders (2) + box header line (1) + footer hint (1) = 5 non-data rows.
  const viewportRows = Math.max(1, height - 5);
  const maxCursor = Math.max(0, rows.length - 1);
  const clampedCursor = Math.min(cursor, maxCursor);
  const win = visibleSlice(clampedCursor, rows.length, viewportRows);
  const visibleRows = rows.slice(win.start, win.end);
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
    if (key.name === "s") {
      void store.scanWorkspaceWorktrees();
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
    } else if (key.name === "pageup") {
      setCursor((c) => Math.max(0, Math.min(c, maxCursor) - Math.max(1, viewportRows)));
    } else if (key.name === "pagedown") {
      setCursor((c) => Math.min(maxCursor, Math.min(c, maxCursor) + Math.max(1, viewportRows)));
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
          Math.min(maxCursor, Math.max(0, Math.min(c, maxCursor) + (isUp ? -2 : 2))),
        );
      }}
    >
      <box flexDirection="row" flexWrap="wrap" gap={2} flexShrink={0}>
        <text
          fg={theme.accent()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.scanWorkspaceWorktrees();
          }}
        >
          {"[s] scan workspace worktrees"}
        </text>
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {`${rows.length} linked worktree(s)`}
        </text>
      </box>
      <box
        border
        borderColor={focused ? theme.focusBorder() : theme.border()}
        flexDirection="column"
        flexGrow={1}
        width="100%"
        padding={0}
        overflow="hidden"
      >
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(" parent repo · branch · linked checkout path", boxInnerCols)}
        </text>
        {rows.length === 0 ? (
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {"  no scan yet — run [s] (worktree scan)"}
          </text>
        ) : (
          visibleRows.map((row, offset) => {
            const idx = win.start + offset;
            const isCursor = focused && idx === clampedCursor;
            return (
              <text
                key={row}
                fg={isCursor ? theme.cursorFg() : theme.normal()}
                bg={isCursor ? theme.cursorBg() : undefined}
                wrapMode="none"
                flexShrink={0}
                onMouseDown={() => setCursor(idx)}
              >
                {clampBoxLine(`${isCursor ? ">" : " "}⑂ ${row}`, boxInnerCols)}
              </text>
            );
          })
        )}
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          "↑↓/jk move · s scan · per-repo create/remove lives in W modal · Esc cockpit",
          effectiveWidth,
        )}
      </text>
    </box>
  );
}

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { renderMarkdownLines } from "../ui/MarkdownPane.tsx";
import { visibleSlice } from "../windowing.ts";

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
  const height = heightProp ?? Math.max(12, termHeight - 4);
  const page = snapshot.changelogPage;
  const [scrollIdx, setScrollIdx] = useState(0);

  useEffect(() => {
    if (page === null) void store.generateChangelog({});
  }, [page, store]);

  const styledLines = page !== null ? renderMarkdownLines(page.markdown, width) : [];
  const viewportRows = Math.max(3, Math.min(28, height - 9));
  const boundedScroll = Math.min(Math.max(0, scrollIdx), Math.max(0, styledLines.length - 1));
  const win = visibleSlice(boundedScroll, styledLines.length, viewportRows);
  const preview = styledLines.slice(win.start, win.end);

  useKeyboard((key) => {
    if (key.name === "g") void store.generateChangelog({ since: "14 days ago" });
    else if (key.name === "m") void store.generateChangelog({ since: "30 days ago" });
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(Math.max(0, styledLines.length - 1), s + 1));
    }
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      gap={height < 20 ? 0 : 1}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(Math.max(0, styledLines.length - 1), Math.max(0, s + (isUp ? -2 : 2))),
        );
      }}
    >
      <box flexDirection="row" flexWrap="wrap" gap={2}>
        <text fg={theme.dim()}>{"range:"}</text>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.generateChangelog({ since: "7 days ago" });
          }}
        >
          {"[7d]"}
        </text>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.generateChangelog({ since: "14 days ago" });
          }}
        >
          {"[g · 14d]"}
        </text>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.generateChangelog({ since: "30 days ago" });
          }}
        >
          {"[m · 30d]"}
        </text>
      </box>
      <box
        border
        borderColor={theme.border()}
        flexDirection="column"
        flexGrow={1}
        padding={0}
        overflow="hidden"
      >
        {preview.length === 0 ? (
          <text fg={theme.dim()} wrapMode="none">
            {" no commits in range (or not a git workspace yet)"}
          </text>
        ) : (
          (() => {
            const seen = new Map<string, number>();
            return preview.map((line) => {
              const count = (seen.get(line.text) ?? 0) + 1;
              seen.set(line.text, count);
              return (
                <text key={`${line.text}#${count}`} fg={line.fg ?? theme.normal()} wrapMode="none">
                  {` ${line.text}`}
                </text>
              );
            });
          })()
        )}
      </box>
      {styledLines.length > viewportRows ? (
        <text fg={theme.dim()} wrapMode="none">
          {`… ${styledLines.length - viewportRows} more lines (full markdown via copy)`}
        </text>
      ) : null}
      <text fg={theme.dim()} wrapMode="none">
        {"g 14d · m 30d · Esc cockpit"}
      </text>
    </box>
  );
}

/**
 * `repotruck scan` (+ adopt) and `prune` as a page.
 */
export function ScanAdoptView({
  store,
  height: heightProp,
}: {
  store: Store;
  width?: number;
  height?: number;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height: termHeight } = useTerminalDimensions();
  const height = heightProp ?? Math.max(12, termHeight - 4);
  const page = snapshot.scanPage;
  const unregistered = page?.unregistered ?? [];
  const [scrollIdx, setScrollIdx] = useState(0);

  const viewportRows = Math.max(2, height - 9);
  const boundedScroll = Math.min(Math.max(0, scrollIdx), Math.max(0, unregistered.length - 1));
  const win = visibleSlice(boundedScroll, unregistered.length, viewportRows);
  const visibleUnregistered = unregistered.slice(win.start, win.end);

  useKeyboard((key) => {
    if (key.name === "s") void store.scanAndAdopt(false);
    else if (key.name === "a") void store.scanAndAdopt(true);
    else if (key.name === "p") store.pruneWorkspaceConfirm();
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(Math.max(0, unregistered.length - 1), s + 1));
    }
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      gap={height < 20 ? 0 : 1}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(Math.max(0, unregistered.length - 1), Math.max(0, s + (isUp ? -2 : 2))),
        );
      }}
    >
      <box flexDirection="row" flexWrap="wrap" gap={2}>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.scanAndAdopt(false);
          }}
        >
          {"[s] scan"}
        </text>
        <text
          fg={theme.accent()}
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
        borderColor={theme.border()}
        flexDirection="column"
        flexGrow={1}
        padding={0}
        overflow="hidden"
      >
        <text fg={theme.dim()} wrapMode="none">
          {` unregistered repositories (${unregistered.length} discovered):`}
        </text>
        {unregistered.length === 0 ? (
          <text fg={theme.dim()} wrapMode="none">
            {"  (none discovered yet — run a scan)"}
          </text>
        ) : (
          visibleUnregistered.map((line) => (
            <text key={line} fg={theme.normal()} wrapMode="none">
              {` • ${line}`}
            </text>
          ))
        )}
      </box>
      <text fg={theme.dim()} wrapMode="none">
        {"adopt is confirm-guarded · prune keeps unclear answers · Esc cockpit"}
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
  height: heightProp,
}: {
  store: Store;
  width?: number;
  height?: number;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height: termHeight } = useTerminalDimensions();
  const height = heightProp ?? Math.max(12, termHeight - 4);
  const page = snapshot.worktreePage;
  const rows = page?.rows ?? [];
  const [scrollIdx, setScrollIdx] = useState(0);

  useEffect(() => {
    if (page === null) void store.scanWorkspaceWorktrees();
  }, [page, store]);

  const viewportRows = Math.max(2, height - 9);
  const boundedScroll = Math.min(Math.max(0, scrollIdx), Math.max(0, rows.length - 1));
  const win = visibleSlice(boundedScroll, rows.length, viewportRows);
  const visibleRows = rows.slice(win.start, win.end);

  useKeyboard((key) => {
    if (key.name === "s") void store.scanWorkspaceWorktrees();
    else if (key.name === "up" || key.sequence === "k") {
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
      gap={height < 20 ? 0 : 1}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(Math.max(0, rows.length - 1), Math.max(0, s + (isUp ? -2 : 2))),
        );
      }}
    >
      <box flexDirection="row" flexWrap="wrap" gap={2}>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.scanWorkspaceWorktrees();
          }}
        >
          {"[s] scan workspace worktrees"}
        </text>
        <text fg={theme.dim()}>{`${rows.length} linked worktree(s)`}</text>
      </box>
      <box
        border
        borderColor={theme.border()}
        flexDirection="column"
        flexGrow={1}
        padding={0}
        overflow="hidden"
      >
        <text fg={theme.dim()} wrapMode="none">
          {" parent repo · branch · linked checkout path"}
        </text>
        {rows.length === 0 ? (
          <text fg={theme.dim()} wrapMode="none">
            {"  no scan yet — run [s] (worktree scan)"}
          </text>
        ) : (
          visibleRows.map((row) => (
            <text key={row} fg={theme.normal()} wrapMode="none">
              {` ⑂ ${row}`}
            </text>
          ))
        )}
      </box>
      <text fg={theme.dim()} wrapMode="none">
        {"per-repo create/remove lives in the W modal (force option in its confirm) · Esc cockpit"}
      </text>
    </box>
  );
}

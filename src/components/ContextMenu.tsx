import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { repoViewportRows, visibleSlice } from "./windowing.ts";

interface MenuEntry {
  id: string;
  label: string;
  keyHint: string;
  danger?: boolean;
}

const ENTRIES: readonly MenuEntry[] = [
  { id: "detail", label: "Details", keyHint: "i" },
  { id: "open", label: "Open in app…", keyHint: "o" },
  { id: "sync", label: "Sync this repo", keyHint: "Enter" },
  { id: "move", label: "Move to path…", keyHint: "m" },
  { id: "alias", label: "Set alias…", keyHint: "r" },
  { id: "pin", label: "Pin / unpin", keyHint: "P" },
  { id: "worktree", label: "Worktrees…", keyHint: "W" },
  { id: "resolve", label: "Resolve conflicts…", keyHint: "v x" },
  { id: "archive", label: "Archive on GitHub", keyHint: "A" },
  { id: "untrack", label: "Untrack (keep files)", keyHint: "u" },
  { id: "delete", label: "Delete → trash", keyHint: "D", danger: true },
  { id: "delete-permanent", label: "Delete permanently", keyHint: "del --yes", danger: true },
];

function clampMenuLine(raw: string, maxCols: number): string {
  if (raw.length <= maxCols) return raw;
  return `${raw.slice(0, Math.max(1, maxCols - 1))}…`;
}

/**
 * Repo context menu: every repo-targeted action in one discoverable list,
 * opened with the right arrow on the cursor row or a right-click. Menu
 * items dispatch through the store with the selection focused on the
 * target so batch confirms behave.
 */
export function ContextMenu({
  store,
  width = 34,
  extraReservedRows = 0,
}: {
  store: Store;
  width?: number;
  extraReservedRows?: number;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height } = useTerminalDimensions();
  const menu = snapshot.contextMenu;
  const open = menu !== null;
  const [cursor, setCursor] = useState(0);
  const bounded = Math.min(Math.max(cursor, 0), ENTRIES.length - 1);

  useKeyboard((key) => {
    if (!open) return;
    if (key.name === "escape" || key.name === "left") {
      store.closeRepoContextMenu();
      return;
    }
    if (key.name === "up" || key.sequence === "k") {
      setCursor((c) => (c - 1 + ENTRIES.length) % ENTRIES.length);
    } else if (key.name === "down" || key.sequence === "j") {
      setCursor((c) => (c + 1) % ENTRIES.length);
    } else if (key.name === "return" || key.name === "space") {
      const target = ENTRIES[bounded];
      if (target !== undefined) store.executeContextAction(target.id);
    }
  });

  if (!open || menu === null) return null;

  const innerCols = Math.max(16, width - 2);
  const labelWidth = Math.max(12, Math.min(21, innerCols - 11));
  const bodyRows = Math.max(
    3,
    repoViewportRows(height, snapshot.updateToast !== null || snapshot.toast !== null) +
      1 -
      extraReservedRows,
  );
  // Reserve 1 row for repo key header and 1 row for footer hint if space allows
  const showHint = bodyRows >= 6;
  const entryViewport = Math.max(2, bodyRows - 1 - (showHint ? 1 : 0));
  const { start, end } = visibleSlice(bounded, ENTRIES.length, entryViewport);
  const visibleEntries = ENTRIES.slice(start, end);

  return (
    <box
      title="Actions"
      border
      borderColor={theme.focusBorder()}
      flexDirection="column"
      padding={0}
      width={width}
      overflow="hidden"
      onMouseScroll={(e) => {
        e.stopPropagation();
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) => (c + (isUp ? -1 : 1) + ENTRIES.length) % ENTRIES.length);
      }}
    >
      <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
        {clampMenuLine(
          ENTRIES.length > entryViewport
            ? ` ${menu.key} (${start + 1}-${end}/${ENTRIES.length})`
            : ` ${menu.key}`,
          innerCols,
        )}
      </text>
      {visibleEntries.map((entry, idx) => {
        const absIdx = start + idx;
        const isCursor = absIdx === bounded;
        const baseFg = entry.danger === true ? theme.error() : theme.normal();
        const paddedLabel =
          entry.label.length > labelWidth
            ? entry.label.slice(0, labelWidth)
            : entry.label.padEnd(labelWidth);
        const line = clampMenuLine(
          `${isCursor ? "> " : "  "}${paddedLabel} ${entry.keyHint}`,
          innerCols,
        );
        return (
          <text
            key={entry.id}
            fg={isCursor ? theme.cursorFg() : baseFg}
            bg={isCursor ? theme.cursorBg() : undefined}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              setCursor(absIdx);
              store.executeContextAction(entry.id);
            }}
          >
            {line}
          </text>
        );
      })}
      {showHint ? (
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {clampMenuLine(" ↑↓/Enter or click · Esc closes", innerCols)}
        </text>
      ) : null}
    </box>
  );
}

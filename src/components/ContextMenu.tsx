import { useKeyboard } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

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

/**
 * Repo context menu: every repo-targeted action in one discoverable list,
 * opened with the right arrow on the cursor row or a right-click. Menu
 * items dispatch through the store with the selection focused on the
 * target so batch confirms behave.
 */
export function ContextMenu({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
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

  return (
    <box
      title="Actions"
      border
      borderColor={theme.focusBorder()}
      flexDirection="column"
      padding={0}
      width={34}
      overflow="hidden"
    >
      <text fg={theme.accent()}>{` ${menu.key}`}</text>
      {ENTRIES.map((entry, idx) => {
        const isCursor = idx === bounded;
        const baseFg = entry.danger === true ? theme.error() : theme.normal();
        const line = `${isCursor ? "> " : "  "}${entry.label.padEnd(21)}${entry.keyHint}`;
        return (
          <text
            key={entry.id}
            fg={isCursor ? theme.cursorFg() : baseFg}
            bg={isCursor ? theme.cursorBg() : undefined}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              setCursor(idx);
              store.executeContextAction(entry.id);
            }}
          >
            {line}
          </text>
        );
      })}
      <text fg={theme.dim()}>{" ↑↓/Enter or click · Esc closes"}</text>
    </box>
  );
}

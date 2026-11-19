import { useKeyboard } from "@opentui/react";
import { useSyncExternalStore } from "react";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

interface MenuEntry {
  id: string;
  label: string;
  danger?: boolean;
}

const ENTRIES: readonly MenuEntry[] = [
  { id: "detail", label: "Details" },
  { id: "open", label: "Open in app…" },
  { id: "sync", label: "Sync this repo" },
  { id: "move", label: "Move to path…" },
  { id: "alias", label: "Set alias…" },
  { id: "pin", label: "Pin / unpin" },
  { id: "worktree", label: "Worktrees…" },
  { id: "resolve", label: "Resolve conflicts…" },
  { id: "archive", label: "Archive on GitHub" },
  { id: "untrack", label: "Untrack (keep files)" },
  { id: "delete", label: "Delete → trash", danger: true },
  { id: "delete-permanent", label: "Delete permanently", danger: true },
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

  useKeyboard((key) => {
    if (!open) return;
    if (key.name === "escape") store.closeRepoContextMenu();
  });

  if (!open || menu === null) return null;

  return (
    <box border borderColor={theme.accent()} flexDirection="column" padding={0} flexGrow={1}>
      <text fg={theme.accent()}>{` ${menu.key}`}</text>
      {ENTRIES.map((entry) => (
        <text
          key={entry.id}
          fg={entry.danger === true ? theme.error() : theme.normal()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.executeContextAction(entry.id);
          }}
        >
          {` > ${entry.label}`}
        </text>
      ))}
      <text fg={theme.dim()}>{" click an action · Esc closes"}</text>
    </box>
  );
}

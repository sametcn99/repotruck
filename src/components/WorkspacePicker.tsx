import { useKeyboard } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { ModalShell, SelectList } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

export function WorkspacePicker({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [cursor, setCursor] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const selectable = snapshot.workspaces;
  const boundedCursor = Math.min(cursor, Math.max(0, selectable.length - 1));
  const current = selectable[boundedCursor];
  const recordsPath =
    snapshot.modal !== null && snapshot.modal.type === "workspaces"
      ? snapshot.modal.recordsPath
      : null;
  const dimFg = theme.dim();
  const selectedFg = theme.success();

  const removeEntry = (target: string) => {
    setCursor(0);
    setNotice(null);
    void store
      .removeWorkspaceEntry(target)
      .then(() => setNotice(`removed ${target} (registry only; disk untouched)`))
      .catch(() => setNotice(`failed to remove ${target}`));
  };

  const switchCurrent = () => {
    if (current !== undefined && !current.missing) {
      void store.switchWorkspace(current.path);
    }
  };

  useKeyboard((key) => {
    if (key.name === "up") {
      setCursor(Math.max(0, boundedCursor - 1));
    } else if (key.name === "down") {
      setCursor(Math.min(Math.max(0, selectable.length - 1), boundedCursor + 1));
    } else if (key.name === "return") {
      switchCurrent();
    } else if (key.name === "x" && current !== undefined) {
      removeEntry(current.path);
    }
  });
  return (
    <ModalShell
      store={store}
      title="Workspaces"
      hint="Up/Down choose · Enter switch · x removes from the registry · Escape cancels"
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) =>
          Math.min(Math.max(0, selectable.length - 1), Math.max(0, c + (isUp ? -1 : 1))),
        );
      }}
    >
      {recordsPath !== null ? <text fg={dimFg}>{`records: ${recordsPath}`}</text> : null}
      {notice !== null ? <text fg={selectedFg}>{notice}</text> : null}
      {snapshot.workspaces.length === 0 ? <text fg={dimFg}>no registered workspaces</text> : null}
      <SelectList
        items={snapshot.workspaces}
        cursor={boundedCursor}
        keyOf={(item) => item.path}
        labelOf={(item) =>
          `${item.path} · ${item.preset} · ${item.repoCount} repos · ${item.lastUsed}${item.missing ? " (missing, not switchable)" : ""}`
        }
        fgOf={(item, isCursor) =>
          item.missing ? dimFg : isCursor ? theme.cursorFg() : theme.normal()
        }
        onSelect={(_item, index) => setCursor(index)}
        onActivate={(item) => {
          if (!item.missing) void store.switchWorkspace(item.path);
        }}
      />
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={current !== undefined && !current.missing ? selectedFg : dimFg}
          onMouseDown={(e) => {
            e.stopPropagation();
            switchCurrent();
          }}
        >
          {"[ Switch ]"}
        </text>
        <text
          fg={current !== undefined ? theme.error() : dimFg}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (current !== undefined) removeEntry(current.path);
          }}
        >
          {"[ Remove ]"}
        </text>
        <text
          fg={dimFg}
          onMouseDown={(e) => {
            e.stopPropagation();
            store.closeModal();
          }}
        >
          {"[ Cancel ]"}
        </text>
      </box>
    </ModalShell>
  );
}

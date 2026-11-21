import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { ModalShell, SelectList } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { visibleSlice } from "./windowing.ts";

export function WorkspacePicker({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height } = useTerminalDimensions();
  const [cursor, setCursor] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const selectable = snapshot.workspaces;
  const boundedCursor = Math.min(cursor, Math.max(0, selectable.length - 1));
  const current = selectable[boundedCursor];
  const viewportRows = Math.max(2, height - 15);
  const window = visibleSlice(boundedCursor, selectable.length, viewportRows);
  const visibleWorkspaces = selectable.slice(window.start, window.end);
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
    } else if (key.name === "n") {
      store.openWorkspaceAdd();
    } else if (key.name === "d" && current !== undefined && !current.missing) {
      void store.submitRoot(current.path);
    } else if (key.name === "x" && current !== undefined) {
      removeEntry(current.path);
    }
  });
  return (
    <ModalShell
      store={store}
      title="Workspaces"
      hint="↑↓ Choose · Enter Switch · n New · d Set default · x Remove · Esc Cancel"
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) =>
          Math.min(Math.max(0, selectable.length - 1), Math.max(0, c + (isUp ? -1 : 1))),
        );
      }}
    >
      {recordsPath !== null ? (
        <text fg={dimFg} wrapMode="none" flexShrink={0}>
          {`records: ${recordsPath}`}
        </text>
      ) : null}
      {notice !== null ? (
        <text fg={selectedFg} wrapMode="none" flexShrink={0}>
          {notice}
        </text>
      ) : null}
      {snapshot.workspaces.length === 0 ? <text fg={dimFg}>no registered workspaces</text> : null}
      <SelectList
        items={visibleWorkspaces}
        cursor={boundedCursor - window.start}
        keyOf={(item) => item.path}
        labelOf={(item) =>
          `${item.path} · ${item.preset} · ${item.repoCount} repos · ${item.lastUsed}${item.missing ? " (missing, not switchable)" : ""}`
        }
        fgOf={(item, isCursor) =>
          item.missing ? dimFg : isCursor ? theme.cursorFg() : theme.normal()
        }
        onSelect={(_item, index) => setCursor(window.start + index)}
        onActivate={(item) => {
          if (!item.missing) void store.switchWorkspace(item.path);
        }}
      />
      <box
        flexDirection="row"
        flexWrap="wrap"
        gap={2}
        marginTop={height < 20 ? 0 : 1}
        flexShrink={0}
      >
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
          fg={selectedFg}
          onMouseDown={(event) => {
            event.stopPropagation();
            store.openWorkspaceAdd();
          }}
        >
          {"[n] New"}
        </text>
        <text
          fg={current !== undefined && !current.missing ? selectedFg : dimFg}
          onMouseDown={(event) => {
            event.stopPropagation();
            if (current !== undefined && !current.missing) void store.submitRoot(current.path);
          }}
        >
          {"[d] Set default"}
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

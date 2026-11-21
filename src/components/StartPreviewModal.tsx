import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ModalShell, SelectList } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { buildPreviewTree, type PreviewTreeEntry, visibleSlice } from "./windowing.ts";

const START_PREVIEW_RESERVED_ROWS = 15;
const EMPTY_ENTRIES: readonly PreviewTreeEntry[] = [];

export function StartPreviewModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height } = useTerminalDimensions();
  const modal = snapshot.modal;
  const entries: readonly PreviewTreeEntry[] =
    modal !== null && modal.type === "preview" ? modal.entries : EMPTY_ENTRIES;
  const lines = useMemo(() => buildPreviewTree(entries), [entries]);
  const [cursor, setCursor] = useState(0);
  const bounded = Math.min(Math.max(cursor, 0), Math.max(0, lines.length - 1));
  const viewportRows = Math.max(1, height - START_PREVIEW_RESERVED_ROWS);
  const window = visibleSlice(bounded, lines.length, viewportRows);
  const shown = lines.slice(window.start, window.end);
  const accentColor = theme.launcher();
  const dimFg = theme.dim();
  const compact = height < 20;

  useKeyboard((key) => {
    if (key.name === "up") {
      setCursor(Math.max(0, bounded - 1));
    } else if (key.name === "down") {
      setCursor(Math.min(Math.max(0, lines.length - 1), bounded + 1));
    } else if (key.name === "pageup") {
      setCursor(Math.max(0, bounded - viewportRows));
    } else if (key.name === "pagedown") {
      setCursor(Math.min(Math.max(0, lines.length - 1), bounded + viewportRows));
    } else if (key.name === "home") {
      setCursor(0);
    } else if (key.name === "end") {
      setCursor(Math.max(0, lines.length - 1));
    } else if (key.name === "return") {
      void store.confirmStartPreview();
    } else if (key.name === "p") {
      void store.cyclePreset();
    }
  });
  return (
    <ModalShell
      store={store}
      title="Start preview"
      hint="↑↓ / PgUp / PgDn browse · Home / End jump · Enter sync · p preset"
      borderColor={accentColor}
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) => Math.min(Math.max(0, lines.length - 1), Math.max(0, c + (isUp ? -3 : 3))));
      }}
    >
      <text
        fg={accentColor}
        wrapMode="none"
        flexShrink={0}
        onMouseDown={(e) => {
          e.stopPropagation();
          void store.cyclePreset();
        }}
      >
        {`root: ${snapshot.root} · preset for new clones: ${snapshot.preset}`}
      </text>
      <SelectList
        items={shown}
        cursor={bounded - window.start}
        keyOf={(_line, index) => `${window.start + index}`}
        labelOf={(line) => line}
        onSelect={(_line, index) => setCursor(window.start + index)}
        onActivate={() => void store.confirmStartPreview()}
      />
      {!compact ? <text fg={dimFg}> </text> : null}
      <text fg={dimFg} wrapMode="none" flexShrink={0}>
        {`${snapshot.selected.size} repositories selected${
          lines.length > viewportRows
            ? ` · showing ${window.start + 1}–${window.end} of ${lines.length}`
            : ""
        }`}
      </text>
      <box flexDirection="row" flexWrap="wrap" gap={2} marginTop={compact ? 0 : 1} flexShrink={0}>
        <text
          fg={theme.success()}
          onMouseDown={(e) => {
            e.stopPropagation();
            void store.confirmStartPreview();
          }}
        >
          {"[Enter] Start Sync"}
        </text>
        <text
          fg={accentColor}
          onMouseDown={(e) => {
            e.stopPropagation();
            void store.cyclePreset();
          }}
        >
          {"[p] Change Preset"}
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

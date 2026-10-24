import { useKeyboard } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { ModalShell, SelectList } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { buildPreviewTree, type PreviewTreeEntry, visibleSlice } from "./windowing.ts";

export const START_PREVIEW_MAX_ROWS = 30;

const ACCENT_COLOR = theme.launcher();
const DIM_FG = theme.dim();

export function StartPreviewModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const modal = snapshot.modal;
  const entries: readonly PreviewTreeEntry[] =
    modal !== null && modal.type === "preview" ? modal.entries : [];
  const lines = buildPreviewTree(entries);
  const [cursor, setCursor] = useState(0);
  const bounded = Math.min(Math.max(cursor, 0), Math.max(0, lines.length - 1));
  const window = visibleSlice(bounded, lines.length, START_PREVIEW_MAX_ROWS);
  const shown = lines.slice(window.start, window.end);
  useKeyboard((key) => {
    if (key.name === "up") {
      setCursor(Math.max(0, bounded - 1));
    } else if (key.name === "down") {
      setCursor(Math.min(Math.max(0, lines.length - 1), bounded + 1));
    } else if (key.name === "return") {
      void store.confirmStartPreview();
    } else if (key.name === "p") {
      store.cyclePreset();
    }
  });
  return (
    <ModalShell
      store={store}
      title="Start preview"
      hint="Enter Start · p Preset · Escape Cancel"
      borderColor={ACCENT_COLOR}
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) => Math.min(Math.max(0, lines.length - 1), Math.max(0, c + (isUp ? -3 : 3))));
      }}
    >
      <text
        fg={ACCENT_COLOR}
        onMouseDown={(e) => {
          e.stopPropagation();
          store.cyclePreset();
        }}
      >
        {`root: ${snapshot.root} · preset: ${snapshot.preset}`}
      </text>
      <SelectList
        items={shown}
        cursor={bounded - window.start}
        keyOf={(_line, index) => `${window.start + index}`}
        labelOf={(line) => line}
        onSelect={(_line, index) => setCursor(window.start + index)}
        onActivate={() => void store.confirmStartPreview()}
      />
      <text fg={DIM_FG}> </text>
      <text fg={DIM_FG}>{`${snapshot.selected.size} repositories selected`}</text>
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={theme.success()}
          onMouseDown={(e) => {
            e.stopPropagation();
            void store.confirmStartPreview();
          }}
        >
          {"[ Start Sync ]"}
        </text>
        <text
          fg={ACCENT_COLOR}
          onMouseDown={(e) => {
            e.stopPropagation();
            store.cyclePreset();
          }}
        >
          {"[ Change Preset ]"}
        </text>
        <text
          fg={DIM_FG}
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

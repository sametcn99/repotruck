import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useSyncExternalStore } from "react";
import { PRESET_IDS } from "../presets/index.ts";
import { ModalShell, SelectList } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { visibleSlice } from "./windowing.ts";

export function ReorganizeModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height } = useTerminalDimensions();
  const modal = snapshot.modal;
  const target = modal !== null && modal.type === "reorganize" ? modal.target : null;
  const keepCustom = modal !== null && modal.type === "reorganize" ? modal.keepCustom : true;
  const preview = modal !== null && modal.type === "reorganize" ? modal.preview : null;
  const dimFg = theme.dim();
  const selectedFg = theme.success();
  const warningFg = theme.warning();

  useKeyboard((key) => {
    if (key.name === "escape") {
      store.closeModal();
    } else if (key.name === "up") {
      void store.cycleReorganizeTarget(-1);
    } else if (key.name === "down") {
      void store.cycleReorganizeTarget(1);
    } else if (key.name === "k") {
      void store.toggleReorganizeKeepCustom();
    } else if (key.name === "return") {
      void store.confirmReorganize();
    }
  });

  const ids = [...PRESET_IDS, ...snapshot.customPresets.map((preset) => preset.id)];
  const cursorIdx = target === null ? 0 : Math.max(0, ids.indexOf(target));
  // Budget rows between preset selector and preview list so [ Apply ] [ Cancel ] never overflow
  const totalBudget = Math.max(3, height - 15);
  const presetViewport = Math.max(2, Math.min(ids.length, Math.ceil(totalBudget * 0.45)));
  const presetWin = visibleSlice(cursorIdx, ids.length, presetViewport);
  const visibleIds = ids.slice(presetWin.start, presetWin.end);
  const previewBudget = Math.max(1, totalBudget - visibleIds.length - 1);

  const previewLines: Array<{ key: string; text: string; fg: string | undefined }> = [];
  if (preview !== null) {
    for (const move of preview.moved.slice(0, 12)) {
      previewLines.push({
        key: `m:${move.key}:${move.from}`,
        text: `${move.key}: ${move.from} -> ${move.to}`,
        fg: theme.muted(),
      });
    }
    for (const skip of preview.skipped.slice(0, 6)) {
      previewLines.push({
        key: `s:${skip.key}:${skip.reason}`,
        text: `skip ${skip.key} [${skip.reason}]`,
        fg: dimFg,
      });
    }
    for (const collision of preview.collisions.slice(0, 6)) {
      previewLines.push({
        key: `c:${collision.key}:${collision.target}`,
        text: `collision ${collision.key} -> ${collision.target} (occupied by ${collision.occupiedBy})`,
        fg: warningFg,
      });
    }
    for (const failure of preview.failed) {
      previewLines.push({
        key: `f:${failure.key}:${failure.message}`,
        text: `failed ${failure.key}: ${failure.message}`,
        fg: theme.error(),
      });
    }
  }

  return (
    <ModalShell
      store={store}
      title="Reorganize workspace"
      hint="Up/Down preset · k keep-custom · Enter apply · Escape cancels"
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        void store.cycleReorganizeTarget(isUp ? -1 : 1);
      }}
    >
      <text fg={dimFg} wrapMode="none" flexShrink={0}>
        Target preset (Up/Down choose):
      </text>
      <SelectList
        items={visibleIds}
        cursor={target === null ? -1 : cursorIdx - presetWin.start}
        keyOf={(preset) => preset}
        labelOf={(preset) => `${preset}${preset === snapshot.preset ? " (current)" : ""}`}
        onSelect={(preset) => void store.setReorganizeTarget(preset)}
      />
      <text
        fg={keepCustom ? selectedFg : dimFg}
        wrapMode="none"
        flexShrink={0}
        onMouseDown={(e) => {
          e.stopPropagation();
          void store.toggleReorganizeKeepCustom();
        }}
      >
        {`[${keepCustom ? "x" : " "}] keep custom placements (k toggles; on by default here, unlike the CLI)`}
      </text>
      {preview === null ? (
        <text fg={dimFg} wrapMode="none" flexShrink={0}>
          previewing…
        </text>
      ) : (
        <>
          {previewLines.slice(0, previewBudget).map((line) => (
            <text key={line.key} fg={line.fg} wrapMode="none" flexShrink={0}>
              {line.text}
            </text>
          ))}
          <text fg={dimFg} wrapMode="none" flexShrink={0}>
            {`${preview.moved.length} moves · ${preview.skipped.length} skipped · ${preview.collisions.length} collisions`}
          </text>
        </>
      )}
      <box
        flexDirection="row"
        flexWrap="wrap"
        gap={2}
        marginTop={height < 20 ? 0 : 1}
        flexShrink={0}
      >
        <text
          fg={selectedFg}
          onMouseDown={(e) => {
            e.stopPropagation();
            void store.confirmReorganize();
          }}
        >
          {"[ Apply ]"}
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

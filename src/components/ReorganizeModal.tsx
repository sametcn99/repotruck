import { useKeyboard } from "@opentui/react";
import { useSyncExternalStore } from "react";
import { PRESET_IDS } from "../presets/index.ts";
import { ModalShell, SelectList } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

const DIM_FG = theme.dim();
const SELECTED_FG = theme.success();
const WARNING_FG = theme.warning();

export function ReorganizeModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const modal = snapshot.modal;
  const target = modal !== null && modal.type === "reorganize" ? modal.target : null;
  const keepCustom = modal !== null && modal.type === "reorganize" ? modal.keepCustom : true;
  const preview = modal !== null && modal.type === "reorganize" ? modal.preview : null;

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
      <text fg={DIM_FG}>Target preset (Up/Down choose):</text>
      <SelectList
        items={ids}
        cursor={target === null ? -1 : ids.indexOf(target)}
        keyOf={(preset) => preset}
        labelOf={(preset) => `${preset}${preset === snapshot.preset ? " (current)" : ""}`}
        onSelect={(preset) => void store.setReorganizeTarget(preset)}
      />
      <text
        fg={keepCustom ? SELECTED_FG : DIM_FG}
        onMouseDown={(e) => {
          e.stopPropagation();
          void store.toggleReorganizeKeepCustom();
        }}
      >
        {`[${keepCustom ? "x" : " "}] keep custom placements (k toggles; on by default here, unlike the CLI)`}
      </text>
      {preview === null ? (
        <text fg={DIM_FG}>previewing…</text>
      ) : (
        <>
          {preview.moved.slice(0, 12).map((move) => (
            <text key={`${move.key}:${move.from}`} fg={theme.muted()}>
              {`${move.key}: ${move.from} -> ${move.to}`}
            </text>
          ))}
          {preview.skipped.slice(0, 6).map((skip) => (
            <text key={`${skip.key}:${skip.reason}`} fg={DIM_FG}>
              {`skip ${skip.key} [${skip.reason}]`}
            </text>
          ))}
          {preview.collisions.slice(0, 6).map((collision) => (
            <text key={`${collision.key}:${collision.target}`} fg={WARNING_FG}>
              {`collision ${collision.key} -> ${collision.target} (occupied by ${collision.occupiedBy})`}
            </text>
          ))}
          {preview.failed.map((failure) => (
            <text key={`${failure.key}:${failure.message}`} fg={theme.error()}>
              {`failed ${failure.key}: ${failure.message}`}
            </text>
          ))}
          <text fg={DIM_FG}>
            {`${preview.moved.length} moves · ${preview.skipped.length} skipped · ${preview.collisions.length} collisions`}
          </text>
        </>
      )}
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={theme.success()}
          onMouseDown={(e) => {
            e.stopPropagation();
            void store.confirmReorganize();
          }}
        >
          {"[ Apply ]"}
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

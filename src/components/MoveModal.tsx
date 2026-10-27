import { useState, useSyncExternalStore } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

export function MoveModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [value, setValue] = useState(snapshot.movePrefill ?? "");
  const modal = snapshot.modal;
  if (modal === null || modal.type !== "move") return null;
  return (
    <ModalShell store={store} title="Move repository" hint="Enter moves · Escape cancels">
      <text>{`Moving: ${modal.key}`}</text>
      <text>New workspace-relative path:</text>
      <input
        focused
        value={value}
        onInput={setValue}
        onSubmit={(submitted) => {
          void store.submitMove(typeof submitted === "string" ? submitted : "");
        }}
        width="100%"
      />
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={theme.success()}
          onMouseDown={(e) => {
            e.stopPropagation();
            void store.submitMove(value);
          }}
        >
          {"[ Move ]"}
        </text>
        <text
          fg={theme.dim()}
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

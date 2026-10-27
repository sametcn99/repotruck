import { useState, useSyncExternalStore } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store, StoreSnapshot } from "./store.ts";
import { theme } from "./theme.ts";

export function AliasModal({ store }: { store: Store }) {
  const snapshot: StoreSnapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const modal = snapshot.modal;
  const key = modal !== null && modal.type === "alias" ? modal.key : "";
  const [value, setValue] = useState(modal !== null && modal.type === "alias" ? modal.prefill : "");
  const accentColor = theme.launcher();
  return (
    <ModalShell
      store={store}
      title="Set alias"
      hint="Enter saves · Escape cancels"
      borderColor={accentColor}
    >
      <text>{`Repository: ${key}`}</text>
      <text>Alias (letters, digits, dots, dashes, underscores):</text>
      <input
        focused
        value={value}
        onInput={setValue}
        onSubmit={(submitted) => {
          void store.submitAlias(key, typeof submitted === "string" ? submitted : "");
        }}
        width="100%"
      />
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={accentColor}
          onMouseDown={(e) => {
            e.stopPropagation();
            void store.submitAlias(key, value);
          }}
        >
          {"[ Save ]"}
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

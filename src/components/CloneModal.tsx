import { useState, useSyncExternalStore } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

export function CloneModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [value, setValue] = useState("");
  return (
    <ModalShell store={store} title="Clone repository by URL" hint="Enter submits · Escape cancels">
      <text>Repository URL or owner/name:</text>
      <input
        focused
        placeholder="https://github.com/owner/repo"
        value={value}
        onInput={setValue}
        onSubmit={(submitted) => {
          void store.submitClone(typeof submitted === "string" ? submitted : "");
        }}
        width="100%"
      />
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={snapshot.phase === "ready" ? theme.success() : theme.dim()}
          onMouseDown={(e) => {
            e.stopPropagation();
            void store.submitClone(value);
          }}
        >
          {"[ Clone ]"}
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

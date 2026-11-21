import { useState, useSyncExternalStore } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store, StoreSnapshot } from "./store.ts";
import { theme } from "./theme.ts";

export function RootModal({ store }: { store: Store }) {
  const snapshot: StoreSnapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const modal = snapshot.modal;
  const addingWorkspace = modal?.type === "workspaceAdd";
  const effective = modal !== null && modal.type === "root" ? modal.effective : "";
  const fromOverride = modal !== null && modal.type === "root" ? modal.fromOverride : false;
  const [value, setValue] = useState(effective);
  const accentColor = theme.launcher();
  const submit = addingWorkspace ? store.submitWorkspaceAdd : store.submitRoot;
  const action = addingWorkspace ? "Create" : "Save";
  return (
    <ModalShell
      store={store}
      title={addingWorkspace ? "New workspace" : "Default root"}
      hint={`Enter ${action} · Escape Cancel`}
      borderColor={accentColor}
    >
      {!addingWorkspace && (
        <text>{`Effective root: ${effective} (${fromOverride ? "settings override" : "OS default"})`}</text>
      )}
      <text>
        {addingWorkspace
          ? "Workspace directory (absolute path, ~ allowed)"
          : "New default root (absolute path, ~ allowed):"}
      </text>
      <input
        focused
        value={value}
        onInput={setValue}
        onSubmit={(submitted) => {
          void submit(typeof submitted === "string" ? submitted : "");
        }}
        width="100%"
      />
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={accentColor}
          onMouseDown={(e) => {
            e.stopPropagation();
            void submit(value);
          }}
        >
          {`[ ${action} ]`}
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

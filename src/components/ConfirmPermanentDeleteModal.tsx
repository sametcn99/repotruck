import { useState, useSyncExternalStore } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

/**
 * Permanent delete (`delete --yes` without trash): the confirm button only
 * arms after the repository name is typed exactly — the strongest guard in
 * the dashboard, because this action cannot be undone.
 */
export function ConfirmPermanentDeleteModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const modal = snapshot.modal;
  if (modal === null || modal.type !== "confirmPermanentDelete") return null;
  const key = modal.key;
  const repoName = key.split("/").pop() ?? key;
  const [value, setValue] = useState("");
  const armed = value === repoName;

  return (
    <ModalShell
      store={store}
      title={`Delete permanently — ${key}`}
      hint="type the repository name to arm · Esc cancels"
      borderColor={theme.error()}
    >
      <text fg={theme.error()}>
        {"removes the directory from disk for good — no trash, no undo (delete --yes)"}
      </text>
      <text fg={theme.normal()}>{`type: ${repoName}`}</text>
      <input
        focused
        value={value}
        onInput={setValue}
        onSubmit={() => {
          if (armed) void store.confirmPermanentDelete(key);
        }}
        width="100%"
      />
      <box flexDirection="row" gap={2}>
        <text
          fg={armed ? theme.error() : theme.dim()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            if (armed) void store.confirmPermanentDelete(key);
          }}
        >
          {armed ? "[ Delete forever ]" : `[ delete — type ${repoName} ]`}
        </text>
        <text
          fg={theme.dim()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.closeModal();
          }}
        >
          {"[ Cancel ]"}
        </text>
      </box>
    </ModalShell>
  );
}

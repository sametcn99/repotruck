import { useKeyboard } from "@opentui/react";
import { useSyncExternalStore } from "react";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

/**
 * Thin confirmation dialog layered above views and modals: y confirms,
 * n / Escape cancels, Enter confirms. The store owns the callback so the
 * snapshot stays serializable.
 */
export function DialogBox({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const dialog = snapshot.dialog;

  useKeyboard((key) => {
    if (dialog === null) return;
    if (key.name === "y") store.resolveDialog(true, dialog);
    else if (key.name === "n" || key.name === "escape") store.resolveDialog(false, dialog);
    else if (key.name === "return") store.resolveDialog(true, dialog);
  });

  if (dialog === null) return null;

  const borderColor = dialog.danger ? theme.error() : theme.warning();
  const confirmColor = dialog.danger ? theme.error() : theme.accent();

  return (
    <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <box border borderColor={borderColor} padding={1} flexDirection="column" gap={1}>
        <text fg={borderColor}>{dialog.title}</text>
        <text>{dialog.message}</text>
        <box flexDirection="row" gap={4}>
          <text
            fg={confirmColor}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              store.resolveDialog(true, dialog);
            }}
          >
            {`[y] ${dialog.confirmLabel}`}
          </text>
          <text
            fg={theme.dim()}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              store.resolveDialog(false, dialog);
            }}
          >
            {"[n] Cancel"}
          </text>
        </box>
      </box>
    </box>
  );
}

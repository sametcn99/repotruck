import { useKeyboard } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { ModalShell, SelectList } from "./ModalShell.tsx";
import type { Store, StoreSnapshot } from "./store.ts";
import { theme } from "./theme.ts";

const DIM_FG = theme.dim();
const ACCENT_COLOR = theme.launcher();

export function OpenModal({
  store,
  onSuspendAndRun,
}: {
  store: Store;
  onSuspendAndRun: (run: () => Promise<number>) => Promise<void>;
}) {
  const snapshot: StoreSnapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [cursor, setCursor] = useState(0);
  const modal = snapshot.modal;
  // apps === null while detection is pending; [] means detection found nothing.
  const apps = modal !== null && modal.type === "open" ? modal.apps : null;
  const list = apps ?? [];
  const boundedCursor = Math.min(cursor, Math.max(0, list.length - 1));
  const current = list[boundedCursor];

  const launchApp = (appName: string) => {
    void onSuspendAndRun(() => store.runOpenApp(appName));
  };

  useKeyboard((key) => {
    if (list.length === 0) return;
    if (key.name === "up") {
      setCursor(Math.max(0, boundedCursor - 1));
    } else if (key.name === "down") {
      setCursor(Math.min(list.length - 1, boundedCursor + 1));
    } else if (key.name === "return" && current !== undefined) {
      launchApp(current.name);
    }
  });

  return (
    <ModalShell
      store={store}
      title="Open in app"
      hint="Up/Down choose · Enter launch (dashboard resumes after) · Escape cancels"
      borderColor={ACCENT_COLOR}
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) => Math.min(list.length - 1, Math.max(0, c + (isUp ? -1 : 1))));
      }}
    >
      <text>{`Repository: ${modal !== null && modal.type === "open" ? modal.key : ""}`}</text>
      {apps === null ? <text fg={DIM_FG}>detecting apps…</text> : null}
      {apps !== null && apps.length === 0 ? (
        <text fg={DIM_FG}>no apps detected (builtin, apps.json, or PATH)</text>
      ) : null}
      <SelectList
        items={list}
        cursor={boundedCursor}
        keyOf={(app) => app.name}
        labelOf={(app) => app.name}
        onSelect={(_app, index) => setCursor(index)}
        onActivate={(app) => launchApp(app.name)}
      />
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={current !== undefined ? theme.success() : DIM_FG}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (current !== undefined) launchApp(current.name);
          }}
        >
          {"[ Open ]"}
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

import { useSyncExternalStore } from "react";
import { STATUS_VIEW_ROWS, type Store } from "./store.ts";
import { theme } from "./theme.ts";

const DIM_FG = theme.dim();

export function StatusPanel({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const counts = { CLONING: 0, PULLING: 0, DONE: 0, FAILED: 0 };
  for (const status of snapshot.statuses) {
    counts[status.phase] += 1;
  }
  // The scroll offset is anchored to the bottom: 0 shows the latest window,
  // larger values page back through older activity.
  const total = snapshot.statuses.length;
  const maxScroll = Math.max(0, total - STATUS_VIEW_ROWS);
  const scroll = Math.min(snapshot.statusScroll, maxScroll);
  const end = total - scroll;
  const start = Math.max(0, end - STATUS_VIEW_ROWS);
  const visible = snapshot.statuses.slice(start, end);
  const lastSync = snapshot.lastSync !== null ? snapshot.lastSync.slice(0, 10) : "never";
  const scrollHint = scroll > 0 ? ` · line ${start + 1}-${Math.min(end, total)}/${total}` : "";
  return (
    <box
      title="Status"
      border
      borderColor={snapshot.focus === "status" ? theme.focusBorder() : theme.border()}
      width={width}
      flexDirection="column"
      onMouseDown={() => {
        store.setFocus("status");
      }}
      onMouseScroll={(e) => {
        e.stopPropagation();
        store.setFocus("status");
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        store.moveStatusScroll(isUp ? 3 : -3);
      }}
    >
      <text fg={DIM_FG}>
        {`${counts.CLONING} cloning · ${counts.PULLING} pulling · ${counts.DONE} done · ${counts.FAILED} failed · last sync: ${lastSync}${scrollHint}`}
      </text>
      {visible.map((status) => (
        <text key={status.id} fg={theme.phaseColor(status.phase)}>
          {`[${status.phase}] ${status.key}${status.message !== undefined ? ` — ${status.message}` : ""}`}
        </text>
      ))}
      {visible.length === 0 ? <text fg={DIM_FG}>no activity yet</text> : null}
    </box>
  );
}

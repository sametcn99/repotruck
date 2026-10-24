import { useSyncExternalStore } from "react";
import { buildSidebarRows, type SidebarRow, type Store } from "./store.ts";
import { theme } from "./theme.ts";

const NORMAL_FG = theme.normal();
const DIM_FG = theme.dim();
const CURSOR_BG = theme.cursorBg();
const CURSOR_FG = theme.cursorFg();

function rowKey(row: SidebarRow): string {
  if (row.kind === "org") return `org:${row.org}`;
  if (row.kind === "filter") return `filter:${row.key}`;
  return `row:${row.label}`;
}

function renderRow(row: SidebarRow, index: number, cursor: number, focused: boolean, store: Store) {
  const isCursor = focused && index === cursor;
  const checkbox = row.kind === "preset" ? "" : `[${row.checked ? "x" : " "}] `;
  return (
    <text
      key={rowKey(row)}
      fg={isCursor ? CURSOR_FG : NORMAL_FG}
      bg={isCursor ? CURSOR_BG : undefined}
      onMouseDown={(e) => {
        e.stopPropagation();
        store.setFocus("sidebar");
        store.setSidebarCursor(index);
        store.activateSidebarRow();
      }}
    >
      {`${isCursor ? "> " : "  "}${checkbox}${row.label}`}
    </text>
  );
}

export function Sidebar({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const rows = buildSidebarRows(snapshot);
  const orgCount = snapshot.orgs.length;
  const presetIndex = 1 + orgCount;
  const focused = snapshot.focus === "sidebar";
  return (
    <box
      title="Scope"
      border
      borderColor={focused ? theme.focusBorder() : theme.border()}
      width={width}
      flexDirection="column"
      onMouseDown={() => {
        store.setFocus("sidebar");
      }}
      onMouseScroll={(e) => {
        e.stopPropagation();
        store.setFocus("sidebar");
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        store.moveSidebarCursor(isUp ? -1 : 1);
      }}
    >
      <text fg={DIM_FG}>SCOPE</text>
      {rows
        .slice(0, presetIndex)
        .map((row, index) => renderRow(row, index, snapshot.sidebarCursor, focused, store))}
      <text fg={DIM_FG}>PRESET</text>
      {rows
        .slice(presetIndex, presetIndex + 1)
        .map((row, index) =>
          renderRow(row, presetIndex + index, snapshot.sidebarCursor, focused, store),
        )}
      <text fg={DIM_FG}>FILTERS</text>
      {rows
        .slice(presetIndex + 1)
        .map((row, index) =>
          renderRow(row, presetIndex + 1 + index, snapshot.sidebarCursor, focused, store),
        )}
    </box>
  );
}

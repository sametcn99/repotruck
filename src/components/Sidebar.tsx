import { useSyncExternalStore } from "react";
import { buildSidebarRows, type SidebarRow, type Store } from "./store.ts";
import { theme } from "./theme.ts";

function clampSidebarLine(raw: string, maxCols: number): string {
  if (raw.length <= maxCols) return raw;
  return `${raw.slice(0, Math.max(1, maxCols - 1))}\u2026`;
}

function rowKey(row: SidebarRow): string {
  if (row.kind === "org") return `org:${row.org}`;
  if (row.kind === "filter") return `filter:${row.key}`;
  return `row:${row.label}`;
}

function renderRow(
  row: SidebarRow,
  index: number,
  cursor: number,
  focused: boolean,
  store: Store,
  maxCols: number,
) {
  const isCursor = focused && index === cursor;
  const checkbox = row.kind === "preset" ? "" : `[${row.checked ? "x" : " "}] `;
  return (
    <text
      key={rowKey(row)}
      wrapMode="none"
      flexShrink={0}
      fg={isCursor ? theme.cursorFg() : theme.normal()}
      bg={isCursor ? theme.cursorBg() : undefined}
      onMouseDown={(e) => {
        e.stopPropagation();
        store.setFocus("sidebar");
        store.setSidebarCursor(index);
        store.activateSidebarRow();
      }}
    >
      {clampSidebarLine(`${isCursor ? "> " : "  "}${checkbox}${row.label}`, maxCols)}
    </text>
  );
}

export function Sidebar({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const rows = buildSidebarRows(snapshot);
  const orgCount = snapshot.orgs.length;
  const presetIndex = 1 + orgCount;
  const focused = snapshot.focus === "sidebar";
  const dimFg = theme.dim();
  const maxCols = Math.max(6, width - 2);

  return (
    <box
      title="Scope"
      border
      borderColor={focused ? theme.focusBorder() : theme.border()}
      width={width}
      overflow="hidden"
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
      <text fg={dimFg} wrapMode="none" flexShrink={0}>
        SCOPE
      </text>
      {rows
        .slice(0, presetIndex)
        .map((row, index) =>
          renderRow(row, index, snapshot.sidebarCursor, focused, store, maxCols),
        )}
      <text fg={dimFg} wrapMode="none" flexShrink={0}>
        PRESET
      </text>
      {rows
        .slice(presetIndex, presetIndex + 1)
        .map((row, index) =>
          renderRow(row, presetIndex + index, snapshot.sidebarCursor, focused, store, maxCols),
        )}
      <text fg={dimFg} wrapMode="none" flexShrink={0}>
        FILTERS
      </text>
      {rows
        .slice(presetIndex + 1)
        .map((row, index) =>
          renderRow(row, presetIndex + 1 + index, snapshot.sidebarCursor, focused, store, maxCols),
        )}
      <text fg={dimFg} wrapMode="none" flexShrink={0}>
        HEALTH
      </text>
      <text
        fg={snapshot.healthFilter !== "all" ? theme.accent() : dimFg}
        wrapMode="none"
        flexShrink={0}
        onMouseDown={(e) => {
          e.stopPropagation();
          store.cycleHealthFilter();
        }}
      >
        {clampSidebarLine(`  [f] ${snapshot.healthFilter}`, maxCols)}
      </text>
      <text
        fg={snapshot.pinnedCount > 0 ? theme.warning() : dimFg}
        wrapMode="none"
        flexShrink={0}
        onMouseDown={(e) => {
          e.stopPropagation();
          if (snapshot.pinnedCount > 0) {
            store.cycleHealthFilter();
          }
        }}
      >
        {clampSidebarLine(`  [P] ${snapshot.pinnedCount} pinned`, maxCols)}
      </text>
    </box>
  );
}

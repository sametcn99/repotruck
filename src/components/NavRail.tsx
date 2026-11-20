import { useTerminalDimensions } from "@opentui/react";
import type { ViewId } from "./store/types.ts";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { NAV_GROUPS, VIEW_BY_ID, VIEW_SPECS } from "./views/viewRegistry.ts";
import { FOOTER_ROWS, HEADER_ROWS, TOAST_RESERVED_ROWS, visibleSlice } from "./windowing.ts";

/**
 * Persistent left navigation rail listing every dashboard view, grouped
 * like the prototype. Focusable via Tab or clicking; when focused, arrow
 * keys and j/k move the cursor and Enter/Space opens the view.
 */
export function NavRail({ store, width }: { store: Store; width: number }) {
  const snapshot = store.getSnapshot();
  const { height } = useTerminalDimensions();
  const inner = Math.max(6, width - 2);
  const focused = snapshot.navFocused;

  const rows: {
    index: number;
    label: string;
    view: ViewId;
    go: string;
    active: boolean;
    cursor: boolean;
    running: boolean;
  }[] = [];
  for (let i = 0; i < VIEW_SPECS.length; i += 1) {
    const spec = VIEW_SPECS[i]!;
    rows.push({
      index: i,
      label: spec.title,
      view: spec.id,
      go: spec.go,
      active: snapshot.view === spec.id,
      cursor: focused && snapshot.navCursor === i,
      running:
        snapshot.running && (spec.id === "sync" || spec.id === "run" || spec.id === "cockpit"),
    });
  }

  // Available interior rows inside the bordered NavRail box
  const toastRows =
    snapshot.updateToast !== null || snapshot.toast !== null ? TOAST_RESERVED_ROWS : 0;
  const availRows = Math.max(3, height - HEADER_ROWS - FOOTER_ROWS - toastRows - 2);
  // Full grouped rail takes 1 (" views") + 5 group headers + 16 view rows + 2 footer hints = 24 lines
  const fullGroupedLines = 1 + NAV_GROUPS.length + rows.length + 2;

  const renderRailRow = (row: (typeof rows)[number]) => {
    const isHighlighted = row.cursor || (!focused && row.active);
    const fg = row.cursor
      ? theme.cursorFg()
      : !focused && row.active
        ? theme.cursorFg()
        : row.active
          ? theme.accent()
          : theme.normal();
    const bg = isHighlighted ? theme.cursorBg() : undefined;
    return (
      <text
        key={row.view}
        wrapMode="none"
        flexShrink={0}
        fg={fg}
        bg={bg}
        onMouseDown={(event) => {
          event.stopPropagation?.();
          store.setNavCursor(row.index);
          store.setView(row.view);
        }}
      >
        {formatRailRow(row, inner, focused)}
      </text>
    );
  };

  if (availRows >= fullGroupedLines) {
    return (
      <box
        flexDirection="column"
        width={width}
        border
        borderColor={focused ? theme.focusBorder() : theme.border()}
        padding={0}
        overflow="hidden"
        onMouseDown={(event) => {
          event.stopPropagation?.();
          store.setNavFocused(true);
        }}
        onMouseScroll={(event) => {
          event.stopPropagation?.();
          store.setNavFocused(true);
          const isUp = event.scroll?.direction === "up" || event.button === 4;
          store.moveNavCursor(isUp ? -1 : 1);
        }}
      >
        <text fg={focused ? theme.accent() : theme.dim()} wrapMode="none" flexShrink={0}>
          {" views"}
        </text>
        {NAV_GROUPS.flatMap((group) => {
          const groupRows = rows.filter((row) => VIEW_BY_ID.get(row.view)?.group === group);
          if (groupRows.length === 0) return [];
          return [
            <text key={`g-${group}`} fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {` ${group.toLowerCase()}`}
            </text>,
            ...groupRows.map(renderRailRow),
          ];
        })}
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {focused ? " ↑↓ Enter opens" : " [v]+key opens"}
        </text>
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {focused ? " Tab/Esc back" : " [ ] cycles"}
        </text>
      </box>
    );
  }

  // Compact/windowed mode for short terminals: window the view rows around the cursor or active view
  const anchorIdx = focused
    ? snapshot.navCursor
    : Math.max(
        0,
        rows.findIndex((r) => r.active),
      );
  const showFooterHint = availRows >= 6;
  const viewBudget = Math.max(1, availRows - 1 - (showFooterHint ? 1 : 0));
  const { start, end } = visibleSlice(anchorIdx, rows.length, viewBudget);
  const visibleRows = rows.slice(start, end);

  return (
    <box
      flexDirection="column"
      width={width}
      border
      borderColor={focused ? theme.focusBorder() : theme.border()}
      padding={0}
      overflow="hidden"
      onMouseDown={(event) => {
        event.stopPropagation?.();
        store.setNavFocused(true);
      }}
      onMouseScroll={(event) => {
        event.stopPropagation?.();
        store.setNavFocused(true);
        const isUp = event.scroll?.direction === "up" || event.button === 4;
        store.moveNavCursor(isUp ? -1 : 1);
      }}
    >
      <text fg={focused ? theme.accent() : theme.dim()} wrapMode="none" flexShrink={0}>
        {rows.length > viewBudget ? ` views ${start + 1}-${end}/${rows.length}` : " views"}
      </text>
      {visibleRows.map(renderRailRow)}
      {showFooterHint ? (
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {focused ? " ↑↓ Enter · Tab" : " [v]+key / [ ]"}
        </text>
      ) : null}
    </box>
  );
}

function formatRailRow(
  row: {
    label: string;
    view: ViewId;
    go: string;
    active: boolean;
    cursor: boolean;
    running: boolean;
  },
  inner: number,
  focused: boolean,
): string {
  const marker = row.cursor ? "> " : row.active ? (focused ? "• " : "> ") : "  ";
  const badge = row.running ? "*" : row.view === "cockpit" ? "" : row.go;
  const left = `${marker}${row.label}`;
  if (badge === "") {
    if (left.length <= inner) return left.padEnd(inner);
    return left.slice(0, inner);
  }
  const maxLeft = Math.max(2, inner - 2);
  const clippedLeft = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  return `${clippedLeft.padEnd(inner - 1)}${badge}`;
}

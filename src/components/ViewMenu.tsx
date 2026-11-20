import { RGBA } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import type { Store, ViewId } from "./store.ts";
import { theme } from "./theme.ts";
import { VIEW_BY_ID, VIEW_MENU_GROUPS, VIEW_ORDER } from "./views/viewRegistry.ts";
import { clampBoxLine, FOOTER_ROWS, visibleSlice } from "./windowing.ts";

const MENU_LABEL = "[F10] Views";
const DROPDOWN_TOP = 2;
const GROUP_LABELS = VIEW_MENU_GROUPS.map(({ title }) => ` ${title} ▾ `);
const GROUPS_WIDTH = GROUP_LABELS.reduce((width, label) => width + label.length + 1, 0);

function openGroup(store: Store, index: number) {
  const currentView = store.getSnapshot().view;
  const group = VIEW_MENU_GROUPS[index]!;
  const target = group.views.find((spec) => spec.id === currentView) ?? group.views[0]!;
  store.setNavFocused(true);
  store.setNavCursor(VIEW_ORDER.indexOf(target.id));
}

function groupIndex(view: ViewId): number {
  return VIEW_MENU_GROUPS.findIndex(({ title }) => title === VIEW_BY_ID.get(view)?.group);
}

export function moveViewMenuGroup(store: Store, direction: 1 | -1) {
  const index = groupIndex(VIEW_ORDER[store.getSnapshot().navCursor]!);
  openGroup(store, (index + direction + VIEW_MENU_GROUPS.length) % VIEW_MENU_GROUPS.length);
}

export function moveViewMenuRow(store: Store, movement: "first" | "last" | number) {
  const selected = VIEW_ORDER[store.getSnapshot().navCursor]!;
  const { views } = VIEW_MENU_GROUPS[groupIndex(selected)]!;
  const row = views.findIndex((entry) => entry.id === selected);
  const index =
    movement === "first"
      ? 0
      : movement === "last"
        ? views.length - 1
        : (row + movement + views.length) % views.length;
  store.setNavCursor(VIEW_ORDER.indexOf(views[index]!.id));
}

export function ViewMenuBar({ store, enabled }: { store: Store; enabled: boolean }) {
  const { width } = useTerminalDimensions();
  const { navFocused, navCursor, view } = store.getSnapshot();
  const activeGroup = groupIndex(navFocused ? VIEW_ORDER[navCursor]! : view);

  return (
    <box flexDirection="row" gap={1} height={1} flexShrink={0}>
      <text
        fg={enabled ? theme.accent() : theme.dim()}
        wrapMode="none"
        flexShrink={0}
        onMouseDown={(event) => {
          event.stopPropagation();
          if (enabled && event.button === 0) store.setNavFocused(!navFocused);
        }}
      >
        {MENU_LABEL}
      </text>
      {width - 2 >= MENU_LABEL.length + GROUPS_WIDTH ? (
        GROUP_LABELS.map((label, index) => (
          <text
            key={label}
            fg={
              activeGroup === index && navFocused
                ? theme.cursorFg()
                : enabled && activeGroup === index
                  ? theme.accent()
                  : theme.dim()
            }
            bg={navFocused && activeGroup === index ? theme.cursorBg() : undefined}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation();
              if (!enabled || event.button !== 0) return;
              if (navFocused && activeGroup === index) store.setNavFocused(false);
              else openGroup(store, index);
            }}
          >
            {label}
          </text>
        ))
      ) : (
        <text fg={theme.dim()} wrapMode="none">
          {VIEW_BY_ID.get(view)?.title}
        </text>
      )}
    </box>
  );
}

export function ViewMenuDropdown({ store }: { store: Store }) {
  const { width, height } = useTerminalDimensions();
  const { navCursor, view } = store.getSnapshot();
  const selected = VIEW_ORDER[navCursor]!;
  const index = groupIndex(selected);
  const group = VIEW_MENU_GROUPS[index]!;
  const dropdownWidth = Math.min(width, 34);
  const groupLeft =
    2 +
    MENU_LABEL.length +
    GROUP_LABELS.slice(0, index).reduce((left, label) => left + label.length + 1, 0);
  const anchor = width - 2 >= MENU_LABEL.length + GROUPS_WIDTH ? groupLeft : 1;
  const left = Math.max(0, Math.min(anchor, width - dropdownWidth));
  const cursor = group.views.findIndex((entry) => entry.id === selected);
  const space = Math.max(1, height - DROPDOWN_TOP - FOOTER_ROWS - 4);
  const window = visibleSlice(cursor, group.views.length, space);
  const innerWidth = dropdownWidth - 2;

  return (
    <>
      <box
        position="absolute"
        top={DROPDOWN_TOP}
        bottom={0}
        left={0}
        right={0}
        zIndex={10}
        onMouseDown={(event) => {
          event.stopPropagation();
          store.setNavFocused(false);
        }}
        onMouseScroll={(event) => event.stopPropagation()}
      />
      <box
        position="absolute"
        top={DROPDOWN_TOP}
        left={left}
        width={dropdownWidth}
        zIndex={11}
        border
        borderColor={theme.focusBorder()}
        backgroundColor={theme.background() ?? RGBA.defaultBackground()}
        flexDirection="column"
        onMouseDown={(event) => event.stopPropagation()}
        onMouseScroll={(event) => {
          event.stopPropagation();
          moveViewMenuRow(store, event.scroll?.direction === "up" ? -1 : 1);
        }}
      >
        <box flexDirection="row" gap={1}>
          <text fg={theme.accent()} onMouseDown={() => moveViewMenuGroup(store, -1)}>
            {"[←]"}
          </text>
          <text fg={theme.normal()}>{group.title}</text>
          <text fg={theme.accent()} onMouseDown={() => moveViewMenuGroup(store, 1)}>
            {"[→]"}
          </text>
        </box>
        {group.views.slice(window.start, window.end).map((entry) => {
          const highlighted = entry.id === selected;
          const marker = highlighted ? ">" : entry.id === view ? "•" : " ";
          const shortcut = `v ${entry.go}`;
          return (
            <text
              key={entry.id}
              fg={highlighted ? theme.cursorFg() : theme.normal()}
              bg={highlighted ? theme.cursorBg() : undefined}
              wrapMode="none"
              onMouseDown={(event) => {
                event.stopPropagation();
                if (event.button === 0) store.setView(entry.id);
              }}
            >
              {`${clampBoxLine(`${marker} ${entry.title}`, innerWidth - shortcut.length - 1).padEnd(innerWidth - shortcut.length)}${shortcut}`}
            </text>
          );
        })}
        <text fg={theme.dim()} wrapMode="none">
          {clampBoxLine("↑↓ Move · Enter Open · Esc Close", innerWidth)}
        </text>
      </box>
    </>
  );
}

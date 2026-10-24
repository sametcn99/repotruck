import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { visibleSlice } from "./windowing.ts";

const KEY_FG = theme.focusBorder();

// Border (2) + padding (2) + hint (1) + breathing room (2).
const HELP_VIEW_RESERVED_ROWS = 7;

const HELP_ROWS: readonly [string, string][] = [
  ["Tab", "Cycle focus: sidebar, repository list, status panel"],
  [
    "Up / Down",
    "Move the cursor in the focused region; with the status panel focused, scroll the activity log",
  ],
  ["Home / End", "Jump the repository cursor to the first or last row"],
  ["PgUp / PgDn", "Page the repository cursor by one viewport"],
  [
    "Space",
    "Select/deselect the highlighted repository; sidebar: toggle the row; wizard: toggle source/visibility",
  ],
  ["a", "Select all filtered repositories (press again to clear)"],
  ["/", "Search repositories by owner or name (filters as you type; Enter closes, Escape clears)"],
  ["s", "Cycle sort: name, language, updated"],
  ["S", "Reverse the current sort direction"],
  ["i", "Show details for the highlighted repository (description, stars, ahead/behind, alias)"],
  ["c", "Open the clone modal (URL or owner/name)"],
  ["n", "Open the new-repository wizard (Left goes back a step)"],
  ["m", "Open the move modal for the highlighted repository"],
  ["z", "Undo the last move or delete (restores the directory and its inventory entry)"],
  ["u", "Untrack the highlighted repository — asks for confirmation (the clone stays on disk)"],
  ["D", "Delete the highlighted repository (moves it to .repotruck/trash; asks for confirmation)"],
  ["R", "Reorganize: pick a preset, preview the moves, then apply (k toggles keep-custom)"],
  ["w", "Open the workspace picker (x inside removes an entry from the registry)"],
  ["p", "Cycle the preset (affects new clones)"],
  ["o", "Open the highlighted repository in an app (dashboard resumes after the app exits)"],
  ["r", "Set an alias for the highlighted repository"],
  ["d", "Open the default-root modal"],
  [
    "Enter",
    "List focus: open the start preview for the selected repositories. Sidebar focus: confirm the row. Wizard: advance steps",
  ],
  ["q", "Quit (press twice in quick succession while a sync is running)"],
  ["x", "Dismiss the update toast (remembered once per version)"],
  ["Wheel", "Scroll lists (repositories, status log, sidebar, modals)"],
  ["Click", "Select/activate items, toggle checkboxes, click buttons, focus panes"],
  ["Double-click", "Open repository details / switch workspace / launch app"],
  ["Right-click", "Show repository details / dismiss open modal"],
  ["Escape", "Close any open modal; with no modal open, clear the active search"],
];

export function HelpModal({ store }: { store: Store }) {
  const { height } = useTerminalDimensions();
  const [cursor, setCursor] = useState(0);
  const total = HELP_ROWS.length;
  const bounded = Math.min(Math.max(cursor, 0), Math.max(0, total - 1));
  const viewportRows = Math.max(1, height - HELP_VIEW_RESERVED_ROWS);
  const window = visibleSlice(bounded, total, viewportRows);
  const shown = HELP_ROWS.slice(window.start, window.end);

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return") {
      store.closeModal();
      return;
    }
    if (key.name === "up") {
      setCursor(Math.max(0, bounded - 1));
    } else if (key.name === "down") {
      setCursor(Math.min(total - 1, bounded + 1));
    } else if (key.name === "home") {
      setCursor(0);
    } else if (key.name === "end") {
      setCursor(total - 1);
    } else if (key.name === "pageup") {
      setCursor(Math.max(0, bounded - viewportRows));
    } else if (key.name === "pagedown") {
      setCursor(Math.min(total - 1, bounded + viewportRows));
    }
  });

  return (
    <ModalShell
      store={store}
      title="Keyboard shortcuts"
      hint="Up/Down scroll · Escape closes"
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) => Math.min(total - 1, Math.max(0, c + (isUp ? -3 : 3))));
      }}
    >
      {shown.map(([key, action], index) => (
        <text
          key={key}
          fg={KEY_FG}
          onMouseDown={(e) => {
            if (e.button === 0) {
              e.stopPropagation();
              setCursor(window.start + index);
            }
          }}
        >{`${key.padEnd(14)} ${action}`}</text>
      ))}
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={theme.dim()}
          onMouseDown={(e) => {
            e.stopPropagation();
            store.closeModal();
          }}
        >
          {"[ Close ]"}
        </text>
      </box>
    </ModalShell>
  );
}

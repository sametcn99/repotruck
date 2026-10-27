import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { visibleSlice } from "./windowing.ts";

// Border (2) + padding (2) + hint (1) + breathing room (2).
const HELP_VIEW_RESERVED_ROWS = 7;

const HELP_ROWS: readonly [string, string][] = [
  ["Tab", "Cycle focus: sidebar, repository list, status panel"],
  [
    "Up/Down, j/k",
    "Move the cursor in the focused region; with the status panel focused, scroll the activity log",
  ],
  ["Home/End, g/G", "Jump the repository cursor to the first or last row"],
  ["PgUp / PgDn", "Page the repository cursor by one viewport"],
  [
    "Space",
    "Select/deselect the highlighted repository; sidebar: toggle the row; wizard: toggle source/visibility",
  ],
  ["a", "Select all filtered repositories (press again to clear)"],
  ["/", "Inline live search by owner, name, or @alias (Enter keeps filter, Escape clears)"],
  [": / Ctrl+K", "Open Omnibar in Command Palette mode (Tab cycles modes)"],
  ["@", "Open Omnibar in Workspace Code Search mode (prefix text: for line search)"],
  ["#", "Open Omnibar in GitHub Discover mode (Enter clones directly)"],
  ["!", "Open Omnibar in Bulk Command Runner mode (runs across selected/all repos)"],
  ["f", "Cycle local Git health filter (all, dirty, ahead, behind, pinned, local, uncloned)"],
  ["P", "Pin / unpin selected or highlighted repositories (Active Focus in AGENTS.md)"],
  ["1 / 2 / 3", "Switch right pane tab: [1] Activity · [2] Git Inspector · [3] Health & Doctor"],
  ["F", "Run Doctor auto-fix when the [3] Health tab is active"],
  ["t", "Cycle color theme live (default, light, contrast) and persist to settings"],
  ["s", "Cycle sort: default, name, language, updated (use Omnibar for stars/dirty)"],
  ["S", "Reverse the current sort direction"],
  ["i", "Show details for the highlighted repository (description, stars, ahead/behind, alias)"],
  ["c", "Open the clone modal (URL or owner/name)"],
  ["n", "Open the new-repository wizard (Left goes back a step)"],
  ["m", "Open the move modal for the highlighted repository"],
  ["z", "Undo the last move or delete (restores the directory and its inventory entry)"],
  ["u", "Untrack selected or highlighted repository — asks for confirmation (clones stay on disk)"],
  ["D", "Delete selected or highlighted repository to .repotruck/trash (asks for confirmation)"],
  ["A", "Archive selected or highlighted repository on GitHub and move to archived/"],
  ["R", "Reorganize: pick a preset, preview the moves, then apply (k toggles keep-custom)"],
  ["w", "Open the workspace picker (x inside removes an entry from the registry)"],
  ["p", "Cycle the preset (affects new clones)"],
  ["o", "Open the highlighted repository in an app (or enter Offline Mode on auth error)"],
  ["r", "Set an alias for the highlighted repository (or retry connection on auth error)"],
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
  const keyFg = theme.focusBorder();

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return") {
      store.closeModal();
      return;
    }
    if (key.name === "up" || key.sequence === "k") {
      setCursor(Math.max(0, bounded - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setCursor(Math.min(total - 1, bounded + 1));
    } else if (key.name === "home" || key.sequence === "g") {
      setCursor(0);
    } else if (key.name === "end" || key.sequence === "G") {
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
      hint="Up/Down or j/k scroll · Escape closes"
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) => Math.min(total - 1, Math.max(0, c + (isUp ? -3 : 3))));
      }}
    >
      {shown.map(([key, action], index) => (
        <text
          key={key}
          fg={keyFg}
          onMouseDown={(e) => {
            if (e.button === 0) {
              e.stopPropagation();
              setCursor(window.start + index);
            }
          }}
        >{`${key.padEnd(15)} ${action}`}</text>
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

import { VIEW_SPECS } from "../components/views/viewRegistry.ts";
import { REGISTRY } from "./registry.ts";

export type HelpRow = readonly [string, string];

/**
 * Dashboard keybinding table — the single source shared by the in-app `?`
 * help and the generated website shortcuts table. Rows with an empty
 * action are section headers.
 */
export const KEYBINDING_ROWS: readonly (readonly [string, string])[] = [
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
  ["W", "Open the worktree modal for the highlighted repository"],
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
  ["v + letter", "Open a page directly (letters listed in the Views section below)"],
  ["[ / ]", "Cycle to the previous / next page"],
  ["→ (Right)", "Repository list: open the context menu for the cursor row"],
  ["Wheel", "Scroll lists (repositories, status log, sidebar, modals)"],
  ["Click", "Select/activate items, toggle checkboxes, click buttons, focus panes"],
  ["Double-click", "Open repository details / switch workspace / launch app"],
  ["Right-click", "Open the repository context menu / dismiss open modal"],
  [
    "Escape",
    "Close any open modal or page back to the cockpit; with no modal open, clear the active search",
  ],
];

/**
 * Help content generated from the registries so new pages and command
 * surfaces appear in the `?` screen without manual edits. Keybinding rows
 * come from KEYBINDING_ROWS above.
 */
export function buildViewHelpRows(): HelpRow[] {
  const groups = new Map<string, HelpRow[]>();
  for (const spec of VIEW_SPECS) {
    if (spec.id === "cockpit") continue;
    const rows = groups.get(spec.group) ?? [];
    rows.push([`v ${spec.go}`, `${spec.title} — ${spec.summary}`]);
    groups.set(spec.group, rows);
  }
  const rows: HelpRow[] = [["— Views —", ""]];
  for (const group of [...groups.keys()]) {
    rows.push([`· ${group.toLowerCase()}`, ""]);
    rows.push(...(groups.get(group) ?? []));
  }
  return rows;
}

/** One-line parity dashboard shown at the bottom of the help screen. */
export function buildRegistrySummaryLine(): string {
  const commands = REGISTRY.filter((spec) => spec.id !== "__globals__").length;
  const flags = REGISTRY.reduce((total, spec) => total + spec.flags.length, 0);
  return `${commands} CLI commands · ${flags} flags mapped to TUI surfaces (parity test enforces)`;
}

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
  ["Up/Down, j/k", "Move cursor; status panel focus scrolls the activity log"],
  ["Home/End, g/G", "Jump the repository cursor to the first or last row"],
  ["PgUp / PgDn", "Page the repository cursor by one viewport"],
  ["Space", "Select repo; sidebar/wizard toggle"],
  ["a", "Select all filtered repositories (press again to clear)"],
  ["/", "Live search: owner, name, @alias"],
  [": / Ctrl+K", "Omnibar command palette (Tab cycles modes)"],
  ["@", "Omnibar code search (text: prefix for line search)"],
  ["#", "Omnibar GitHub discover (Enter clones)"],
  ["!", "Omnibar bulk runner (selected/all repos)"],
  ["f", "Cycle git health filter (all/dirty/ahead/behind/pinned)"],
  ["P", "Pin / unpin selected or highlighted repositories (Active Focus in AGENTS.md)"],
  ["1 / 2 / 3", "Switch right pane tab: [1] Activity · [2] Git Inspector · [3] Health & Doctor"],
  ["F", "Run Doctor auto-fix when the [3] Health tab is active"],
  ["t", "Cycle color theme live (default, light, contrast) and persist to settings"],
  ["s", "Cycle sort: default/name/language/updated"],
  ["S", "Reverse the current sort direction"],
  ["i", "Repo details: stars, ahead/behind, alias"],
  ["c", "Open the clone modal (URL or owner/name)"],
  ["n", "New repo wizard (Left goes back)"],
  ["m", "Open move modal for repo"],
  ["z", "Undo the last move or delete (restores the directory and its inventory entry)"],
  ["u", "Untrack repo (files stay on disk)"],
  ["D", "Delete repo to .repotruck/trash"],
  ["A", "Archive repo on GitHub to archived/"],
  ["R", "Reorganize: preset, preview, apply"],
  ["W", "Open the worktree modal for the highlighted repository"],
  ["w", "Workspace picker (x removes entry)"],
  ["p", "Cycle the preset (affects new clones)"],
  ["o", "Open repo in app (or Offline Mode)"],
  ["r", "Set alias (or retry on auth error)"],
  ["d", "Open the default-root modal"],
  ["Enter", "Open sync preview; sidebar confirm; wizard advance"],
  ["q", "Quit (press twice in quick succession while a sync is running)"],
  ["x", "Dismiss the update toast (remembered once per version)"],
  ["v + letter", "Open a page directly (letters listed in the Views section below)"],
  ["[ / ]", "Cycle to the previous / next page"],
  ["→ (Right)", "Repository list: open the context menu for the cursor row"],
  ["Wheel", "Scroll lists (repositories, status log, sidebar, modals)"],
  ["Click", "Select/activate items, toggle checkboxes, click buttons, focus panes"],
  ["Double-click", "Open repository details / switch workspace / launch app"],
  ["Right-click", "Open the repository context menu / dismiss open modal"],
  ["Escape", "Close modal/page; clear search"],
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

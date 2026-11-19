// AUTO-GENERATED from src/commands/helpData.ts — do not edit by hand.
// Regenerate with: bun run docs:gen   (drift fails CI via: bun run docs:check)

export interface ShortcutRow {
  key: string;
  action: string;
}

export const SHORTCUT_ROWS: readonly ShortcutRow[] = [
  {
    key: "Tab",
    action: "Cycle focus: sidebar, repository list, status panel",
  },
  {
    key: "Up/Down, j/k",
    action:
      "Move the cursor in the focused region; with the status panel focused, scroll the activity log",
  },
  {
    key: "Home/End, g/G",
    action: "Jump the repository cursor to the first or last row",
  },
  {
    key: "PgUp / PgDn",
    action: "Page the repository cursor by one viewport",
  },
  {
    key: "Space",
    action:
      "Select/deselect the highlighted repository; sidebar: toggle the row; wizard: toggle source/visibility",
  },
  {
    key: "a",
    action: "Select all filtered repositories (press again to clear)",
  },
  {
    key: "/",
    action: "Inline live search by owner, name, or @alias (Enter keeps filter, Escape clears)",
  },
  {
    key: ": / Ctrl+K",
    action: "Open Omnibar in Command Palette mode (Tab cycles modes)",
  },
  {
    key: "@",
    action: "Open Omnibar in Workspace Code Search mode (prefix text: for line search)",
  },
  {
    key: "#",
    action: "Open Omnibar in GitHub Discover mode (Enter clones directly)",
  },
  {
    key: "!",
    action: "Open Omnibar in Bulk Command Runner mode (runs across selected/all repos)",
  },
  {
    key: "f",
    action: "Cycle local Git health filter (all, dirty, ahead, behind, pinned, local, uncloned)",
  },
  {
    key: "P",
    action: "Pin / unpin selected or highlighted repositories (Active Focus in AGENTS.md)",
  },
  {
    key: "1 / 2 / 3",
    action: "Switch right pane tab: [1] Activity · [2] Git Inspector · [3] Health & Doctor",
  },
  {
    key: "F",
    action: "Run Doctor auto-fix when the [3] Health tab is active",
  },
  {
    key: "t",
    action: "Cycle color theme live (default, light, contrast) and persist to settings",
  },
  {
    key: "s",
    action: "Cycle sort: default, name, language, updated (use Omnibar for stars/dirty)",
  },
  {
    key: "S",
    action: "Reverse the current sort direction",
  },
  {
    key: "i",
    action: "Show details for the highlighted repository (description, stars, ahead/behind, alias)",
  },
  {
    key: "c",
    action: "Open the clone modal (URL or owner/name)",
  },
  {
    key: "n",
    action: "Open the new-repository wizard (Left goes back a step)",
  },
  {
    key: "m",
    action: "Open the move modal for the highlighted repository",
  },
  {
    key: "z",
    action: "Undo the last move or delete (restores the directory and its inventory entry)",
  },
  {
    key: "u",
    action:
      "Untrack selected or highlighted repository — asks for confirmation (clones stay on disk)",
  },
  {
    key: "D",
    action: "Delete selected or highlighted repository to .repotruck/trash (asks for confirmation)",
  },
  {
    key: "A",
    action: "Archive selected or highlighted repository on GitHub and move to archived/",
  },
  {
    key: "R",
    action: "Reorganize: pick a preset, preview the moves, then apply (k toggles keep-custom)",
  },
  {
    key: "W",
    action: "Open the worktree modal for the highlighted repository",
  },
  {
    key: "w",
    action: "Open the workspace picker (x inside removes an entry from the registry)",
  },
  {
    key: "p",
    action: "Cycle the preset (affects new clones)",
  },
  {
    key: "o",
    action: "Open the highlighted repository in an app (or enter Offline Mode on auth error)",
  },
  {
    key: "r",
    action: "Set an alias for the highlighted repository (or retry connection on auth error)",
  },
  {
    key: "d",
    action: "Open the default-root modal",
  },
  {
    key: "Enter",
    action:
      "List focus: open the start preview for the selected repositories. Sidebar focus: confirm the row. Wizard: advance steps",
  },
  {
    key: "q",
    action: "Quit (press twice in quick succession while a sync is running)",
  },
  {
    key: "x",
    action: "Dismiss the update toast (remembered once per version)",
  },
  {
    key: "v + letter",
    action: "Open a page directly (letters listed in the Views section below)",
  },
  {
    key: "[ / ]",
    action: "Cycle to the previous / next page",
  },
  {
    key: "→ (Right)",
    action: "Repository list: open the context menu for the cursor row",
  },
  {
    key: "Wheel",
    action: "Scroll lists (repositories, status log, sidebar, modals)",
  },
  {
    key: "Click",
    action: "Select/activate items, toggle checkboxes, click buttons, focus panes",
  },
  {
    key: "Double-click",
    action: "Open repository details / switch workspace / launch app",
  },
  {
    key: "Right-click",
    action: "Open the repository context menu / dismiss open modal",
  },
  {
    key: "Escape",
    action:
      "Close any open modal or page back to the cockpit; with no modal open, clear the active search",
  },
  {
    key: "v s",
    action: "Sync Center — bulk sync with every flag plus watch mode",
  },
  {
    key: "v d",
    action: "Discover — qualified GitHub search and bulk clone",
  },
  {
    key: "v n",
    action: "Scan — find unregistered repos and adopt them",
  },
  {
    key: "v x",
    action: "Conflict Resolver — inspect and continue/abort stuck rebases",
  },
  {
    key: "v t",
    action: "Status — per-repo git health across the workspace",
  },
  {
    key: "v e",
    action: "Code Search — tree-sitter symbol, text and regex search",
  },
  {
    key: "v i",
    action: "Stats — language, disk and health scorecard",
  },
  {
    key: "v c",
    action: "Changelog — workspace changelog preview and export",
  },
  {
    key: "v r",
    action: "Run Console — run a command across selected repositories",
  },
  {
    key: "v p",
    action: "Presets — browse, build and remove layout presets",
  },
  {
    key: "v f",
    action: "Profiles — pinned repos and named repository profiles",
  },
  {
    key: "v b",
    action: "Trash — restore trashed repos and snapshots",
  },
  {
    key: "v w",
    action: "Worktrees — workspace-wide linked worktree browser",
  },
  {
    key: "v g",
    action: "Agents — AGENTS.md templates, exports and MCP server",
  },
  {
    key: "v a",
    action: "Settings — configuration, auth, update and completions",
  },
];

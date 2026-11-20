// AUTO-GENERATED from src/commands/helpData.ts — do not edit by hand.
// Regenerate with: bun run docs:gen   (drift fails CI via: bun run docs:check)

export interface ShortcutRow {
  key: string;
  action: string;
}

export const SHORTCUT_ROWS: readonly ShortcutRow[] = [
  {
    key: "F10",
    action: "Open Views menu · ←/→ groups · ↑/↓ views · Enter opens",
  },
  {
    key: "? / F1",
    action: "Show shortcuts for this screen (F1 also works while typing)",
  },
  {
    key: "Tab / Shift+Tab",
    action: "Move focus between cockpit panes or worktree fields",
  },
  {
    key: "Escape",
    action: "Leave input, close the menu or dialog, or return to Cockpit",
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
    key: ": / Ctrl+K",
    action: "Omnibar command palette (Tab cycles modes)",
  },
  {
    key: "q",
    action: "Quit (press twice in quick succession while a sync is running)",
  },
  {
    key: "Up/Down, j/k",
    action: "Move cursor; status panel focus scrolls the activity log",
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
    action: "Select repo; sidebar/wizard toggle",
  },
  {
    key: "a",
    action: "Select all filtered repositories (press again to clear)",
  },
  {
    key: "/",
    action: "Live search: owner, name, @alias",
  },
  {
    key: "@",
    action: "Omnibar code search (text: prefix for line search)",
  },
  {
    key: "#",
    action: "Omnibar GitHub discover (Enter clones)",
  },
  {
    key: "!",
    action: "Omnibar bulk runner (selected/all repos)",
  },
  {
    key: "f",
    action: "Cycle git health filter (all/dirty/ahead/behind/pinned)",
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
    action: "Cycle sort: default/name/language/updated",
  },
  {
    key: "S",
    action: "Reverse the current sort direction",
  },
  {
    key: "i",
    action: "Repo details: stars, ahead/behind, alias",
  },
  {
    key: "c",
    action: "Open the clone modal (URL or owner/name)",
  },
  {
    key: "n",
    action: "New repo wizard (Shift+Tab goes back)",
  },
  {
    key: "m",
    action: "Open move modal for repo",
  },
  {
    key: "z",
    action: "Undo the last move or delete (restores the directory and its inventory entry)",
  },
  {
    key: "u",
    action: "Untrack repo (files stay on disk)",
  },
  {
    key: "D",
    action: "Delete repo to .repotruck/trash",
  },
  {
    key: "A",
    action: "Archive repo on GitHub to archived/",
  },
  {
    key: "R",
    action: "Reorganize: preset, preview, apply",
  },
  {
    key: "W",
    action: "Open the worktree modal for the highlighted repository",
  },
  {
    key: "w",
    action: "Workspace picker (x removes entry)",
  },
  {
    key: "p",
    action: "Cycle the preset (affects new clones)",
  },
  {
    key: "o",
    action: "Open repo in app (or Offline Mode)",
  },
  {
    key: "r",
    action: "Set alias (or retry on auth error)",
  },
  {
    key: "d",
    action: "Open the default-root modal",
  },
  {
    key: "Enter",
    action: "Open sync preview; sidebar confirm; wizard advance",
  },
  {
    key: "x",
    action: "Dismiss the update toast (remembered once per version)",
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
    key: "v h",
    action: "Cockpit — scope, repository list and activity",
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
    action: "Conflicts — inspect and continue/abort stuck rebases",
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
  {
    key: "v l",
    action: "Log — captured errors, warnings and runtime diagnostics",
  },
];

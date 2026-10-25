interface ShortcutRow {
  key: string;
  action: string;
}

const ROWS: readonly ShortcutRow[] = [
  { key: "Tab", action: "Cycle focus: sidebar, repository list, status panel" },
  {
    key: "Up / Down",
    action: "Move the cursor in the focused region; with status panel focused, scroll activity log",
  },
  { key: "Home / End", action: "Jump repository cursor to the first or last row" },
  { key: "PgUp / PgDn", action: "Page repository cursor by one viewport" },
  {
    key: "Space",
    action: "Select/deselect highlighted repository; toggle sidebar row; toggle wizard option",
  },
  { key: "a", action: "Select all filtered repositories (press again to clear)" },
  {
    key: "/",
    action:
      "Search repositories by owner or name (filters live as you type; Enter closes, Escape clears)",
  },
  { key: "s", action: "Cycle sort: name, language, updated" },
  { key: "S", action: "Reverse current sort direction" },
  {
    key: "i",
    action:
      "Show details modal for highlighted repository (description, stars, ahead/behind diffs, alias)",
  },
  { key: "c", action: "Open clone modal (URL or owner/name)" },
  {
    key: "n",
    action: "Open new-repository wizard (name, source, path, visibility; Left goes back)",
  },
  { key: "m", action: "Open move modal for highlighted repository" },
  { key: "z", action: "Undo last move or delete (restores directory and inventory entry)" },
  { key: "u", action: "Untrack highlighted repository — confirmation modal (files stay on disk)" },
  {
    key: "D",
    action: "Delete highlighted repository (parks clone in .repotruck/trash; z undoes)",
  },
  { key: "R", action: "Reorganize: pick preset, preview move plan, apply (k toggles keep-custom)" },
  { key: "w", action: "Open workspace picker (x inside removes an entry from registry)" },
  { key: "p", action: "Cycle preset (affects new clones)" },
  {
    key: "o",
    action:
      "Open highlighted repository in an app (claude, cursor, vscode, ...; dashboard resumes after app exits)",
  },
  { key: "r", action: "Set an alias for the highlighted repository" },
  { key: "d", action: "Open default workspace root modal" },
  {
    key: "Enter",
    action:
      "Open start preview for selected repositories to sync; confirm sidebar row; advance wizard steps",
  },
  { key: "q", action: "Quit (press twice in quick succession while sync runs)" },
  { key: "x", action: "Dismiss update toast (remembered once per version)" },
  { key: "Escape", action: "Close any open modal; with no modal open, clear active search" },
  { key: "?", action: "Open keyboard shortcuts help modal" },
  { key: "Wheel", action: "Scroll lists (repositories, status log, sidebar, modals)" },
  { key: "Click", action: "Select/activate items, toggle checkboxes, click buttons, focus panes" },
  { key: "Double-click", action: "Open repository details / switch workspace / launch app" },
  { key: "Right-click", action: "Show repository details / dismiss open modal" },
];

export function ShortcutsTable() {
  return (
    <section className="section" id="shortcuts" aria-label="Keyboard shortcuts">
      <h2>Keyboard & mouse shortcuts</h2>
      <p className="section-sub">
        The dashboard footer highlights quick navigation (
        <code>[Tab] Focus [Space] Select [?] Help [q] Quit</code>). Every workspace operation is
        reachable from keyboard and mouse:
      </p>
      <div className="panel">
        <span className="panel-label">Controls</span>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Input</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key}>
                <td data-label="Input" className="key">
                  {row.key}
                </td>
                <td data-label="Action">{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

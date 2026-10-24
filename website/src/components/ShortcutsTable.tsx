interface ShortcutRow {
  key: string;
  action: string;
}

const ROWS: readonly ShortcutRow[] = [
  { key: "Tab", action: "Cycle focus: sidebar, repository list, status panel" },
  { key: "Up / Down", action: "Move the cursor in the focused region" },
  { key: "Space", action: "Select/deselect the highlighted repository; toggle the sidebar row" },
  { key: "a", action: "Select all filtered repositories (press again to clear)" },
  { key: "c", action: "Clone a repository by URL" },
  { key: "m", action: "Move the highlighted repository to a custom path" },
  { key: "w", action: "Open the workspace picker" },
  { key: "n", action: "New repository wizard (name, path, visibility)" },
  { key: "p", action: "Cycle the preset (affects new clones)" },
  {
    key: "Enter",
    action: "Start syncing the selected repositories; confirm sidebar rows; advance wizard steps",
  },
  { key: "q", action: "Quit" },
  { key: "Escape", action: "Close any modal; cancels the create wizard at any step" },
];

export function ShortcutsTable() {
  return (
    <section className="section" id="shortcuts" aria-label="Keyboard shortcuts">
      <h2>Keyboard shortcuts</h2>
      <p className="section-sub">
        The same keys the dashboard footer shows: [Tab] Focus [Space] Select [a] All [c] Clone [m]
        Move [w] Workspaces [n] New [p] Preset [Enter] Start [q] Quit.
      </p>
      <div className="panel">
        <span className="panel-label">Keys</span>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key}>
                <td data-label="Key" className="key">
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

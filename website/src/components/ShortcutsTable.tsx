/**
 * Keyboard & mouse shortcuts for the docs site — generated from the
 * in-app help source (src/commands/helpData.ts) so the website table can
 * never drift from the dashboard. Regenerate with `bun run docs:gen`.
 */
import { SHORTCUT_ROWS, type ShortcutRow } from "./shortcuts.generated.ts";

const ROWS: readonly ShortcutRow[] = SHORTCUT_ROWS;

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

import type { ViewId } from "./store/types.ts";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { NAV_GROUPS, VIEW_BY_ID, VIEW_SPECS } from "./views/viewRegistry.ts";

/**
 * Persistent left navigation rail listing every dashboard view, grouped
 * like the prototype. Click a row to open its page; the sync row carries a
 * live marker while a background task runs. Hidden on narrow terminals —
 * the `v`-prefix keys and `[`/`]` cycling cover navigation there.
 */
export function NavRail({ store, width }: { store: Store; width: number }) {
  const snapshot = store.getSnapshot();
  const inner = Math.max(6, width - 4);

  const rows: { label: string; view: ViewId; active: boolean; running: boolean }[] = [];
  for (const spec of VIEW_SPECS) {
    rows.push({
      label: spec.title,
      view: spec.id,
      active: snapshot.view === spec.id,
      running:
        snapshot.running && (spec.id === "sync" || spec.id === "run" || spec.id === "cockpit"),
    });
  }

  return (
    <box flexDirection="column" width={width} border borderColor={theme.border()} padding={0}>
      <text fg={theme.dim()}> views</text>
      {NAV_GROUPS.flatMap((group) => {
        const groupRows = rows.filter((row) => VIEW_BY_ID.get(row.view)?.group === group);
        if (groupRows.length === 0) return [];
        return [
          <text key={`g-${group}`} fg={theme.dim()}>
            {` ${group.toLowerCase()}`}
          </text>,
          ...groupRows.map((row) => (
            <text
              key={row.view}
              fg={row.active ? theme.accent() : theme.normal()}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                store.setView(row.view);
              }}
            >
              {formatRailRow(row, inner)}
            </text>
          )),
        ];
      })}
      <text fg={theme.dim()}>{" [v]+key opens"}</text>
      <text fg={theme.dim()}>{" [ ] cycles"}</text>
    </box>
  );
}

function formatRailRow(
  row: { label: string; active: boolean; running: boolean },
  inner: number,
): string {
  const marker = row.active ? "> " : "  ";
  const run = row.running ? " *" : "";
  const text = `${marker}${row.label}${run}`;
  if (text.length <= inner) return text;
  return `${text.slice(0, Math.max(1, inner - 1))}`;
}

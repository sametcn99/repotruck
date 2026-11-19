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
  const inner = Math.max(6, width - 2);

  const rows: {
    label: string;
    view: ViewId;
    go: string;
    active: boolean;
    running: boolean;
  }[] = [];
  for (const spec of VIEW_SPECS) {
    rows.push({
      label: spec.title,
      view: spec.id,
      go: spec.go,
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
              fg={row.active ? theme.cursorFg() : theme.normal()}
              bg={row.active ? theme.cursorBg() : undefined}
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
  row: { label: string; view: ViewId; go: string; active: boolean; running: boolean },
  inner: number,
): string {
  const marker = row.active ? "> " : "  ";
  const badge = row.running ? "*" : row.view === "cockpit" ? "" : row.go;
  const left = `${marker}${row.label}`;
  if (badge === "") {
    if (left.length <= inner) return left.padEnd(inner);
    return left.slice(0, inner);
  }
  const maxLeft = Math.max(2, inner - 2);
  const clippedLeft = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  return `${clippedLeft.padEnd(inner - 1)}${badge}`;
}

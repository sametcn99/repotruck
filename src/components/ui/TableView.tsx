import { theme } from "../theme.ts";
import { visibleSlice } from "../windowing.ts";

export interface TableColumn<R> {
  key: string;
  label: string;
  width?: number;
  render?: (row: R) => string;
}

export interface TableRow<R> {
  row: R;
  /** Flat label used for the cursor line and matching. */
  cells: readonly string[];
  /** Expanded detail lines shown under the row when open. */
  detail?: readonly string[];
}

/**
 * Windowed, cursor-driven table. Purely presentational: the owning view
 * supplies rows, cursor and expanded id plus their setters, exactly like
 * RepoList does — so page components stay thin and testable.
 */
export function TableView<R>({
  columns,
  rows,
  cursor,
  onCursor,
  expandedId,
  onToggleExpand,
  viewportRows,
  width,
  emptyLabel = "no rows",
}: {
  columns: readonly TableColumn<R>[];
  rows: readonly TableRow<R>[];
  cursor: number;
  onCursor: (index: number) => void;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  viewportRows: number;
  width: number;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return <text fg={theme.dim()}>{` ${emptyLabel}`}</text>;
  }

  const slice = visibleSlice(cursor, rows.length, viewportRows);
  const header = formatHeader(columns, rows, width);

  return (
    <box flexDirection="column" width="100%">
      <text fg={theme.dim()}>{header}</text>
      {rows.slice(slice.start, slice.end).map((entry, offset) => {
        const index = slice.start + offset;
        const active = index === cursor;
        const line = formatRow(columns, entry, active, width);
        const rowId = entry.cells[0] ?? String(index);
        return (
          <box key={rowId} flexDirection="column">
            <text
              fg={active ? theme.accent() : theme.normal()}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                if (active) onToggleExpand(rowId);
                else onCursor(index);
              }}
            >
              {line}
            </text>
            {expandedId === rowId && entry.detail !== undefined
              ? entry.detail.map((detailLine) => (
                  <text key={detailLine} fg={theme.dim()}>
                    {`  ${detailLine}`}
                  </text>
                ))
              : null}
          </box>
        );
      })}
    </box>
  );
}

function columnWidths<R>(
  columns: readonly TableColumn<R>[],
  rows: readonly TableRow<R>[],
  width: number,
): number[] {
  const sample = rows.slice(0, 100);
  const usable = Math.max(columns.length * 4, width - 2);
  const wanted = columns.map((col, i) => {
    const contentMax = sample.reduce(
      (max, entry) => Math.max(max, String(entry.cells[i] ?? "").length),
      col.label.length,
    );
    return Math.max(col.label.length + 1, contentMax);
  });
  const wantedTotal = wanted.reduce((a, b) => a + b, 0);
  if (wantedTotal <= usable) return wanted;
  return wanted.map((w) => Math.max(3, Math.floor((w * usable) / wantedTotal)));
}

function formatHeader<R>(
  columns: readonly TableColumn<R>[],
  rows: readonly TableRow<R>[],
  width: number,
): string {
  const widths = columnWidths(columns, rows, width);
  const parts = columns.map((col, i) => pad(col.label, widths[i]!));
  return ` ${parts.join(" ")}`.slice(0, Math.max(4, width - 2));
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}

function formatRow<R>(
  columns: readonly TableColumn<R>[],
  entry: TableRow<R>,
  active: boolean,
  width: number,
): string {
  const widths = columnWidths(columns, [entry], width);
  const marker = active ? ">" : " ";
  const parts = entry.cells.map((cell, i) => pad(String(cell), widths[i]!));
  return `${marker}${parts.join(" ")}`.slice(0, Math.max(4, width - 2));
}

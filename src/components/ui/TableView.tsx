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

function clampLine(text: string, maxCols: number): string {
  if (text.length <= maxCols) return text;
  return `${text.slice(0, Math.max(1, maxCols - 1))}…`;
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
  focused = true,
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
  focused?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {` ${emptyLabel}`}
      </text>
    );
  }

  const maxCols = Math.max(12, width);
  const slice = visibleSlice(cursor, rows.length, viewportRows);
  // Column widths are computed once from the full row set so every row
  // (and the header) shares the same grid.
  const widths = columnWidths(columns, rows, width);
  const header = clampLine(formatHeader(columns, widths), maxCols);

  return (
    <box flexDirection="column" width="100%">
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {header}
      </text>
      {rows.slice(slice.start, slice.end).map((entry, offset) => {
        const index = slice.start + offset;
        const active = index === cursor;
        const line = clampLine(formatRow(entry, active, widths), maxCols);
        const rowId = entry.cells[0] ?? String(index);
        return (
          <box key={rowId} flexDirection="column" flexShrink={0}>
            <text
              fg={active ? (focused ? theme.cursorFg() : theme.accent()) : theme.normal()}
              bg={active && focused ? theme.cursorBg() : undefined}
              wrapMode="none"
              flexShrink={0}
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
                  <text key={detailLine} fg={theme.dim()} wrapMode="none" flexShrink={0}>
                    {clampLine(`  ${detailLine}`, maxCols)}
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
  const gaps = Math.max(0, columns.length);
  const usable = Math.max(columns.length * 3, width - gaps - 2);
  const wanted = columns.map((col, i) => {
    const contentMax = sample.reduce(
      (max, entry) => Math.max(max, String(entry.cells[i] ?? "").length),
      col.label.length,
    );
    return Math.max(col.label.length + 1, contentMax);
  });
  const wantedTotal = wanted.reduce((a, b) => a + b, 0);
  if (wantedTotal <= usable) return wanted;
  return wanted.map((w) => Math.max(2, Math.floor((w * usable) / wantedTotal)));
}

function formatHeader<R>(columns: readonly TableColumn<R>[], widths: readonly number[]): string {
  const parts = columns.map((col, i) => pad(col.label, widths[i]!));
  return ` ${parts.join(" ")}`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padEnd(width);
}

function formatRow<R>(entry: TableRow<R>, active: boolean, widths: readonly number[]): string {
  const marker = active ? ">" : " ";
  const parts = entry.cells.map((cell, i) => pad(String(cell), widths[i]!));
  return `${marker}${parts.join(" ")}`;
}

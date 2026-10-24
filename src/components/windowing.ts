export interface VisibleWindow {
  start: number;
  end: number;
}

export function repoKeyOf(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`;
}

// Rows consumed outside the repo rows themselves: header bar (3), footer bar (3),
// the list box borders (2), and the counts line inside the list box (1).
// The update toast (bordered, height 3) takes 3 more rows while visible.
export const REPO_LIST_RESERVED_ROWS = 9;
/** Height of the dashboard header bar; mouse clicks map list rows below it. */
export const HEADER_ROWS = 3;
export const FOOTER_ROWS = 3;
export const TOAST_RESERVED_ROWS = 3;

export function repoViewportRows(terminalHeight: number, toastVisible: boolean): number {
  const reserved = REPO_LIST_RESERVED_ROWS + (toastVisible ? TOAST_RESERVED_ROWS : 0);
  return Math.max(1, terminalHeight - reserved);
}

export function visibleSlice(cursor: number, total: number, viewportRows: number): VisibleWindow {
  if (total <= 0 || viewportRows <= 0) return { start: 0, end: 0 };
  const clampedCursor = Math.min(Math.max(cursor, 0), total - 1);
  const view = Math.min(viewportRows, total);
  const maxStart = total - view;
  const start = Math.min(Math.max(clampedCursor - (view - 1), 0), maxStart);
  return { start, end: start + view };
}

// Side panels together must leave at least 20 columns for the repository list.
export const MIN_CENTER_COLUMNS = 20;
const PANEL_FLOOR = 8;

function panelBudget(terminalWidth: number): number {
  return Math.max(MIN_CENTER_COLUMNS, terminalWidth - MIN_CENTER_COLUMNS);
}

function rawSidebarWidth(terminalWidth: number): number {
  return Math.min(44, Math.max(24, Math.floor(terminalWidth * 0.22)));
}

function rawStatusWidth(terminalWidth: number): number {
  return Math.min(60, Math.max(32, Math.floor(terminalWidth * 0.3)));
}

export function sidebarWidth(terminalWidth: number): number {
  const budget = panelBudget(terminalWidth);
  const raw = rawSidebarWidth(terminalWidth);
  const total = raw + rawStatusWidth(terminalWidth);
  if (total <= budget) return raw;
  return Math.max(PANEL_FLOOR, Math.min(raw, Math.floor((raw * budget) / total)));
}

export function statusWidth(terminalWidth: number): number {
  const budget = panelBudget(terminalWidth);
  const raw = rawStatusWidth(terminalWidth);
  return Math.max(PANEL_FLOOR, Math.min(raw, budget - sidebarWidth(terminalWidth)));
}

export interface PreviewTreeEntry {
  key: string;
  relPath: string;
  exists: boolean;
  custom?: boolean;
}

export const PREVIEW_TREE_CAP = 40;

interface PreviewNode {
  children: Map<string, PreviewNode>;
  marker: string | null;
}

function previewMarker(entry: PreviewTreeEntry): string {
  if (entry.custom === true) return "custom";
  return entry.exists ? "update" : "clone";
}

function compareSegments(a: string, b: string): number {
  const caseInsensitive = a.toLowerCase().localeCompare(b.toLowerCase());
  if (caseInsensitive !== 0) return caseInsensitive;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildPreviewTree(entries: readonly PreviewTreeEntry[]): string[] {
  const root: PreviewNode = { children: new Map(), marker: null };
  for (const entry of entries) {
    const segments = entry.relPath.split("/").filter((segment) => segment.length > 0);
    let node = root;
    for (const segment of segments) {
      let child = node.children.get(segment);
      if (child === undefined) {
        child = { children: new Map(), marker: null };
        node.children.set(segment, child);
      }
      node = child;
    }
    node.marker = previewMarker(entry);
  }
  const lines: string[] = [];
  const walk = (node: PreviewNode, prefix: string): void => {
    const names = [...node.children.keys()].sort(compareSegments);
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i]!;
      const child = node.children.get(name)!;
      const isLast = i === names.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const label = child.marker !== null ? `${name} [${child.marker}]` : name;
      lines.push(`${prefix}${connector}${label}`);
      walk(child, prefix + (isLast ? "    " : "│   "));
    }
  };
  walk(root, "");
  if (lines.length > PREVIEW_TREE_CAP) {
    const hidden = lines.length - PREVIEW_TREE_CAP;
    return [...lines.slice(0, PREVIEW_TREE_CAP), `... and ${hidden} more`];
  }
  return lines;
}

export function repoRowLabel(repo: {
  name: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  language: string | null;
}): string {
  let label = repo.name;
  if (repo.isPrivate) label += " [Private]";
  if (repo.isFork) label += " [Fork]";
  if (repo.isArchived) label += " [Archived]";
  if (repo.language !== null && repo.language.length > 0) {
    label += ` [${repo.language}]`;
  }
  return label;
}

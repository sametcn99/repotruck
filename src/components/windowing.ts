export interface VisibleWindow {
  start: number;
  end: number;
}

export function repoKeyOf(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`;
}

/** The top bar and workspace summary share a bordered header. */
export const HEADER_ROWS = 4;
export const FOOTER_ROWS = 3;
export const TOAST_RESERVED_ROWS = 3;
export const TOAST_BAND_MIN_HEIGHT = 22;

// List borders (2) and its counts line (1).
export const REPO_LIST_RESERVED_ROWS = HEADER_ROWS + FOOTER_ROWS + 3;

export function repoViewportRows(terminalHeight: number, toastVisible: boolean): number {
  const reserved =
    REPO_LIST_RESERVED_ROWS +
    (toastVisible && terminalHeight >= TOAST_BAND_MIN_HEIGHT ? TOAST_RESERVED_ROWS : 0);
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

/**
 * Top-offset windowing for scrollable boxes without a cursor highlight row.
 * Scrolls immediately from offset 0 and clamps so the viewport stays full at the end.
 */
export function scrollSlice(
  scrollOffset: number,
  total: number,
  viewportRows: number,
): VisibleWindow {
  if (total <= 0 || viewportRows <= 0) return { start: 0, end: 0 };
  const view = Math.min(viewportRows, total);
  const maxStart = Math.max(0, total - view);
  const start = Math.min(Math.max(0, scrollOffset), maxStart);
  return { start, end: start + view };
}

/**
 * Clamps a single line of text so it fits cleanly inside a bordered box of
 * interior width `maxCols` without touching or overflowing the right border.
 */
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function cellWidth(text: string): number {
  if (/^[\p{Mark}\p{Control}\p{Format}]*$/u.test(text)) return 0;
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text)) return 2;
  const code = text.codePointAt(0) ?? 0;
  return code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3ffff))
    ? 2
    : 1;
}
export function terminalWidth(text: string): number {
  return [...graphemes.segment(text)].reduce((width, item) => width + cellWidth(item.segment), 0);
}
export function clampBoxLine(raw: string, maxCols: number): string {
  const clean = raw.replace(/[\r\n\t]+/g, " ");
  if (maxCols <= 0) return "";
  if (terminalWidth(clean) <= maxCols) return clean;
  const budget = maxCols <= 1 ? maxCols : maxCols - 1;
  let result = "",
    width = 0;
  for (const { segment } of graphemes.segment(clean)) {
    const next = cellWidth(segment);
    if (width + next > budget) break;
    result += segment;
    width += next;
  }
  return result + (maxCols > 1 ? "…" : "");
}

// Side panels together must leave at least 20 columns for the repository list.
export const MIN_CENTER_COLUMNS = 20;
const PANEL_FLOOR = 8;

/**
 * Adaptive cockpit layout breakpoints based on available content width:
 * - "three-pane" (>= 90 cols): Sidebar + RepoList + StatusPanel side-by-side
 * - "two-pane" (64..89 cols): RepoList + active side pane (Sidebar when focused, else StatusPanel)
 * - "single-pane" (< 64 cols): Only the focused pane (Sidebar, RepoList, or StatusPanel) at full width
 */
export type CockpitLayoutMode = "three-pane" | "two-pane" | "single-pane";

export const TWO_PANE_MIN_WIDTH = 64;
export const THREE_PANE_MIN_WIDTH = 90;

export function cockpitLayoutMode(pageWidth: number): CockpitLayoutMode {
  if (pageWidth >= THREE_PANE_MIN_WIDTH) return "three-pane";
  if (pageWidth >= TWO_PANE_MIN_WIDTH) return "two-pane";
  return "single-pane";
}

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

export interface CockpitPaneMetrics {
  mode: CockpitLayoutMode;
  showSidebar: boolean;
  showList: boolean;
  showStatus: boolean;
  sidebarCols: number;
  listCols: number;
  statusCols: number;
  listOffsetX: number;
}

export function computeCockpitPanes(
  pageWidth: number,
  focus: "sidebar" | "list" | "status",
  hasContextMenu = false,
): CockpitPaneMetrics {
  const mode = cockpitLayoutMode(pageWidth);
  const safeWidth = Math.max(20, pageWidth);
  if (mode === "three-pane") {
    const sb = sidebarWidth(safeWidth);
    const st = hasContextMenu ? Math.min(34, statusWidth(safeWidth)) : statusWidth(safeWidth);
    const list = Math.max(MIN_CENTER_COLUMNS, safeWidth - sb - st);
    return {
      mode,
      showSidebar: true,
      showList: true,
      showStatus: true,
      sidebarCols: sb,
      listCols: list,
      statusCols: st,
      listOffsetX: sb,
    };
  }
  if (mode === "two-pane") {
    if (focus === "sidebar" && !hasContextMenu) {
      const sb = Math.min(30, Math.max(20, Math.floor(safeWidth * 0.36)));
      const list = Math.max(MIN_CENTER_COLUMNS, safeWidth - sb);
      return {
        mode,
        showSidebar: true,
        showList: true,
        showStatus: false,
        sidebarCols: sb,
        listCols: list,
        statusCols: 0,
        listOffsetX: sb,
      };
    }
    const st = hasContextMenu
      ? Math.min(34, Math.max(22, Math.floor(safeWidth * 0.44)))
      : Math.min(36, Math.max(24, Math.floor(safeWidth * 0.42)));
    const list = Math.max(MIN_CENTER_COLUMNS, safeWidth - st);
    return {
      mode,
      showSidebar: false,
      showList: true,
      showStatus: true,
      sidebarCols: 0,
      listCols: list,
      statusCols: st,
      listOffsetX: 0,
    };
  }
  // single-pane mode
  if (hasContextMenu || focus === "status") {
    return {
      mode,
      showSidebar: false,
      showList: false,
      showStatus: true,
      sidebarCols: 0,
      listCols: 0,
      statusCols: safeWidth,
      listOffsetX: 0,
    };
  }
  if (focus === "sidebar") {
    return {
      mode,
      showSidebar: true,
      showList: false,
      showStatus: false,
      sidebarCols: safeWidth,
      listCols: 0,
      statusCols: 0,
      listOffsetX: 0,
    };
  }
  return {
    mode,
    showSidebar: false,
    showList: true,
    showStatus: false,
    sidebarCols: 0,
    listCols: safeWidth,
    statusCols: 0,
    listOffsetX: 0,
  };
}

export interface PreviewTreeEntry {
  key: string;
  relPath: string;
  exists: boolean;
  custom?: boolean;
}

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
      const connector = isLast ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ";
      const label = child.marker !== null ? `${name} [${child.marker}]` : name;
      lines.push(`${prefix}${connector}${label}`);
      walk(child, prefix + (isLast ? "    " : "\u2502   "));
    }
  };
  walk(root, "");
  return lines;
}

export interface RepoRowBadges {
  relativePath?: string | null;
  alias?: string | null;
  pinned?: boolean;
  missing?: boolean;
  dirty?: boolean;
  ahead?: number;
  behind?: number;
  worktree?: boolean;
}

export function repoRowLabel(
  repo: {
    name: string;
    isPrivate: boolean;
    isFork: boolean;
    isArchived: boolean;
    language: string | null;
  },
  badges?: RepoRowBadges,
): string {
  let label = badges?.relativePath ?? repo.name;
  if (badges?.pinned) label += " [\u2605]";
  if (badges?.alias) label += ` [@${badges.alias}]`;
  if (badges?.missing) {
    label += " [MISSING]";
  } else {
    if (badges?.dirty) label += " [\u25cf dirty]";
    if ((badges?.ahead ?? 0) > 0 || (badges?.behind ?? 0) > 0) {
      const ab: string[] = [];
      if ((badges?.ahead ?? 0) > 0) ab.push(`\u2191${badges!.ahead}`);
      if ((badges?.behind ?? 0) > 0) ab.push(`\u2193${badges!.behind}`);
      label += ` [${ab.join(" ")}]`;
    }
    if (badges?.worktree) label += " [WT]";
  }
  if (repo.isPrivate) label += " [Private]";
  if (repo.isFork) label += " [Fork]";
  if (repo.isArchived) label += " [Archived]";
  if (repo.language !== null && repo.language.length > 0) {
    label += ` [${repo.language}]`;
  }
  return label;
}

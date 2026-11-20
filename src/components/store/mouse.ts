import {
  computeCockpitPanes,
  FOOTER_ROWS,
  HEADER_ROWS,
  repoViewportRows,
  TOAST_BAND_MIN_HEIGHT,
  TOAST_RESERVED_ROWS,
  visibleSlice,
} from "../windowing.ts";
import { repoKey, sidebarRowIndexForY } from "./filters.ts";
import type {
  FocusRegion,
  MouseCallbacks,
  MouseEventPayload,
  OmnibarMode,
  RightPaneTab,
  StoreSnapshot,
} from "./types.ts";

export interface MouseRouterHost {
  getSnapshot(): StoreSnapshot;
  setFocus(focus: FocusRegion): void;
  cycleReorganizeTarget(delta: number): Promise<void>;
  moveSidebarCursor(delta: number): void;
  moveStatusScroll(delta: number): void;
  moveCursor(delta: number): void;
  closeModal(): void;
  setCursor(index: number): void;
  openDetailModal(key: string): void;
  openRepoContextMenu(key: string): void;
  dismissUpdateToast(): void;
  dismissToast(): void;
  cycleFocus(): void;
  toggleCurrent(): void;
  openHelpModal(): void;
  openOmnibar(mode?: OmnibarMode, initialQuery?: string): void;
  openSearchModal(): void;
  cycleHealthFilter(): void;
  cyclePreset(): Promise<void>;
  openRootModal(): Promise<void>;
  setSidebarCursor(index: number): void;
  activateSidebarRow(): void;
  setRightPaneTab(tab: RightPaneTab): void;
  handleRepoRowClick(index: number, key: string, relX?: number): void;
}

export function routeMouseEvent(
  host: MouseRouterHost,
  event: MouseEventPayload,
  width: number,
  height: number,
  callbacks?: MouseCallbacks,
): void {
  const state = host.getSnapshot();
  const panes = computeCockpitPanes(width, state.focus, state.contextMenu !== null);
  const switcherRows = panes.mode !== "three-pane" ? 1 : 0;
  const isWheel =
    event.button === 4 ||
    event.button === 5 ||
    event.type === "scroll" ||
    event.scroll !== undefined;

  if (isWheel) {
    const isScrollUp =
      event.button === 4 ||
      event.scroll?.direction === "up" ||
      (event.type === "scroll" && event.button === 0 && !event.scroll);

    if (state.modal !== null) {
      if (state.modal.type === "reorganize") {
        void host.cycleReorganizeTarget(isScrollUp ? -1 : 1);
      }
      return;
    }

    if (panes.showSidebar && (!panes.showList || event.x <= panes.sidebarCols)) {
      host.setFocus("sidebar");
      host.moveSidebarCursor(isScrollUp ? -1 : 1);
      return;
    }

    if (panes.showStatus && (!panes.showList || event.x > width - panes.statusCols)) {
      host.setFocus("status");
      host.moveStatusScroll(isScrollUp ? 3 : -3);
      return;
    }

    host.setFocus("list");
    host.moveCursor(isScrollUp ? -3 : 3);
    return;
  }

  if (event.button === 2) {
    if (state.modal !== null) {
      host.closeModal();
      return;
    }
    const inListArea =
      panes.showList &&
      (!panes.showSidebar || event.x > panes.sidebarCols) &&
      (!panes.showStatus || event.x <= width - panes.statusCols);
    if (inListArea) {
      host.setFocus("list");
      const view = Math.max(
        1,
        repoViewportRows(height, state.updateToast !== null || state.toast !== null) - switcherRows,
      );
      const total = state.filteredRepos.length;
      if (total === 0) return;
      const slice = visibleSlice(state.cursor, total, view);
      const local = event.y - 1 - HEADER_ROWS - switcherRows;
      if (local >= 0 && local < slice.end - slice.start) {
        const clickedIndex = slice.start + local;
        const repo = state.filteredRepos[clickedIndex];
        if (repo !== undefined) {
          host.setCursor(clickedIndex);
          host.openRepoContextMenu(repoKey(repo));
        }
      }
    }
    return;
  }

  if (event.button !== 0) return;

  if (state.modal !== null) {
    if (event.y < HEADER_ROWS || event.y >= height - FOOTER_ROWS) {
      host.closeModal();
    }
    return;
  }

  if (height >= TOAST_BAND_MIN_HEIGHT && (state.updateToast !== null || state.toast !== null)) {
    const toastTop = height - FOOTER_ROWS - TOAST_RESERVED_ROWS;
    if (event.y >= toastTop && event.y < toastTop + TOAST_RESERVED_ROWS) {
      host.dismissToast();
      host.dismissUpdateToast();
      return;
    }
  }

  if (event.y >= height - FOOTER_ROWS) {
    if (state.running) {
      callbacks?.onQuit?.();
      return;
    }
    if (event.x <= 15) {
      host.cycleFocus();
    } else if (event.x <= 32) {
      host.toggleCurrent();
    } else if (event.x <= 45) {
      host.openHelpModal();
    } else if (event.x <= 60) {
      callbacks?.onQuit?.();
    } else if (event.x <= 75) {
      host.openOmnibar("commands");
    } else if (event.x <= 88) {
      host.openSearchModal();
    } else {
      host.cycleHealthFilter();
    }
    return;
  }

  if (event.y < HEADER_ROWS) {
    if (event.x >= 35 && event.x <= 65) {
      void host.cyclePreset();
    } else if (event.x > 65 && event.x <= 95) {
      void host.openRootModal();
    }
    return;
  }

  if (switcherRows > 0 && event.y === HEADER_ROWS) {
    const third = Math.max(8, Math.floor(width / 4));
    if (event.x < third) {
      host.setFocus("sidebar");
    } else if (event.x < third * 2) {
      host.setFocus("list");
    } else if (event.x < third * 3) {
      host.setFocus("status");
    } else {
      host.openOmnibar("commands");
    }
    return;
  }

  if (panes.showSidebar && (!panes.showList || event.x <= panes.sidebarCols)) {
    host.setFocus("sidebar");
    const localY = event.y - 1 - HEADER_ROWS - switcherRows;
    const availRows = Math.max(
      1,
      repoViewportRows(height, state.updateToast !== null || state.toast !== null) - switcherRows,
    );
    const rowIndex = sidebarRowIndexForY(localY, state.orgs.length, state.sidebarCursor, availRows);
    if (rowIndex !== null) {
      const prevCursor = state.sidebarCursor;
      host.setSidebarCursor(rowIndex);
      if (event.x <= 6 || prevCursor === rowIndex) {
        host.activateSidebarRow();
      }
    }
    return;
  }

  if (panes.showStatus && (!panes.showList || event.x > width - panes.statusCols)) {
    host.setFocus("status");
    return;
  }

  if (!panes.showList) return;

  host.setFocus("list");
  const view = Math.max(
    1,
    repoViewportRows(height, state.updateToast !== null || state.toast !== null) - switcherRows,
  );
  const total = state.filteredRepos.length;
  if (total === 0) return;
  const slice = visibleSlice(state.cursor, total, view);
  const local = event.y - 1 - HEADER_ROWS - switcherRows;
  if (local < 0 || local >= slice.end - slice.start) return;
  const clickedIndex = slice.start + local;
  const repo = state.filteredRepos[clickedIndex];
  if (repo === undefined) return;

  const relX = event.x - panes.listOffsetX;
  host.handleRepoRowClick(clickedIndex, repoKey(repo), relX);
}

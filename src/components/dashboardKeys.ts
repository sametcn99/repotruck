import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Store } from "./store.ts";
import { VIEW_GO_KEYS, VIEW_ORDER } from "./views/viewRegistry.ts";
import { repoKeyOf, repoViewportRows } from "./windowing.ts";

// A second q inside this window while a sync runs actually quits.
const QUIT_CONFIRM_WINDOW_MS = 3000;
// `v` followed by a view letter opens that page; the pairing expires so a
// stray `v` never swallows the next keypress indefinitely.
const VIEW_PREFIX_WINDOW_MS = 1500;

function isKey(key: { name: string; sequence: string }, match: string): boolean {
  return key.name === match || key.sequence === match;
}

function isPlainLetter(
  key: { name: string; sequence?: string; shift?: boolean; ctrl?: boolean },
  letter: string,
): boolean {
  const seq = key.sequence ?? key.name ?? "";
  return seq === letter && key.shift !== true && key.ctrl !== true;
}

function isShiftLetter(
  key: { name: string; sequence: string; shift?: boolean },
  upper: string,
): boolean {
  return key.sequence === upper || (key.shift === true && key.name === upper.toLowerCase());
}

/**
 * Dashboard keyboard handling split out of Dashboard.tsx for the file-size
 * budget: quit arming, `v`-prefix view dispatch and the cockpit keymap.
 * Returns the armed-quit flag and the quit callback the shell reuses for
 * mouse routing and the footer summary.
 */
export function useDashboardKeys(
  store: Store,
  onQuit: () => void,
  height: number,
  width: number,
  navRailVisible: (w: number) => boolean,
): { quitArmed: boolean; handleQuit: () => void } {
  const [quitArmedAt, setQuitArmedAt] = useState(0);
  // `v`-prefix arming lives in a ref: key handling must not depend on a
  // pending React re-render between the two keypresses.
  const viewPrefixRef = useRef(0);

  useEffect(() => {
    if (!store.getSnapshot().running) setQuitArmedAt(0);
  }, [store]);

  const handleQuit = useCallback(() => {
    const current = store.getSnapshot();
    if (current.running) {
      const now = Date.now();
      if (quitArmedAt !== 0 && now - quitArmedAt <= QUIT_CONFIRM_WINDOW_MS) {
        setQuitArmedAt(0);
        onQuit();
      } else {
        setQuitArmedAt(now);
      }
      return;
    }
    onQuit();
  }, [store, quitArmedAt, onQuit]);

  const quitArmed = store.getSnapshot().running && quitArmedAt !== 0;

  useKeyboard((key) => {
    const current = store.getSnapshot();
    const railVisibleNow = navRailVisible(width);
    if (current.dialog !== null || current.contextMenu !== null) {
      // DialogBox / ContextMenu own their keys while open.
      return;
    }
    if (current.modal !== null) {
      if (key.name === "escape") {
        if (current.modal.type === "search") {
          store.clearSearch();
        }
        if (current.modal.type === "deviceFlow") {
          store.cancelDeviceFlow();
          return;
        }
        store.closeModal();
      }
      return;
    }
    if (current.phase === "error") {
      if (key.name === "q") handleQuit();
      else if (key.name === "o") void store.enterOfflineMode();
      else if (key.name === "r") void store.init();
      return;
    }
    if ((key as { ctrl?: boolean }).ctrl === true && key.name === "k") {
      store.openOmnibar("commands");
      return;
    }
    if (key.sequence === ":") {
      store.openOmnibar("commands");
      return;
    }
    if (key.sequence === "@") {
      store.openOmnibar("symbols");
      return;
    }
    if (key.sequence === "#") {
      store.openOmnibar("github");
      return;
    }
    if (key.sequence === "!") {
      store.openOmnibar("runner");
      return;
    }
    // ---- nav rail (views panel) keyboard focus & navigation ---------------
    if (
      key.name === "tab" &&
      railVisibleNow &&
      (current.navFocused || current.view !== "cockpit")
    ) {
      store.cycleFocus(true);
      return;
    }
    if (current.navFocused) {
      if (key.name === "escape" || key.name === "right") {
        store.setNavFocused(false);
        return;
      }
      if (key.name === "up" || key.sequence === "k") {
        store.moveNavCursor(-1);
        return;
      }
      if (key.name === "down" || key.sequence === "j") {
        store.moveNavCursor(1);
        return;
      }
      if (key.name === "home" || key.sequence === "g") {
        store.setNavCursor(0);
        return;
      }
      if (key.name === "end" || isShiftLetter(key, "G")) {
        store.setNavCursor(VIEW_ORDER.length - 1);
        return;
      }
      if (key.name === "pageup") {
        store.moveNavCursor(-5);
        return;
      }
      if (key.name === "pagedown") {
        store.moveNavCursor(5);
        return;
      }
      if (key.name === "return" || key.name === "space") {
        store.activateNavRow();
        return;
      }
      if (key.name === "q" && current.view === "cockpit") {
        handleQuit();
        return;
      }
      if (key.sequence === "[") {
        store.cycleView(-1);
        return;
      }
      if (key.sequence === "]") {
        store.cycleView(1);
        return;
      }
      return;
    }
    // ---- view layer: Escape back, [ ] cycling, v-prefix go-to -------------
    if (key.name === "escape" && current.view !== "cockpit") {
      store.setView("cockpit");
      viewPrefixRef.current = 0;
      return;
    }
    if (key.sequence === "[") {
      store.cycleView(-1);
      return;
    }
    if (key.sequence === "]") {
      store.cycleView(1);
      return;
    }
    if (isPlainLetter(key, "v")) {
      const now = Date.now();
      const armedAt = viewPrefixRef.current;
      viewPrefixRef.current = armedAt !== 0 && now - armedAt <= VIEW_PREFIX_WINDOW_MS ? 0 : now;
      return;
    }
    if (
      viewPrefixRef.current !== 0 &&
      Date.now() - viewPrefixRef.current <= VIEW_PREFIX_WINDOW_MS
    ) {
      viewPrefixRef.current = 0;
      const target = VIEW_GO_KEYS.get(key.sequence ?? key.name ?? "");
      if (target !== undefined) {
        store.setView(target);
        return;
      }
      // not a view letter: disarm and fall through to the normal handler
    }
    // Pages own their keyboard surface (like modals do); only the shell
    // keys above and the global ones handled earlier still apply.
    if (current.view !== "cockpit") {
      return;
    }
    if (isShiftLetter(key, "D") && current.focus === "list") {
      void store.openSelectionDeleteConfirm();
      return;
    }
    if (isShiftLetter(key, "A") && current.focus === "list") {
      store.openSelectionArchiveConfirm();
      return;
    }
    if (isShiftLetter(key, "P")) {
      void store.togglePinSelection();
      return;
    }
    if (isShiftLetter(key, "R")) {
      void store.openReorganizeModal();
      return;
    }
    if (isShiftLetter(key, "W") && current.focus === "list") {
      const repo = current.filteredRepos[current.cursor];
      if (repo !== undefined) {
        void store.openWorktreeModal(`${repo.owner}/${repo.name}`);
      }
      return;
    }
    if (isShiftLetter(key, "S")) {
      store.toggleSortDirection();
      return;
    }
    if (isShiftLetter(key, "F") && current.rightPaneTab === "health") {
      void store.runHealthDoctorFix();
      return;
    }
    if (isShiftLetter(key, "G") && current.focus === "list") {
      store.setCursor(current.filteredRepos.length - 1);
      return;
    }
    if (key.sequence === "1") {
      store.setRightPaneTab("activity");
      return;
    }
    if (key.sequence === "2") {
      store.setRightPaneTab("inspector");
      return;
    }
    if (key.sequence === "3") {
      store.setRightPaneTab("health");
      return;
    }
    if (key.name === "z") {
      void store.undoLast();
      return;
    }
    switch (key.name) {
      case "q": {
        handleQuit();
        return;
      }
      case "tab":
        store.cycleFocus(railVisibleNow);
        return;
      case "c":
        store.openCloneModal();
        return;
      case "n":
        store.openCreateModal();
        return;
      case "w":
        void store.openWorkspacePicker();
        return;
      case "d":
        void store.openRootModal();
        return;
      case "p":
        void store.cyclePreset();
        return;
      case "f":
        store.cycleHealthFilter();
        return;
      case "t":
        void store.cycleTheme();
        return;
      case "s":
        store.cycleSort();
        return;
      case "u":
        if (current.focus === "list") {
          store.openSelectionUntrackConfirm();
        }
        return;
      case "i":
        if (current.focus === "list") {
          const repo = current.filteredRepos[current.cursor];
          if (repo !== undefined) {
            store.openDetailModal(`${repo.owner}/${repo.name}`);
          }
        }
        return;
      case "x":
        store.dismissUpdateToast();
        store.dismissToast();
        return;
      case "o": {
        if (current.focus === "list") {
          const openRepo = current.filteredRepos[current.cursor];
          if (openRepo !== undefined) {
            void store.openOpenModal(`${openRepo.owner}/${openRepo.name}`);
          }
        }
        return;
      }
      case "r": {
        if (current.focus === "list") {
          const aliasRepo = current.filteredRepos[current.cursor];
          if (aliasRepo !== undefined) {
            void store.openAliasModal(`${aliasRepo.owner}/${aliasRepo.name}`);
          }
        }
        return;
      }
      default:
        break;
    }
    if (isKey(key, "/")) {
      store.openSearchModal();
      return;
    }
    if (isKey(key, "?")) {
      store.openHelpModal();
      return;
    }
    if (key.name === "escape") {
      store.clearSearch();
      return;
    }
    if (current.focus === "sidebar") {
      if (key.name === "up" || key.sequence === "k") {
        store.moveSidebarCursor(-1);
      } else if (key.name === "down" || key.sequence === "j") {
        store.moveSidebarCursor(1);
      } else if (key.name === "space" || key.name === "return") {
        store.activateSidebarRow();
      } else if (key.name === "left" && railVisibleNow) {
        store.setNavFocused(true);
      }
      return;
    }
    if (current.focus === "list") {
      if (key.name === "up" || key.sequence === "k") {
        store.moveCursor(-1);
      } else if (key.name === "down" || key.sequence === "j") {
        store.moveCursor(1);
      } else if (key.name === "home" || key.sequence === "g") {
        store.setCursor(0);
      } else if (key.name === "end") {
        store.setCursor(current.filteredRepos.length - 1);
      } else if (key.name === "pageup") {
        store.pageCursor(
          -1,
          repoViewportRows(height, current.updateToast !== null || current.toast !== null),
        );
      } else if (key.name === "pagedown") {
        store.pageCursor(
          1,
          repoViewportRows(height, current.updateToast !== null || current.toast !== null),
        );
      } else if (key.name === "space") {
        store.toggleCurrent();
      } else if (key.name === "a") {
        store.selectAll();
      } else if (key.name === "return") {
        void store.openStartPreview();
      } else if (key.name === "m") {
        const repo = current.filteredRepos[current.cursor];
        if (repo !== undefined) {
          void store.openMoveModal(repoKeyOf(repo));
        }
      } else if (key.name === "right") {
        const repo = current.filteredRepos[current.cursor];
        if (repo !== undefined) {
          store.openRepoContextMenu(repoKeyOf(repo));
        }
      }
      return;
    }
    if (current.focus === "status") {
      if (key.name === "up" || key.sequence === "k") {
        store.moveStatusScroll(1);
      } else if (key.name === "down" || key.sequence === "j") {
        store.moveStatusScroll(-1);
      }
    }
  });

  return { quitArmed, handleQuit };
}

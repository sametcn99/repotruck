import { InputRenderable, type KeyEvent } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Store } from "./store.ts";
import { moveViewMenuGroup, moveViewMenuRow } from "./ViewMenu.tsx";
import { VIEW_GO_KEYS } from "./views/viewRegistry.ts";
import { computeCockpitPanes, repoKeyOf, repoViewportRows } from "./windowing.ts";

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
): { quitArmed: boolean; handleQuit: () => void } {
  const renderer = useRenderer();
  const [quitArmedAt, setQuitArmedAt] = useState(0);
  // `v`-prefix arming lives in a ref: key handling must not depend on a
  // pending React re-render between the two keypresses.
  const viewPrefixRef = useRef(0);

  const running = store.getSnapshot().running;
  useEffect(() => {
    if (!running && quitArmedAt !== 0) setQuitArmedAt(0);
  }, [running, quitArmedAt]);

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

  // Shell shortcuts run before page handlers even when a page is already
  // mounted. Consumed navigation keys must never fall through to that page.
  const handleKey = useEffectEvent((key: KeyEvent) => {
    const current = store.getSnapshot();
    if (current.dialog !== null || current.contextMenu !== null) return;
    const editing = renderer.currentFocusedRenderable instanceof InputRenderable;
    if (current.modal !== null) {
      if (key.name === "escape" && !(current.modal.type === "commandForm" && editing)) {
        key.stopPropagation();
        if (current.modal.type === "deviceFlow") {
          store.cancelDeviceFlow();
        } else {
          if (current.modal.type === "search") store.clearSearch();
          store.closeModal();
        }
      }
      return;
    }
    if (current.phase === "error") {
      if (key.name === "q") handleQuit();
      else if (key.name === "o") void store.enterOfflineMode();
      else if (key.name === "r") void store.init();
      return;
    }
    if (current.phase !== "ready") {
      if (key.name === "q") handleQuit();
      return;
    }

    if (key.name === "f1" || (!editing && isKey(key, "?"))) {
      key.stopPropagation();
      viewPrefixRef.current = 0;
      store.setNavFocused(false);
      store.openHelpModal();
      return;
    }
    if (key.ctrl && key.name === "k") {
      key.stopPropagation();
      viewPrefixRef.current = 0;
      store.setNavFocused(false);
      store.openOmnibar("commands");
      return;
    }
    if (key.name === "f10") {
      key.stopPropagation();
      viewPrefixRef.current = 0;
      store.setNavFocused(!current.navFocused);
      return;
    }
    if (current.navFocused) {
      key.stopPropagation();
      if (key.name === "escape" || key.name === "tab") store.setNavFocused(false);
      else if (key.name === "left" || key.sequence === "h") moveViewMenuGroup(store, -1);
      else if (key.name === "right" || key.sequence === "l") moveViewMenuGroup(store, 1);
      else if (key.name === "up" || key.sequence === "k") moveViewMenuRow(store, -1);
      else if (key.name === "down" || key.sequence === "j") moveViewMenuRow(store, 1);
      else if (key.name === "home") moveViewMenuRow(store, "first");
      else if (key.name === "end") moveViewMenuRow(store, "last");
      else if (key.name === "return" || key.name === "space") store.activateNavRow();
      return;
    }
    if (key.name === "tab" && current.view === "cockpit") {
      key.stopPropagation();
      viewPrefixRef.current = 0;
      store.cycleFocus(key.shift ? -1 : 1);
      return;
    }
    if (editing) return;

    if (key.name === "escape" && current.view !== "cockpit") {
      key.stopPropagation();
      viewPrefixRef.current = 0;
      store.setView("cockpit");
      return;
    }
    if (key.sequence === "[" || key.sequence === "]") {
      key.stopPropagation();
      viewPrefixRef.current = 0;
      store.cycleView(key.sequence === "[" ? -1 : 1);
      return;
    }
    if (isPlainLetter(key, "v")) {
      key.stopPropagation();
      const now = Date.now();
      const armedAt = viewPrefixRef.current;
      viewPrefixRef.current = armedAt !== 0 && now - armedAt <= VIEW_PREFIX_WINDOW_MS ? 0 : now;
      return;
    }
    const armedAt = viewPrefixRef.current;
    viewPrefixRef.current = 0;
    if (armedAt !== 0 && Date.now() - armedAt <= VIEW_PREFIX_WINDOW_MS) {
      const target = VIEW_GO_KEYS.get(key.sequence ?? key.name);
      if (target !== undefined) {
        key.stopPropagation();
        store.setView(target);
        return;
      }
    }
    switch (key.sequence) {
      case ":":
      case "@":
      case "#":
      case "!": {
        key.stopPropagation();
        const mode =
          key.sequence === "@"
            ? "symbols"
            : key.sequence === "#"
              ? "github"
              : key.sequence === "!"
                ? "runner"
                : "commands";
        store.openOmnibar(mode);
        return;
      }
    }
    if (isPlainLetter(key, "q")) {
      key.stopPropagation();
      handleQuit();
      return;
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
      if (!computeCockpitPanes(width, current.focus, false).showStatus) {
        store.setFocus("status");
      }
      store.setRightPaneTab("activity");
      return;
    }
    if (key.sequence === "2") {
      if (!computeCockpitPanes(width, current.focus, false).showStatus) {
        store.setFocus("status");
      }
      store.setRightPaneTab("inspector");
      return;
    }
    if (key.sequence === "3") {
      if (!computeCockpitPanes(width, current.focus, false).showStatus) {
        store.setFocus("status");
      }
      store.setRightPaneTab("health");
      return;
    }
    if (key.name === "z") {
      void store.undoLast();
      return;
    }
    switch (key.name) {
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
  });

  useEffect(() => {
    const input = renderer.keyInput;
    input.prependListener("keypress", handleKey);
    return () => {
      input.off("keypress", handleKey);
    };
  }, [renderer]);

  return { quitArmed, handleQuit };
}

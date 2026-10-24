import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AliasModal } from "./AliasModal.tsx";
import { CloneModal } from "./CloneModal.tsx";
import { ConfirmModal } from "./ConfirmModal.tsx";
import { CreateModal } from "./CreateModal.tsx";
import { DetailModal } from "./DetailModal.tsx";
import { HelpModal } from "./HelpModal.tsx";
import { MoveModal } from "./MoveModal.tsx";
import { OpenModal } from "./OpenModal.tsx";
import { ReorganizeModal } from "./ReorganizeModal.tsx";
import { RepoList } from "./RepoList.tsx";
import { RootModal } from "./RootModal.tsx";
import { SearchModal } from "./SearchModal.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { StartPreviewModal } from "./StartPreviewModal.tsx";
import { StatusPanel } from "./StatusPanel.tsx";
import type { ModalState, StatusPhase, Store } from "./store.ts";
import { theme } from "./theme.ts";
import { WorkspacePicker } from "./WorkspacePicker.tsx";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton.tsx";
import { repoKeyOf, repoViewportRows, sidebarWidth, statusWidth } from "./windowing.ts";

const DIM_FG = theme.dim();

// A second q inside this window while a sync runs actually quits.
const QUIT_CONFIRM_WINDOW_MS = 3000;

function isKey(key: { name: string; sequence: string }, match: string): boolean {
  return key.name === match || key.sequence === match;
}

function isDeleteKey(key: { name: string; sequence: string; shift?: boolean }): boolean {
  return key.sequence === "D" || (key.shift === true && key.name === "d");
}

function isReorganizeKey(key: { name: string; sequence: string; shift?: boolean }): boolean {
  return key.sequence === "R" || (key.shift === true && key.name === "r");
}

function isSortDirectionKey(key: { name: string; sequence: string; shift?: boolean }): boolean {
  return key.sequence === "S" || (key.shift === true && key.name === "s");
}

function trimToWidth(line: string, innerWidth: number): string {
  if (line.length <= innerWidth) return line;
  return `${line.slice(0, Math.max(1, innerWidth - 1))}…`;
}

export function buildFooterLines(width: number, runningSummary: string | null = null): string[] {
  const innerWidth = Math.max(30, width - 4);
  if (runningSummary !== null) {
    return [trimToWidth(` ${runningSummary}`, innerWidth)];
  }
  const items = ["[Tab] Focus", "[Space] Select", "[?] Help", "[q] Quit"];

  let line = "";
  for (const item of items) {
    const next = line.length === 0 ? ` ${item}` : `${line}  ${item}`;
    if (next.length <= innerWidth) {
      line = next;
    }
  }

  return [line];
}

export function buildHeaderLine(width: number, header: string): string {
  const innerWidth = Math.max(30, width - 4);
  return trimToWidth(` ${header}`, innerWidth);
}

export function buildRunningSummary(
  statuses: readonly { phase: StatusPhase }[],
  quitArmed: boolean,
): string {
  if (quitArmed) {
    return "sync in progress — press q again to quit";
  }
  const counts: Record<StatusPhase, number> = { CLONING: 0, PULLING: 0, DONE: 0, FAILED: 0 };
  for (const status of statuses) {
    counts[status.phase] += 1;
  }
  const inFlight = counts.CLONING + counts.PULLING;
  return `working… · ${inFlight} cloning/pulling · ${counts.DONE} done · ${counts.FAILED} failed`;
}

// Compile-time exhaustiveness guard: an unwired ModalState variant fails here
// instead of silently rendering some default modal.
function assertUnreachable(value: never): null {
  void value;
  return null;
}

function renderModal(
  modal: NonNullable<ModalState>,
  store: Store,
  onSuspendAndRun: (run: () => Promise<number>) => Promise<void>,
) {
  switch (modal.type) {
    case "clone":
      return <CloneModal store={store} />;
    case "move":
      return <MoveModal store={store} />;
    case "workspaces":
      return <WorkspacePicker store={store} />;
    case "create":
      return <CreateModal store={store} />;
    case "open":
      return <OpenModal store={store} onSuspendAndRun={onSuspendAndRun} />;
    case "alias":
      return <AliasModal store={store} />;
    case "preview":
      return <StartPreviewModal store={store} />;
    case "root":
      return <RootModal store={store} />;
    case "search":
      return <SearchModal store={store} />;
    case "help":
      return <HelpModal store={store} />;
    case "detail":
      return <DetailModal store={store} />;
    case "confirmDelete":
      return <ConfirmModal store={store} />;
    case "confirmUntrack":
      return <ConfirmModal store={store} />;
    case "reorganize":
      return <ReorganizeModal store={store} />;
    default:
      return assertUnreachable(modal);
  }
}

export function Dashboard({
  store,
  onQuit,
  onSuspendAndRun,
}: {
  store: Store;
  onQuit: () => void;
  onSuspendAndRun: (run: () => Promise<number>) => Promise<void>;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { width, height } = useTerminalDimensions();
  const [quitArmedAt, setQuitArmedAt] = useState(0);

  useEffect(() => {
    void store.init();
  }, [store]);

  useEffect(() => {
    if (!snapshot.running) setQuitArmedAt(0);
  }, [snapshot.running]);

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

  // Mouse support: the renderer reports wheel and click events on the
  // root renderable; the store maps coordinates to list rows / pane focus.
  const renderer = useRenderer();
  useEffect(() => {
    const root = renderer.root as unknown as {
      onMouseDown?: ((event: { button: number; x: number; y: number }) => void) | null;
      onMouseScroll?:
        | ((event: {
            button: number;
            x: number;
            y: number;
            scroll?: { direction?: string; delta?: number };
          }) => void)
        | null;
    };
    root.onMouseDown = (event) => {
      store.handleMouse(
        { button: event.button, x: event.x, y: event.y, type: "down" },
        width,
        height,
        {
          onQuit: handleQuit,
        },
      );
    };
    root.onMouseScroll = (event) => {
      const isUp = event.scroll?.direction === "up" || event.button === 4;
      store.handleMouse(
        {
          button: isUp ? 4 : 5,
          x: event.x,
          y: event.y,
          type: "scroll",
          scroll: event.scroll,
        },
        width,
        height,
      );
    };
    return () => {
      root.onMouseDown = null;
      root.onMouseScroll = null;
    };
  }, [renderer, store, width, height, handleQuit]);

  const quitArmed = snapshot.running && quitArmedAt !== 0;

  useKeyboard((key) => {
    const current = store.getSnapshot();
    if (current.modal !== null) {
      if (key.name === "escape") store.closeModal();
      return;
    }
    if (isDeleteKey(key) && current.focus === "list") {
      const repo = current.filteredRepos[current.cursor];
      if (repo !== undefined) {
        void store.openDeleteConfirm(`${repo.owner}/${repo.name}`);
      }
      return;
    }
    if (isReorganizeKey(key)) {
      void store.openReorganizeModal();
      return;
    }
    if (isSortDirectionKey(key)) {
      store.toggleSortDirection();
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
        store.cycleFocus();
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
        store.cyclePreset();
        return;
      case "s":
        store.cycleSort();
        return;
      case "u":
        if (current.focus === "list") {
          const repo = current.filteredRepos[current.cursor];
          if (repo !== undefined) {
            store.openUntrackConfirm(`${repo.owner}/${repo.name}`);
          }
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
      if (key.name === "up") {
        store.moveSidebarCursor(-1);
      } else if (key.name === "down") {
        store.moveSidebarCursor(1);
      } else if (key.name === "space" || key.name === "return") {
        store.activateSidebarRow();
      }
      return;
    }
    if (current.focus === "list") {
      if (key.name === "up") {
        store.moveCursor(-1);
      } else if (key.name === "down") {
        store.moveCursor(1);
      } else if (key.name === "home") {
        store.setCursor(0);
      } else if (key.name === "end") {
        store.setCursor(current.filteredRepos.length - 1);
      } else if (key.name === "pageup") {
        store.pageCursor(-1, repoViewportRows(height, current.updateToast !== null));
      } else if (key.name === "pagedown") {
        store.pageCursor(1, repoViewportRows(height, current.updateToast !== null));
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
      }
      return;
    }
    if (current.focus === "status") {
      if (key.name === "up") {
        store.moveStatusScroll(1);
      } else if (key.name === "down") {
        store.moveStatusScroll(-1);
      }
    }
  });

  const login = snapshot.userLogin ?? "…";
  const reposCount =
    snapshot.phase === "loading" ? "discovering…" : `${snapshot.repos.length} repos`;
  const header = `repotruck · ${login} (auth: ${snapshot.authMethod ?? "?"}) · preset: ${snapshot.preset} · root: ${snapshot.root} · ${reposCount}`;
  const runningSummary =
    snapshot.running && snapshot.modal === null
      ? buildRunningSummary(snapshot.statuses, quitArmed)
      : null;

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box
        border
        borderColor={theme.border()}
        height={3}
        onMouseDown={(event) => {
          event.stopPropagation?.();
          if (event.x >= 35 && event.x <= 65) {
            store.cyclePreset();
          } else if (event.x > 65 && event.x <= 95) {
            void store.openRootModal();
          }
        }}
      >
        <text fg={theme.accent()}>{buildHeaderLine(width, header)}</text>
      </box>
      {snapshot.phase === "loading" ? (
        <WorkspaceSkeleton width={width} height={height} preset={snapshot.preset} />
      ) : snapshot.phase === "error" ? (
        <box flexGrow={1} flexDirection="column">
          <text fg={theme.error()}>{snapshot.errorMessage ?? "unknown error"}</text>
        </box>
      ) : snapshot.modal === null ? (
        <box flexDirection="row" flexGrow={1}>
          <Sidebar store={store} width={sidebarWidth(width)} />
          <RepoList store={store} />
          <StatusPanel store={store} width={statusWidth(width)} />
        </box>
      ) : (
        renderModal(snapshot.modal, store, onSuspendAndRun)
      )}
      {snapshot.updateToast !== null && snapshot.modal === null ? (
        <box
          border
          borderColor={theme.toast()}
          height={3}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.dismissUpdateToast();
          }}
        >
          <text fg={theme.toast()}>
            {` repotruck ${snapshot.updateToast.version} available — update with: repotruck update`}
          </text>
        </box>
      ) : null}
      <box
        border
        borderColor={theme.border()}
        height={3}
        onMouseDown={(event) => {
          event.stopPropagation?.();
          if (snapshot.running && snapshot.modal === null) {
            handleQuit();
            return;
          }
          if (event.x <= 15) {
            store.cycleFocus();
          } else if (event.x <= 32) {
            store.toggleCurrent();
          } else if (event.x <= 45) {
            store.openHelpModal();
          } else if (event.x <= 60) {
            handleQuit();
          }
        }}
      >
        {buildFooterLines(width, runningSummary).map((line) => (
          <text key={line} fg={DIM_FG}>
            {line}
          </text>
        ))}
      </box>
    </box>
  );
}

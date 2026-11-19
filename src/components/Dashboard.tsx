import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AliasModal } from "./AliasModal.tsx";
import { CloneModal } from "./CloneModal.tsx";
import { CommandFormModal } from "./CommandFormModal.tsx";
import { ConfirmModal } from "./ConfirmModal.tsx";
import { ContextMenu } from "./ContextMenu.tsx";
import { CreateModal } from "./CreateModal.tsx";
import { DetailModal } from "./DetailModal.tsx";
import { DialogBox } from "./DialogBox.tsx";
import { HelpModal } from "./HelpModal.tsx";
import { MoveModal } from "./MoveModal.tsx";
import { NavRail } from "./NavRail.tsx";
import { OmnibarModal } from "./OmnibarModal.tsx";
import { OpenModal } from "./OpenModal.tsx";
import { ReorganizeModal } from "./ReorganizeModal.tsx";
import { RepoList } from "./RepoList.tsx";
import { RootModal } from "./RootModal.tsx";
import { SearchModal } from "./SearchModal.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { StartPreviewModal } from "./StartPreviewModal.tsx";
import { StatusPanel } from "./StatusPanel.tsx";
import type { ModalState, StatusPhase, Store, ViewId } from "./store.ts";
import { theme } from "./theme.ts";
import { AgentsView } from "./views/AgentsView.tsx";
import { CodeSearchView } from "./views/CodeSearchView.tsx";
import { ConflictResolverView } from "./views/ConflictResolverView.tsx";
import { DiscoverView } from "./views/DiscoverView.tsx";
import { ChangelogView, ScanAdoptView, WorktreesView } from "./views/FlowViews.tsx";
import { PlaceholderView } from "./views/PlaceholderView.tsx";
import { PresetsView } from "./views/PresetsView.tsx";
import { ProfilesView } from "./views/ProfilesView.tsx";
import { RunConsoleView } from "./views/RunConsoleView.tsx";
import { SettingsView } from "./views/SettingsView.tsx";
import { StatsView } from "./views/StatsView.tsx";
import { StatusMatrixView } from "./views/StatusMatrixView.tsx";
import { SyncCenterView } from "./views/SyncCenterView.tsx";
import { TrashBackupsView } from "./views/TrashBackupsView.tsx";
import { VIEW_BY_ID, VIEW_GO_KEYS } from "./views/viewRegistry.ts";
import { WorkspacePicker } from "./WorkspacePicker.tsx";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton.tsx";
import { WorktreeModal } from "./WorktreeModal.tsx";
import {
  contentWidth,
  FOOTER_ROWS,
  HEADER_ROWS,
  NAV_RAIL_WIDTH,
  navRailVisible,
  repoKeyOf,
  repoViewportRows,
  sidebarWidth,
  statusWidth,
} from "./windowing.ts";

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

function trimToWidth(line: string, innerWidth: number): string {
  if (line.length <= innerWidth) return line;
  return `${line.slice(0, Math.max(1, innerWidth - 1))}…`;
}

export function buildFooterLines(
  width: number,
  runningSummary: string | null = null,
  viewTitle: string | null = null,
): string[] {
  const innerWidth = Math.max(30, width - 4);
  if (runningSummary !== null) {
    return [trimToWidth(` ${runningSummary}`, innerWidth)];
  }
  const items = [
    ...(viewTitle !== null ? ["[Esc] Cockpit", `[v] ${viewTitle}`] : []),
    "[Tab] Focus",
    "[Space] Select",
    "[?] Help",
    "[q] Quit",
    "[:] Omnibar",
    "[/] Search",
    "[f] Health",
  ];

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

// Page body for a non-cockpit view. Implementing tickets replace the
// placeholder with a real component; the registry drives rail, help and
// palette entries so the shell stays consistent meanwhile.
function renderPage(view: ViewId, store: Store, width: number, height: number) {
  switch (view) {
    case "status":
      return <StatusMatrixView store={store} width={width} height={height} />;
    case "search":
      return <CodeSearchView store={store} width={width} />;
    case "run":
      return <RunConsoleView store={store} width={width} />;
    case "stats":
      return <StatsView store={store} width={width} />;
    case "trash":
      return <TrashBackupsView store={store} width={width} />;
    case "presets":
      return <PresetsView store={store} width={width} />;
    case "profiles":
      return <ProfilesView store={store} width={width} />;
    case "agents":
      return <AgentsView store={store} width={width} />;
    case "settings":
      return <SettingsView store={store} width={width} />;
    case "sync":
      return <SyncCenterView store={store} width={width} />;
    case "discover":
      return <DiscoverView store={store} width={width} />;
    case "resolve":
      return <ConflictResolverView store={store} />;
    case "changelog":
      return <ChangelogView store={store} width={width} />;
    case "scan":
      return <ScanAdoptView store={store} />;
    case "worktree":
      return <WorktreesView store={store} />;
    case "cockpit":
      return null;
    default: {
      const spec = VIEW_BY_ID.get(view);
      if (spec === undefined) return null;
      return <PlaceholderView spec={spec} width={width} />;
    }
  }
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
    case "confirmUntrack":
    case "confirmArchive":
      return <ConfirmModal store={store} />;
    case "reorganize":
      return <ReorganizeModal store={store} />;
    case "worktree":
      return <WorktreeModal store={store} />;
    case "omnibar":
      return <OmnibarModal store={store} />;
    case "commandForm":
      return <CommandFormModal store={store} />;
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
  // `v`-prefix arming lives in a ref: key handling must not depend on a
  // pending React re-render between the two keypresses.
  const viewPrefixRef = useRef(0);

  useEffect(() => {
    void store.ensureInit();
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
  // The nav rail occupies the leftmost columns of the content area (header
  // and footer span the full width), so content-row events are shifted by
  // the rail width and clicks landing on the rail itself are left to its
  // own component handlers.
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
    const routeMouse = (
      event: { button: number; x: number; y: number; scroll?: { direction?: string } },
      type: "down" | "scroll",
    ) => {
      const state = store.getSnapshot();
      const railActive = state.modal === null && state.view === "cockpit" && navRailVisible(width);
      let x = event.x;
      if (railActive && event.y >= HEADER_ROWS && event.y < height - FOOTER_ROWS) {
        x = event.x - NAV_RAIL_WIDTH;
        if (x < 0) return; // nav rail: its rows handle their own clicks
      }
      if (state.modal === null && state.view !== "cockpit") {
        // Pages own their content area; only header/footer bands route.
        if (event.y >= HEADER_ROWS && event.y < height - FOOTER_ROWS) return;
      }
      store.handleMouse(
        { button: event.button, x, y: event.y, type, scroll: event.scroll },
        railActive ? width - NAV_RAIL_WIDTH : width,
        height,
        {
          onQuit: handleQuit,
        },
      );
    };
    root.onMouseDown = (event) => {
      routeMouse(event, "down");
    };
    root.onMouseScroll = (event) => {
      const isUp = event.scroll?.direction === "up" || event.button === 4;
      routeMouse({ button: isUp ? 4 : 5, x: event.x, y: event.y, scroll: event.scroll }, "scroll");
    };
    return () => {
      root.onMouseDown = null;
      root.onMouseScroll = null;
    };
  }, [renderer, store, width, height, handleQuit]);

  const quitArmed = snapshot.running && quitArmedAt !== 0;

  useKeyboard((key) => {
    const current = store.getSnapshot();
    if (current.dialog !== null || current.contextMenu !== null) {
      // DialogBox / ContextMenu own their keys while open.
      return;
    }
    if (current.modal !== null) {
      if (key.name === "escape") {
        if (current.modal.type === "search") {
          store.clearSearch();
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

  const login = snapshot.userLogin ?? "…";
  const reposCount =
    snapshot.phase === "loading" ? "discovering…" : `${snapshot.repos.length} repos`;
  const offlinePrefix = snapshot.offline ? "[OFFLINE] " : "";
  const viewTitle =
    snapshot.view === "cockpit" ? null : (VIEW_BY_ID.get(snapshot.view)?.title ?? null);
  const header = `${offlinePrefix}repotruck · ${login} (auth: ${snapshot.authMethod ?? "?"}) · preset: ${snapshot.preset} · root: ${snapshot.root} · ${reposCount}${viewTitle !== null ? ` · view: ${viewTitle}` : ""}`;
  const showCockpit = snapshot.modal === null || snapshot.modal.type === "search";
  const shellVisible = snapshot.modal === null;
  const runningSummary =
    snapshot.running && shellVisible ? buildRunningSummary(snapshot.statuses, quitArmed) : null;
  const railVisible = navRailVisible(width);
  const pageWidth = contentWidth(width);
  const dimFg = theme.dim();

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box
        border
        borderColor={theme.border()}
        height={3}
        onMouseDown={(event) => {
          event.stopPropagation?.();
          if (event.x >= 35 && event.x <= 65) {
            void store.cyclePreset();
          } else if (event.x > 65 && event.x <= 95) {
            void store.openRootModal();
          }
        }}
      >
        <text fg={snapshot.offline ? theme.warning() : theme.accent()}>
          {buildHeaderLine(width, header)}
        </text>
      </box>
      {snapshot.phase === "loading" ? (
        <WorkspaceSkeleton width={width} height={height} preset={snapshot.preset} />
      ) : snapshot.phase === "error" ? (
        <box flexGrow={1} flexDirection="column" padding={1} gap={1}>
          <text fg={theme.error()}>{snapshot.errorMessage ?? "unknown error"}</text>
          <box flexDirection="row" gap={3}>
            <text
              fg={theme.warning()}
              onMouseDown={(e) => {
                e.stopPropagation();
                void store.enterOfflineMode();
              }}
            >
              {"[o] Continue in Offline Mode (local repositories)"}
            </text>
            <text
              fg={theme.accent()}
              onMouseDown={(e) => {
                e.stopPropagation();
                void store.init();
              }}
            >
              {"[r] Retry connection"}
            </text>
            <text
              fg={dimFg}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleQuit();
              }}
            >
              {"[q] Quit"}
            </text>
          </box>
        </box>
      ) : showCockpit && snapshot.view === "cockpit" ? (
        <box flexDirection="row" flexGrow={1}>
          {railVisible ? <NavRail store={store} width={NAV_RAIL_WIDTH} /> : null}
          <Sidebar store={store} width={sidebarWidth(pageWidth)} />
          <RepoList store={store} />
          <StatusPanel store={store} width={statusWidth(pageWidth)} />
        </box>
      ) : snapshot.modal !== null ? (
        renderModal(snapshot.modal, store, onSuspendAndRun)
      ) : (
        <box flexDirection="row" flexGrow={1}>
          {railVisible ? <NavRail store={store} width={NAV_RAIL_WIDTH} /> : null}
          {renderPage(snapshot.view, store, pageWidth, height)}
        </box>
      )}
      {snapshot.updateToast !== null && shellVisible ? (
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
      {snapshot.dialog !== null ? <DialogBox store={store} /> : null}
      {snapshot.contextMenu !== null ? <ContextMenu store={store} /> : null}
      <box
        border
        borderColor={theme.border()}
        height={3}
        onMouseDown={(event) => {
          event.stopPropagation?.();
          if (snapshot.running && shellVisible) {
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
          } else if (event.x <= 75) {
            store.openOmnibar("commands");
          } else if (event.x <= 88) {
            store.openSearchModal();
          } else {
            store.cycleHealthFilter();
          }
        }}
      >
        {buildFooterLines(width, runningSummary, viewTitle).map((line) => (
          <text key={line} fg={dimFg}>
            {line}
          </text>
        ))}
      </box>
    </box>
  );
}

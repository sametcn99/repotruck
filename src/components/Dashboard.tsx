import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useSyncExternalStore } from "react";
import { ContextMenu } from "./ContextMenu.tsx";
import { DialogBox } from "./DialogBox.tsx";
import { useDashboardKeys } from "./dashboardKeys.ts";
import { NavRail } from "./NavRail.tsx";
import { renderModal, renderPage, toastGlyph } from "./pageRouter.tsx";
import { RepoList } from "./RepoList.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { StatusPanel } from "./StatusPanel.tsx";
import type { StatusPhase, Store } from "./store.ts";
import { theme } from "./theme.ts";
import { VIEW_BY_ID } from "./views/viewRegistry.ts";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton.tsx";
import {
  computeCockpitPanes,
  contentWidth,
  FOOTER_ROWS,
  HEADER_ROWS,
  NAV_RAIL_WIDTH,
  navRailVisible,
} from "./windowing.ts";

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

  useEffect(() => {
    void store.ensureInit();
  }, [store]);

  // Quit arming, `v`-prefix view dispatch and the full cockpit keymap.
  const { quitArmed, handleQuit } = useDashboardKeys(store, onQuit, height, width, navRailVisible);

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
  const panes = computeCockpitPanes(pageWidth, snapshot.focus, snapshot.contextMenu !== null);
  const showCompactSwitcher = panes.mode !== "three-pane";
  const switcherRows = showCompactSwitcher ? 1 : 0;
  const railOffset = railVisible ? NAV_RAIL_WIDTH : 0;
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
          <box flexDirection="row" flexWrap="wrap" gap={3}>
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
      ) : snapshot.dialog !== null ? (
        <DialogBox store={store} />
      ) : showCockpit && snapshot.view === "cockpit" ? (
        <box flexDirection="column" flexGrow={1}>
          {showCompactSwitcher ? (
            <box flexDirection="row" gap={1} height={1} flexShrink={0}>
              <text
                fg={snapshot.focus === "sidebar" && !snapshot.navFocused ? theme.cursorFg() : dimFg}
                bg={
                  snapshot.focus === "sidebar" && !snapshot.navFocused
                    ? theme.cursorBg()
                    : undefined
                }
                wrapMode="none"
                flexShrink={0}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  store.setFocus("sidebar");
                }}
              >
                {" [Scope] "}
              </text>
              <text
                fg={snapshot.focus === "list" && !snapshot.navFocused ? theme.cursorFg() : dimFg}
                bg={
                  snapshot.focus === "list" && !snapshot.navFocused ? theme.cursorBg() : undefined
                }
                wrapMode="none"
                flexShrink={0}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  store.setFocus("list");
                }}
              >
                {` [Repos (${snapshot.filteredRepos.length})] `}
              </text>
              <text
                fg={snapshot.focus === "status" && !snapshot.navFocused ? theme.cursorFg() : dimFg}
                bg={
                  snapshot.focus === "status" && !snapshot.navFocused ? theme.cursorBg() : undefined
                }
                wrapMode="none"
                flexShrink={0}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  store.setFocus("status");
                }}
              >
                {" [Status] "}
              </text>
              <text
                fg={theme.accent()}
                wrapMode="none"
                flexShrink={0}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  store.openOmnibar("commands");
                }}
              >
                {" [:]Views "}
              </text>
            </box>
          ) : null}
          <box flexDirection="row" flexGrow={1}>
            {railVisible ? <NavRail store={store} width={NAV_RAIL_WIDTH} /> : null}
            {panes.showSidebar ? (
              <Sidebar store={store} width={panes.sidebarCols} extraReservedRows={switcherRows} />
            ) : null}
            {panes.showList ? (
              <RepoList
                store={store}
                width={panes.listCols}
                offsetX={railOffset + panes.listOffsetX}
                extraReservedRows={switcherRows}
              />
            ) : null}
            {panes.showStatus ? (
              snapshot.contextMenu !== null ? (
                <ContextMenu
                  store={store}
                  width={panes.statusCols}
                  extraReservedRows={switcherRows}
                />
              ) : (
                <StatusPanel
                  store={store}
                  width={panes.statusCols}
                  extraReservedRows={switcherRows}
                />
              )
            ) : null}
          </box>
        </box>
      ) : snapshot.modal !== null ? (
        renderModal(snapshot.modal, store, onSuspendAndRun)
      ) : (
        <box flexDirection="row" flexGrow={1}>
          {railVisible ? <NavRail store={store} width={NAV_RAIL_WIDTH} /> : null}
          {renderPage(
            snapshot.view,
            store,
            pageWidth,
            height,
            snapshot.updateToast !== null || snapshot.toast !== null,
          )}
        </box>
      )}
      {snapshot.toast !== null && shellVisible ? (
        <box
          border
          borderColor={theme.phaseColor(snapshot.toast.phase)}
          height={3}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.dismissToast();
          }}
        >
          <text fg={theme.phaseColor(snapshot.toast.phase)}>
            {trimToWidth(
              ` ${toastGlyph(snapshot.toast.phase)} ${snapshot.toast.message}`,
              Math.max(30, width - 4),
            )}
          </text>
        </box>
      ) : snapshot.updateToast !== null && shellVisible ? (
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
          if (snapshot.running && shellVisible) {
            handleQuit();
            return;
          }
          if (event.x <= 15) {
            store.cycleFocus(railVisible);
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

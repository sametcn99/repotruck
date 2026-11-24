import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useSyncExternalStore } from "react";
import { ContextMenu } from "./ContextMenu.tsx";
import { DashboardFooter } from "./DashboardFooter.tsx";
import { DialogBox } from "./DialogBox.tsx";
import { useDashboardKeys } from "./dashboardKeys.ts";
import { renderModal, renderPage, toastGlyph } from "./pageRouter.tsx";
import { RepoList } from "./RepoList.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { StatusPanel } from "./StatusPanel.tsx";
import type { StatusPhase, Store } from "./store.ts";
import { theme } from "./theme.ts";
import { ViewMenuBar, ViewMenuDropdown } from "./ViewMenu.tsx";
import { VIEW_BY_ID } from "./views/viewRegistry.ts";
import { WorkspaceSkeleton } from "./WorkspaceSkeleton.tsx";
import {
  clampBoxLine,
  computeCockpitPanes,
  FOOTER_ROWS,
  HEADER_ROWS,
  TOAST_BAND_MIN_HEIGHT,
  TOAST_RESERVED_ROWS,
} from "./windowing.ts";

const trimToWidth = clampBoxLine;

export function buildHeaderLine(width: number, header: string): string {
  const innerWidth = Math.max(1, width - 4);
  return trimToWidth(` ${header}`, innerWidth);
}

function updateNoticeText(version: string, width: number): string {
  const command = "repotruck update";
  const available = width - 5;
  const message = `Update available (${version}) · Run ${command}`;
  if (message.length <= available) return message;

  const instruction = ` · ${command}`;
  const labelWidth = available - instruction.length;
  if (labelWidth < 2) return command;
  const label = `Update ${version}`;
  return `${label.length <= labelWidth ? label : clampBoxLine(`↑${version}`, labelWidth)}${instruction}`;
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
  const { quitArmed, handleQuit } = useDashboardKeys(store, onQuit, height, width);

  // Pages own their content mouse events. Route cockpit coordinates to the store.
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
      if (state.navFocused) return;
      if (state.modal === null && state.view !== "cockpit") {
        if (event.y >= HEADER_ROWS && event.y < height - FOOTER_ROWS) return;
      }
      store.handleMouse(
        { button: event.button, x: event.x, y: event.y, type, scroll: event.scroll },
        width,
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
  const header = `${offlinePrefix}repotruck · ${login} (auth: ${snapshot.authMethod ?? "?"}) · preset: ${snapshot.workspacePreset} · root: ${snapshot.root} · ${reposCount}${viewTitle !== null ? ` · view: ${viewTitle}` : ""}`;
  const showCockpit = snapshot.modal === null || snapshot.modal.type === "search";
  const shellVisible = snapshot.modal === null;
  const showToastBand = shellVisible && height >= TOAST_BAND_MIN_HEIGHT;
  const notice =
    shellVisible && snapshot.toast !== null
      ? {
          text: `${toastGlyph(snapshot.toast.phase)} ${snapshot.toast.message}`,
          color: theme.phaseColor(snapshot.toast.phase),
          dismiss: store.dismissToast,
        }
      : shellVisible && snapshot.updateToast !== null
        ? {
            text: updateNoticeText(snapshot.updateToast.version, width),
            color: theme.toast(),
            dismiss: store.dismissUpdateToast,
          }
        : null;
  const inlineNotice = showToastBand ? null : notice;
  const runningSummary =
    snapshot.running && shellVisible ? buildRunningSummary(snapshot.statuses, quitArmed) : null;
  const panes = computeCockpitPanes(width, snapshot.focus, snapshot.contextMenu !== null);
  const showCompactSwitcher = panes.mode !== "three-pane";
  const switcherRows = showCompactSwitcher ? 1 : 0;
  const dimFg = theme.dim();

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box
        border
        borderColor={theme.border()}
        height={HEADER_ROWS}
        flexShrink={0}
        flexDirection="column"
        onMouseDown={(event) => {
          event.stopPropagation();
          if (snapshot.navFocused) store.setNavFocused(false);
        }}
      >
        <ViewMenuBar
          store={store}
          enabled={
            snapshot.phase === "ready" &&
            shellVisible &&
            snapshot.dialog === null &&
            snapshot.contextMenu === null
          }
        />
        <text
          fg={inlineNotice?.color ?? (snapshot.offline ? theme.warning() : theme.accent())}
          wrapMode="none"
          onMouseDown={(event) => {
            if (event.button !== 0 || !shellVisible || snapshot.navFocused) return;
            if (inlineNotice !== null) {
              inlineNotice.dismiss();
              return;
            }
            if (event.x >= 35 && event.x <= 65) void store.openReorganizeModal();
            else if (event.x > 65 && event.x <= 95) void store.openRootModal();
          }}
        >
          {buildHeaderLine(width, inlineNotice?.text ?? header)}
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
            </box>
          ) : null}
          <box flexDirection="row" flexGrow={1}>
            {panes.showSidebar ? (
              <Sidebar store={store} width={panes.sidebarCols} extraReservedRows={switcherRows} />
            ) : null}
            {panes.showList ? (
              <RepoList
                store={store}
                width={panes.listCols}
                offsetX={panes.listOffsetX}
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
      ) : null}
      {snapshot.phase === "ready" && snapshot.view !== "cockpit" ? (
        <box flexDirection="row" flexGrow={1} visible={shellVisible && snapshot.dialog === null}>
          {renderPage(snapshot.view, store, width, height, showToastBand && notice !== null)}
        </box>
      ) : null}
      {snapshot.phase === "ready" &&
      snapshot.dialog === null &&
      snapshot.modal !== null &&
      !(snapshot.view === "cockpit" && snapshot.modal.type === "search")
        ? renderModal(snapshot.modal, store, onSuspendAndRun)
        : null}
      {showToastBand && notice !== null ? (
        <box
          border
          height={TOAST_RESERVED_ROWS}
          flexShrink={0}
          borderColor={notice.color}
          onMouseDown={(event) => {
            event.stopPropagation();
            notice.dismiss();
          }}
        >
          <text fg={notice.color}>{buildHeaderLine(width, notice.text)}</text>
        </box>
      ) : null}
      <DashboardFooter
        store={store}
        snapshot={snapshot}
        width={width}
        runningSummary={runningSummary}
        onQuit={handleQuit}
      />
      {snapshot.navFocused && shellVisible && snapshot.dialog === null ? (
        <ViewMenuDropdown store={store} />
      ) : null}
    </box>
  );
}

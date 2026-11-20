import type React from "react";
import { AliasModal } from "./AliasModal.tsx";
import { CloneModal } from "./CloneModal.tsx";
import { CommandFormModal } from "./CommandFormModal.tsx";
import { ConfirmModal } from "./ConfirmModal.tsx";
import { ConfirmPermanentDeleteModal } from "./ConfirmPermanentDeleteModal.tsx";
import { CreateModal } from "./CreateModal.tsx";
import { DetailModal } from "./DetailModal.tsx";
import { DeviceFlowModal } from "./DeviceFlowModal.tsx";
import { HelpModal } from "./HelpModal.tsx";
import { MoveModal } from "./MoveModal.tsx";
import { OmnibarModal } from "./OmnibarModal.tsx";
import { OpenModal } from "./OpenModal.tsx";
import { ReorganizeModal } from "./ReorganizeModal.tsx";
import { RootModal } from "./RootModal.tsx";
import { SearchModal } from "./SearchModal.tsx";
import { StartPreviewModal } from "./StartPreviewModal.tsx";
import type { ModalState, StatusPhase, Store, ViewId } from "./store.ts";
import { PageShell } from "./ui/PageShell.tsx";
import { AgentsView } from "./views/AgentsView.tsx";
import { CodeSearchView } from "./views/CodeSearchView.tsx";
import { ConflictResolverView } from "./views/ConflictResolverView.tsx";
import { DiscoverView } from "./views/DiscoverView.tsx";
import { ChangelogView, ScanAdoptView, WorktreesView } from "./views/FlowViews.tsx";
import { LogView } from "./views/LogView.tsx";
import { PlaceholderView } from "./views/PlaceholderView.tsx";
import { PresetsView } from "./views/PresetsView.tsx";
import { ProfilesView } from "./views/ProfilesView.tsx";
import { RunConsoleView } from "./views/RunConsoleView.tsx";
import { SettingsView } from "./views/SettingsView.tsx";
import { StatsView } from "./views/StatsView.tsx";
import { StatusMatrixView } from "./views/StatusMatrixView.tsx";
import { SyncCenterView } from "./views/SyncCenterView.tsx";
import { TrashBackupsView } from "./views/TrashBackupsView.tsx";
import { VIEW_BY_ID } from "./views/viewRegistry.ts";
import { WorkspacePicker } from "./WorkspacePicker.tsx";
import { WorktreeModal } from "./WorktreeModal.tsx";
import { FOOTER_ROWS, HEADER_ROWS, TOAST_RESERVED_ROWS } from "./windowing.ts";

/**
 * Page/modal routing split out of Dashboard.tsx for the file-size budget.
 * Behavior is unchanged.
 */
export function toastGlyph(phase: StatusPhase): string {
  if (phase === "DONE") return "\u2713";
  if (phase === "FAILED") return "\u2717";
  return "\u203a";
}

// Compile-time exhaustiveness guard: an unwired ModalState variant fails here
// instead of silently rendering some default modal.
function assertUnreachable(value: never): null {
  void value;
  return null;
}

// Page body for a non-cockpit view. Implementing tickets replace the
// placeholder with a real component; the registry drives menu, help and
// palette entries so the shell stays consistent meanwhile.
export function renderPage(
  view: ViewId,
  store: Store,
  width: number,
  height: number,
  toastVisible = false,
) {
  const compact = height < 22 || width < 68;
  const innerWidth = Math.max(24, width - (compact ? 2 : 4));
  const toastRows = toastVisible ? TOAST_RESERVED_ROWS : 0;
  const innerHeight = Math.max(
    6,
    height - HEADER_ROWS - FOOTER_ROWS - toastRows - (compact ? 3 : 5),
  );
  const wrap = (body: React.ReactNode) => (
    <PageShell view={view} store={store}>
      {body}
    </PageShell>
  );
  switch (view) {
    case "status":
      return wrap(<StatusMatrixView store={store} width={innerWidth} height={innerHeight} />);
    case "search":
      return wrap(<CodeSearchView store={store} width={innerWidth} height={innerHeight} />);
    case "run":
      return wrap(<RunConsoleView store={store} width={innerWidth} height={innerHeight} />);
    case "stats":
      return wrap(<StatsView store={store} width={innerWidth} height={innerHeight} />);
    case "trash":
      return wrap(<TrashBackupsView store={store} width={innerWidth} height={innerHeight} />);
    case "presets":
      return wrap(<PresetsView store={store} width={innerWidth} height={innerHeight} />);
    case "profiles":
      return wrap(<ProfilesView store={store} width={innerWidth} height={innerHeight} />);
    case "agents":
      return wrap(<AgentsView store={store} width={innerWidth} height={innerHeight} />);
    case "settings":
      return wrap(<SettingsView store={store} width={innerWidth} height={innerHeight} />);
    case "log":
      return wrap(<LogView store={store} width={innerWidth} height={innerHeight} />);
    case "sync":
      return wrap(<SyncCenterView store={store} width={innerWidth} />);
    case "discover":
      return wrap(<DiscoverView store={store} width={innerWidth} height={innerHeight} />);
    case "resolve":
      return wrap(<ConflictResolverView store={store} width={innerWidth} height={innerHeight} />);
    case "changelog":
      return wrap(<ChangelogView store={store} width={innerWidth} height={innerHeight} />);
    case "scan":
      return wrap(<ScanAdoptView store={store} width={innerWidth} height={innerHeight} />);
    case "worktree":
      return wrap(<WorktreesView store={store} width={innerWidth} height={innerHeight} />);
    case "cockpit":
      return null;
    default: {
      const spec = VIEW_BY_ID.get(view);
      if (spec === undefined) return null;
      return <PlaceholderView spec={spec} width={width} />;
    }
  }
}

export function renderModal(
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
    case "deviceFlow":
      return <DeviceFlowModal store={store} />;
    case "confirmPermanentDelete":
      return <ConfirmPermanentDeleteModal store={store} />;
    default:
      return assertUnreachable(modal);
  }
}

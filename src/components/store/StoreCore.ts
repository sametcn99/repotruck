import { PRESET_IDS, type PresetRef } from "../../presets/index.ts";
import { firstErrorLine } from "../../services/cloner.ts";
import { warnQuiet } from "../../services/diagnostics.ts";
import { readSettings, writeSettings } from "../../services/settings.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { activateTheme, activeThemeName, cycleThemeName } from "../theme.ts";
import { buildSidebarRows, repoKey } from "./filters.ts";
import {
  performBulkCommandRun,
  performDoctorFixAction,
  performUndoAction,
  performWorkspaceMaintenanceAction,
} from "./lifecycleActions.ts";
import { cycleOmnibarMode, runOmnibarGithubSearch, runOmnibarSymbolSearch } from "./omnibar.ts";
import { StoreBase } from "./StoreBase.ts";
import {
  type FiltersState,
  HEALTH_FILTERS,
  type HealthFilter,
  type OmnibarMode,
  type RightPaneTab,
  SORT_CYCLE,
  type SortKey,
  STATUS_VIEW_ROWS,
  type WorkspaceMaintenanceKind,
} from "./types.ts";

export class StoreCore extends StoreBase {
  protected override async runStartupUpdateCheck(): Promise<void> {
    await this.runUpdateCheck();
  }

  togglePersonal = (): void => {
    this.recomputeVisible({ includePersonal: !this.state.includePersonal, cursor: 0 });
  };

  toggleOrg = async (org: string): Promise<void> => {
    const selected = new Set(this.state.selectedOrgs);
    if (selected.has(org)) {
      selected.delete(org);
      this.recomputeVisible({ selectedOrgs: selected });
      return;
    }
    selected.add(org);
    this.recomputeVisible({ selectedOrgs: selected });
    if (!this.orgReposCache.has(org) && this.github !== null) {
      try {
        this.orgReposCache.set(org, await this.github.listOrgRepos(org));
        this.recomputeVisible();
      } catch (error) {
        this.pushStatus("FAILED", `org:${org}`, firstErrorLine(error));
      }
    }
  };

  setFilter = (key: keyof FiltersState, value: boolean): void => {
    this.recomputeVisible({ filters: { ...this.state.filters, [key]: value }, cursor: 0 });
  };

  setHealthFilter = (healthFilter: HealthFilter): void => {
    this.recomputeVisible({ healthFilter, cursor: 0 });
  };

  cycleHealthFilter = (): void => {
    const idx = HEALTH_FILTERS.indexOf(this.state.healthFilter);
    this.recomputeVisible({
      healthFilter: HEALTH_FILTERS[(idx + 1) % HEALTH_FILTERS.length]!,
      cursor: 0,
    });
  };

  setSortKey = (sortKey: SortKey): void => this.recomputeVisible({ sortKey, cursor: 0 });

  cycleSort = (): void => {
    const index = SORT_CYCLE.indexOf(this.state.sortKey);
    this.recomputeVisible({
      sortKey: SORT_CYCLE[(index + 1) % SORT_CYCLE.length]!,
      cursor: 0,
    });
  };

  toggleSortDirection = (): void => {
    this.recomputeVisible({ sortDescending: !this.state.sortDescending, cursor: 0 });
  };

  cycleTheme = async (): Promise<void> => {
    const next = cycleThemeName(activeThemeName());
    activateTheme(next);
    this.set({ themeName: next });
    try {
      const settings = await readSettings(process.env);
      await writeSettings(process.env, { ...settings, theme: next });
    } catch {}
  };

  setRightPaneTab = (tab: RightPaneTab): void => {
    this.set({ rightPaneTab: tab, statusScroll: 0 });
    if (tab === "inspector") void this.refreshInspector();
    if (tab === "health") void this.refreshHealthTab();
  };

  runHealthDoctorFix = async (): Promise<void> => {
    await performDoctorFixAction(this.pushStatus);
    await this.refreshLocalState();
    await this.refreshHealthTab();
  };

  runWorkspaceMaintenance = async (kind: WorkspaceMaintenanceKind): Promise<void> => {
    await performWorkspaceMaintenanceAction(this.rootValue, kind, this.pushStatus);
    await this.refreshLocalState();
  };

  openSearchModal = (): void =>
    this.openModal({ type: "search", initial: this.state.search ?? "" });

  applySearch = (term: string): void =>
    this.recomputeVisible({ search: term.length === 0 ? null : term, cursor: 0 });

  clearSearch = (): void => {
    if (this.state.search !== null) this.applySearch("");
  };

  openOmnibar = (mode: OmnibarMode = "commands", initialQuery = ""): void => {
    this.set({
      omnibarLoading: false,
      omnibarSymbols: [],
      omnibarGithubRepos: [],
      modal: { type: "omnibar", mode, query: initialQuery },
      modalError: null,
    });
  };

  cycleOmnibarTab = (): void => {
    if (this.state.modal?.type !== "omnibar") return;
    const mode = cycleOmnibarMode(this.state.modal.mode);
    this.set({
      modal: { type: "omnibar", mode, query: "" },
      omnibarSymbols: [],
      omnibarGithubRepos: [],
      modalError: null,
    });
  };

  updateOmnibarQuery = async (query: string): Promise<void> => {
    if (this.state.modal?.type !== "omnibar") return;
    const mode = this.state.modal.mode;
    this.set({ modal: { type: "omnibar", mode, query }, modalError: null });
    if (mode === "symbols") {
      this.set({ omnibarLoading: true });
      try {
        const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
        const matches = await runOmnibarSymbolSearch(
          this.rootValue,
          config,
          query,
          this.deps.searchCodeFn,
        );
        if (this.state.modal?.type === "omnibar" && this.state.modal.query === query) {
          this.set({ omnibarSymbols: matches, omnibarLoading: false });
        }
      } catch (error) {
        this.set({ omnibarLoading: false, modalError: firstErrorLine(error) });
      }
    } else if (mode === "github") {
      this.set({ omnibarLoading: true });
      try {
        const found = await runOmnibarGithubSearch(this.github, query);
        if (this.state.modal?.type === "omnibar" && this.state.modal.query === query) {
          this.set({ omnibarGithubRepos: found, omnibarLoading: false });
        }
      } catch (error) {
        this.set({ omnibarLoading: false, modalError: firstErrorLine(error) });
      }
    }
  };

  submitOmnibarRunner = async (commandLine: string): Promise<void> => {
    this.closeModal();
    try {
      await performBulkCommandRun(
        this.rootValue,
        commandLine,
        [...this.state.selected],
        this.deps.runInReposFn,
        this.pushStatus,
      );
      await this.refreshLocalState();
    } catch (error) {
      this.pushStatus("FAILED", "[run]", firstErrorLine(error));
    }
  };

  undoLast = async (): Promise<void> => {
    const action = this.undoStack.pop();
    this.set({ canUndo: this.undoStack.length > 0 });
    if (action === undefined) return this.pushStatus("FAILED", "[undo]", "nothing to undo");
    try {
      await performUndoAction(this.rootValue, action, this.deps.moveDirImpl, this.pushStatus);
      await this.refreshLocalState();
    } catch (error) {
      this.pushStatus("FAILED", "[undo]", firstErrorLine(error));
    }
  };

  runUpdateCheck = async (): Promise<void> => {
    try {
      const result = await this.deps.updater();
      if (
        result.updateAvailable &&
        result.latestVersion !== null &&
        result.latestVersion !== this.dismissedVersionValue
      ) {
        this.set({ updateToast: { version: result.latestVersion } });
      }
    } catch (error) {
      warnQuiet("update check failed", error);
    }
  };

  dismissUpdateToast = (): void => {
    const toast = this.state.updateToast;
    if (toast === null) return;
    this.dismissedVersionValue = toast.version;
    void this.deps.persistDismissedVersion(toast.version);
    this.set({ updateToast: null });
  };

  protected nextPresetId(): PresetRef {
    const ids: PresetRef[] = [
      ...PRESET_IDS,
      ...this.state.customPresets.map((preset) => preset.id),
    ];
    const currentIndex = ids.indexOf(this.state.preset);
    return ids[currentIndex === -1 ? 0 : (currentIndex + 1) % ids.length] ?? PRESET_IDS[0]!;
  }

  moveCursor = (delta: number): void => this.setCursor(this.state.cursor + delta);

  setCursor = (index: number): void => {
    const total = this.state.filteredRepos.length;
    if (total === 0) return;
    this.set({ cursor: Math.min(Math.max(index, 0), total - 1) });
    if (this.state.rightPaneTab === "inspector") void this.refreshInspector();
  };

  pageCursor = (delta: number, viewportRows: number): void =>
    this.moveCursor(delta * Math.max(1, viewportRows));

  moveStatusScroll = (delta: number): void => {
    const isHealth = this.state.rightPaneTab === "health";
    const total = isHealth
      ? (this.state.healthData?.checks.length ?? 0)
      : this.state.statuses.length;
    const maxScroll = Math.max(0, total - (isHealth ? 4 : STATUS_VIEW_ROWS));
    const statusScroll = Math.min(Math.max(this.state.statusScroll + delta, 0), maxScroll);
    if (statusScroll !== this.state.statusScroll) this.set({ statusScroll });
  };

  moveSidebarCursor = (delta: number): void => {
    const rows = buildSidebarRows(this.state).length;
    if (rows > 0) this.set({ sidebarCursor: (this.state.sidebarCursor + delta + rows) % rows });
  };

  setSidebarCursor = (index: number): void => {
    const total = buildSidebarRows(this.state).length;
    if (total > 0) this.set({ sidebarCursor: Math.min(Math.max(index, 0), total - 1) });
  };

  toggleCurrent = (): void => this.toggleRepoAt(this.state.cursor);

  toggleRepoAt = (index: number): void => {
    const repo = this.state.filteredRepos[index];
    if (repo === undefined) return;
    const key = repoKey(repo);
    const selected = new Set(this.state.selected);
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);
    this.set({ selected, cursor: index });
  };

  handleRepoRowClick = (index: number, key: string, relX?: number): void => {
    if (relX !== undefined && relX <= 6) {
      this.lastRepoClick = null;
      this.toggleRepoAt(index);
      return;
    }
    const now = Date.now();
    if (this.lastRepoClick?.index === index && now - this.lastRepoClick.time < 400) {
      this.lastRepoClick = null;
      this.setCursor(index);
      this.openDetailModal(key);
      return;
    }
    this.lastRepoClick = { index, time: now };
    if (index !== this.state.cursor) this.setCursor(index);
    else this.toggleCurrent();
  };

  selectAll = (): void => {
    const keys = this.state.filteredRepos.map(repoKey);
    const selected = new Set(this.state.selected);
    const allSelected = keys.every((key) => selected.has(key));
    for (const key of keys) {
      if (allSelected) selected.delete(key);
      else selected.add(key);
    }
    this.set({ selected });
  };

  protected activeTargetKeys(fallbackCursor = true): string[] {
    if (this.state.selected.size > 0) return [...this.state.selected];
    if (!fallbackCursor) return [];
    const repo = this.state.filteredRepos[this.state.cursor];
    return repo !== undefined ? [repoKey(repo)] : [];
  }
}

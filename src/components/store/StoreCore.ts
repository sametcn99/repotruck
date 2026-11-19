import { deleteWorkspaceProfile, saveWorkspaceProfile } from "../../core/profiles.ts";
import { PRESET_IDS, type PresetRef, validateCustomPreset } from "../../presets/index.ts";
import type { GenerateAgentsMdInput } from "../../services/agentsMd.ts";
import { listWorkspaceSnapshots } from "../../services/backups.ts";
import { firstErrorLine } from "../../services/cloner.ts";
import { warnQuiet } from "../../services/diagnostics.ts";
import { computeWorkspaceHealthScore } from "../../services/healthScore.ts";
import { exportInstructionsFile } from "../../services/instructionExport.ts";
import { readSettings, writeSettings } from "../../services/settings.ts";
import { applyAgentsMdTemplate, clearAgentsMdTemplate } from "../../services/templates.ts";
import { listTrashEntries, restoreTrashEntry } from "../../services/trash.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { restoreWorkspaceSnapshot } from "../../services/workspaceRegistry.ts";
import { activateTheme, activeThemeName, cycleThemeName } from "../theme.ts";
import { nextViewId } from "../views/viewRegistry.ts";
import { buildSidebarRows, repoKey } from "./filters.ts";
import { loadWorkspaceHealthData } from "./gitHealth.ts";
import {
  performBulkCommandRun,
  performDoctorFixAction,
  performUndoAction,
  performWorkspaceMaintenanceAction,
  tokenizeCommandLine,
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
  type ViewId,
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

  setView = (view: ViewId): void => {
    if (this.state.view === view) return;
    this.set({ view, statusScroll: 0 });
  };

  cycleView = (direction: 1 | -1): void => {
    this.setView(nextViewId(this.state.view, direction));
  };

  openCommandForm = (specId: string): void => {
    this.openModal({ type: "commandForm", specId });
  };

  // ---- Settings page (t10) ---------------------------------------------------
  refreshSettingsPage = async (): Promise<void> => {
    try {
      const settings = await readSettings(process.env);
      const auth = await this.deps.auth().catch(() => null);
      this.set({
        settingsPage: {
          settings,
          authMethod: auth?.method ?? null,
          userLogin: this.userLoginValue,
        },
      });
    } catch {
      this.set({
        settingsPage: { settings: null, authMethod: null, userLogin: this.userLoginValue },
      });
    }
  };

  setSetting = async (key: string, value: string | boolean | number): Promise<void> => {
    try {
      const settings = await readSettings(process.env);
      const next = setNestedSetting(settings, key, value);
      await writeSettings(process.env, next);
      this.pushStatus("DONE", "[config]", `set ${key} = ${String(value)}`);
      await this.refreshSettingsPage();
    } catch (error) {
      this.pushStatus("FAILED", "[config]", error instanceof Error ? error.message : String(error));
    }
  };

  unsetSetting = async (key: string): Promise<void> => {
    try {
      const settings = await readSettings(process.env);
      const next = unsetNestedSetting(settings, key);
      await writeSettings(process.env, next);
      this.pushStatus("DONE", "[config]", `unset ${key}`);
      await this.refreshSettingsPage();
    } catch (error) {
      this.pushStatus("FAILED", "[config]", error instanceof Error ? error.message : String(error));
    }
  };

  resetDefaultRoot = async (): Promise<void> => {
    await this.setSetting("defaultRoot", "");
    await this.unsetSetting("defaultRoot");
    await this.refreshLocalState();
  };

  // ---- Presets page (t11) ------------------------------------------------------
  addCustomPreset = async (id: string, segments: readonly string[]): Promise<void> => {
    const validated = validateCustomPreset({ id, segments: [...segments] });
    if (validated === null) {
      this.pushStatus(
        "FAILED",
        "[preset]",
        "segments must be 1-4 distinct tokens from owner, category, language, name, ending with name",
      );
      return;
    }
    try {
      const settings = await readSettings(process.env);
      await writeSettings(process.env, {
        ...settings,
        presets: { ...(settings.presets ?? {}), [validated.id]: { segments: validated.segments } },
      });
      this.pushStatus("DONE", "[preset]", `${validated.id} -> ${validated.segments.join("/")}`);
      await this.refreshLocalState();
    } catch (error) {
      this.pushStatus("FAILED", "[preset]", error instanceof Error ? error.message : String(error));
    }
  };

  removeCustomPreset = async (id: string): Promise<void> => {
    try {
      const settings = await readSettings(process.env);
      const presets = { ...(settings.presets ?? {}) };
      if (presets[id] === undefined) {
        this.pushStatus("FAILED", "[preset]", `preset not found: ${id}`);
        return;
      }
      delete presets[id];
      await writeSettings(process.env, { ...settings, presets });
      this.pushStatus("DONE", "[preset]", `${id} removed`);
      await this.refreshLocalState();
    } catch (error) {
      this.pushStatus("FAILED", "[preset]", error instanceof Error ? error.message : String(error));
    }
  };

  // ---- Profiles page (t11) ------------------------------------------------------
  profileSaveFromSelection = async (name: string): Promise<void> => {
    try {
      const refs =
        this.state.selected.size > 0
          ? [...this.state.selected]
          : [...this.state.localHealth.entries()].filter(([, h]) => h.pinned).map(([key]) => key);
      const result = await saveWorkspaceProfile(this.rootValue, name, refs);
      this.pushStatus(result.ok ? "DONE" : "FAILED", "[profile]", result.message);
      if (result.ok) await this.refreshLocalState();
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[profile]",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  profileDelete = async (name: string): Promise<void> => {
    try {
      const result = await deleteWorkspaceProfile(this.rootValue, name);
      this.pushStatus(result.ok ? "DONE" : "FAILED", "[profile]", result.message);
      if (result.ok) await this.refreshLocalState();
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[profile]",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  // ---- Agents page (t12) ---------------------------------------------------------
  applyAgentsTemplate = async (name: string, clear = false): Promise<void> => {
    try {
      const input = await this.agentsMdInput();
      const templateInput = { ...input, root: this.rootValue };
      const result = clear
        ? await clearAgentsMdTemplate(templateInput)
        : await applyAgentsMdTemplate(templateInput, name);
      this.pushStatus(result.ok ? "DONE" : "FAILED", "[instructions]", result.message);
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[instructions]",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  exportInstructions = async (
    format: "agents" | "cursor" | "claude" | "copilot",
    outPath?: string,
  ): Promise<void> => {
    try {
      const input = await this.agentsMdInput();
      const result = await exportInstructionsFile(this.rootValue, input, format, outPath);
      this.pushStatus("DONE", "[instructions]", `exported ${format} -> ${result.targetPath}`);
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[instructions]",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  private async agentsMdInput(): Promise<GenerateAgentsMdInput> {
    const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
    this.localConfig = config;
    return {
      preset: config.preset,
      lastSync: config.lastSync,
      repos: config.repos,
      ...(config.aliases !== undefined ? { aliases: config.aliases } : {}),
      ...(config.pinned !== undefined ? { pinned: config.pinned } : {}),
    };
  }

  startMcpServer = async (port: number): Promise<void> => {
    if (this.taskLabel("mcp") !== null) return;
    try {
      const child = Bun.spawn(
        [process.execPath, process.argv[1] ?? "repotruck", "mcp", "--http", "--port", String(port)],
        { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
      );
      this.beginTask("mcp", `mcp --http --port ${port}`, () => child.kill());
      this.pushStatus("DONE", "[mcp]", `serving on http://127.0.0.1:${port}/mcp`);
    } catch (error) {
      this.pushStatus("FAILED", "[mcp]", error instanceof Error ? error.message : String(error));
    }
  };

  stopMcpServer = (): void => {
    if (this.taskLabel("mcp") === null) return;
    this.cancelTask("mcp");
    this.pushStatus("DONE", "[mcp]", "server stopped");
  };

  // ---- Code Search page (t06) ---------------------------------------------
  updateCodeSearchForm = (partial: Partial<CodeSearchForm>): void => {
    const current = this.state.codeSearchPage ?? defaultCodeSearchForm();
    this.set({ codeSearchPage: { ...current, ...partial } });
  };

  runCodeSearchPage = async (): Promise<void> => {
    const form = this.state.codeSearchPage ?? defaultCodeSearchForm();
    const pattern = form.pattern.trim();
    if (pattern.length === 0) return;
    this.set({ codeSearchPage: { ...form, loading: true } });
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const result = await this.deps.searchCodeFn({
        root: this.rootValue,
        config,
        pattern,
        ...(form.kind !== "" ? { kind: form.kind } : {}),
        ...(form.lang !== "" ? { lang: form.lang } : {}),
        limit: form.limit,
        offline: form.offline,
        ...(form.mode === "text" ? { text: true } : {}),
        ...(form.mode === "re" ? { regex: true } : {}),
      });
      const guard = this.state.codeSearchPage;
      if (guard !== null)
        this.set({ codeSearchPage: { ...guard, loading: false, matches: result.matches } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushStatus("FAILED", "[search-code]", message);
      const guard = this.state.codeSearchPage;
      if (guard !== null) this.set({ codeSearchPage: { ...guard, loading: false, matches: [] } });
    }
  };

  rebuildCodeIndex = async (): Promise<void> => {
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      await this.deps.searchCodeFn({
        root: this.rootValue,
        config,
        pattern: "",
        rebuild: true,
        offline: true,
      });
      this.pushStatus("DONE", "[search-code]", "symbol index rebuilt");
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[search-code]",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  // ---- Run Console page (t07) ----------------------------------------------
  updateRunConsole = (partial: Partial<import("./types.ts").RunConsoleState>): void => {
    const current = this.state.runConsole ?? defaultRunConsoleState();
    this.set({ runConsole: { ...current, ...partial } });
  };

  runConsoleStart = async (): Promise<void> => {
    const state = this.state.runConsole ?? defaultRunConsoleState();
    const commandLine = state.command.trim();
    if (commandLine.length === 0 || state.running) return;
    const [command, ...args] = tokenizeCommandLine(commandLine);
    if (command === undefined) return;
    const refs =
      state.scope === "selection"
        ? [...this.state.selected]
        : state.scope === "pinned"
          ? [...this.state.localHealth.entries()].filter(([, h]) => h.pinned).map(([key]) => key)
          : state.scope === "profile"
            ? await profileRefs(this.rootValue, state.profile)
            : [];
    this.set({ runConsole: { ...state, running: true, results: [], skipped: [] } });
    const taskId = "run-console";
    this.beginTask(taskId, "run");
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const result = await this.deps.runInReposFn({
        root: this.rootValue,
        config,
        refs,
        command,
        args,
        concurrency: state.concurrency,
      });
      const guard = this.state.runConsole;
      if (guard !== null) {
        this.set({
          runConsole: {
            ...guard,
            running: false,
            results: result.results,
            skipped: result.skipped,
          },
        });
      }
      const failed = result.results.filter((r) => !r.ok).length;
      this.endTask(taskId, `${result.results.length} repos · ${failed} failed`, failed > 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.endTask(taskId, message, true);
      const guard = this.state.runConsole;
      if (guard !== null) this.set({ runConsole: { ...guard, running: false } });
    }
  };

  // ---- Stats page (t08) ------------------------------------------------------
  refreshStatsPage = async (): Promise<void> => {
    this.set({
      statsPage: {
        loading: true,
        stats: this.state.statsPage?.stats ?? null,
        health: this.state.statsPage?.health ?? null,
        checks: this.state.statsPage?.checks ?? [],
      },
    });
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const health = await loadWorkspaceHealthData(this.rootValue, config);
      const score = await computeWorkspaceHealthScore(this.rootValue, config);
      this.set({
        statsPage: { loading: false, stats: health.stats, health: score, checks: health.checks },
      });
    } catch {
      this.set({ statsPage: { loading: false, stats: null, health: null, checks: [] } });
    }
  };

  // ---- Trash & Backups page (t09) -------------------------------------------
  refreshTrashPage = async (): Promise<void> => {
    try {
      const [trash, backups] = await Promise.all([
        listTrashEntries(this.rootValue),
        listWorkspaceSnapshots(this.rootValue),
      ]);
      this.set({ trashPage: { trash, backups } });
    } catch {
      this.set({ trashPage: { trash: [], backups: [] } });
    }
  };

  trashRestoreEntry = async (id: string): Promise<void> => {
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const result = await restoreTrashEntry(this.rootValue, id);
      this.pushStatus("DONE", "[trash]", result.message);
      await this.refreshLocalState();
      await this.refreshTrashPage();
    } catch (error) {
      this.pushStatus("FAILED", "[trash]", error instanceof Error ? error.message : String(error));
    }
  };

  trashEmptyConfirm = (olderThanDays?: number): void => {
    const keep =
      olderThanDays !== undefined && olderThanDays > 0 ? ` --older-than ${olderThanDays}` : "";
    this.confirmDialog(
      {
        title: "Empty trash",
        message: `Permanently remove trashed directories? (trash empty --yes${keep})`,
        confirmLabel: "Empty",
        danger: true,
      },
      () => {
        void this.runWorkspaceMaintenance("trash-empty");
        void this.refreshTrashPage();
      },
    );
  };

  backupSnapshotNow = async (): Promise<void> => {
    await this.runWorkspaceMaintenance("backup");
    await this.refreshTrashPage();
  };

  backupRestoreConfirm = (file: string): void => {
    this.confirmDialog(
      {
        title: "Restore snapshot",
        message: `Restore ${file}? This replaces the current workspace inventory.`,
        confirmLabel: "Restore",
        danger: true,
      },
      () => {
        void (async () => {
          try {
            await restoreWorkspaceSnapshot(this.rootValue, file, process.env);
            this.pushStatus("DONE", "[backup]", `inventory restored from ${file}`);
            await this.refreshLocalState();
            await this.refreshTrashPage();
          } catch (error) {
            this.pushStatus(
              "FAILED",
              "[backup]",
              error instanceof Error ? error.message : String(error),
            );
          }
        })();
      },
    );
  };

  refreshStatusMatrix = async (remote?: boolean): Promise<void> => {
    const wantRemote = remote ?? this.state.statusMatrix?.remote ?? false;
    this.set({
      statusMatrix: {
        loading: true,
        remote: wantRemote,
        lastSync: this.state.statusMatrix?.lastSync ?? null,
        repos: this.state.statusMatrix?.repos ?? [],
      },
    });
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const github =
        wantRemote && this.github !== null && this.github.getRepoRemoteHealth !== undefined
          ? {
              getRepoRemoteHealth: (owner: string, name: string) =>
                this.github!.getRepoRemoteHealth!(owner, name),
            }
          : undefined;
      const result = await this.deps.workspaceStatusFn(this.rootValue, config, {
        detail: true,
        remote: wantRemote,
        ...(github !== undefined ? { github } : {}),
      });
      this.set({
        statusMatrix: {
          loading: false,
          remote: wantRemote,
          lastSync: result.lastSync,
          repos: result.repos,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushStatus("FAILED", "[status]", message);
      this.set({
        statusMatrix: { loading: false, remote: wantRemote, lastSync: null, repos: [] },
      });
    }
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

// ---- page-state helpers ----------------------------------------------------

export interface CodeSearchForm {
  pattern: string;
  mode: "sym" | "text" | "re";
  kind: string;
  lang: string;
  limit: number;
  offline: boolean;
}

export function defaultCodeSearchForm(): import("./types.ts").CodeSearchPageState {
  return {
    loading: false,
    pattern: "",
    mode: "sym",
    kind: "",
    lang: "",
    limit: 50,
    offline: true,
    matches: [],
  };
}

export function defaultRunConsoleState(): import("./types.ts").RunConsoleState {
  return {
    running: false,
    command: "",
    scope: "selection",
    profile: "",
    concurrency: 3,
    results: [],
    skipped: [],
  };
}

async function profileRefs(root: string, profile: string): Promise<string[]> {
  try {
    const config = await loadWorkspace(root);
    return config.profiles?.[profile] ?? [];
  } catch {
    return [];
  }
}


function setNestedSetting(
  settings: import("../../services/settings.ts").RepotruckSettings,
  key: string,
  value: string | boolean | number,
): import("../../services/settings.ts").RepotruckSettings {
  if (!key.includes(".")) return { ...settings, [key]: value };
  const [head, tail] = key.split(".") as [string, string];
  const current = (settings as Record<string, unknown>)[head];
  const base = typeof current === "object" && current !== null ? current : {};
  return { ...settings, [head]: { ...(base as object), [tail]: value } };
}

function unsetNestedSetting(
  settings: import("../../services/settings.ts").RepotruckSettings,
  key: string,
): import("../../services/settings.ts").RepotruckSettings {
  if (!key.includes(".")) {
    const next = { ...settings } as Record<string, unknown>;
    delete next[key];
    return next as import("../../services/settings.ts").RepotruckSettings;
  }
  const [head, tail] = key.split(".") as [string, string];
  const current = (settings as Record<string, unknown>)[head];
  if (typeof current !== "object" || current === null) return settings;
  const section = { ...(current as Record<string, unknown>) };
  delete section[tail];
  return { ...settings, [head]: section };
}

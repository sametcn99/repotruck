import type { EmitProgress } from "../../services/cloner.ts";
import type { RepotruckConfig } from "../../services/config.ts";
import { diagSnapshot, diagSubscribe, logDiag } from "../../services/diagnostics.ts";
import type { RepoLookup } from "../../services/forkSource.ts";
import type { RepoInfo } from "../../services/github.ts";
import { readCustomPresets } from "../../services/settings.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { VIEW_ORDER } from "../views/viewRegistry.ts";
import { buildInitialSnapshot, buildStoreDeps, type ResolvedStoreDeps } from "./defaults.ts";
import {
  filterByHealth,
  filterRepos,
  inventoryEntryToRepoInfo,
  repoKey,
  searchRepos,
  sortRepos,
} from "./filters.ts";
import {
  buildFastLocalHealthMap,
  hydrateAsyncGitHealth,
  loadRepoInspectorDetails,
  loadWorkspaceHealthData,
} from "./gitHealth.ts";
import { OperationTracker } from "./operations.ts";
import { detailLocalFor } from "./repoDetail.ts";
import {
  type FiltersState,
  FOCUS_ORDER,
  type FocusRegion,
  type GithubClient,
  type HealthFilter,
  type ModalState,
  type RepoLocalHealth,
  type SortKey,
  STATUSES_CAP,
  type StatusEntry,
  type StatusPhase,
  type StoreDeps,
  type StoreSnapshot,
  TOAST_FAILED_MS,
  TOAST_MS,
  type ToastEntry,
  UNDO_STACK_CAP,
  type UndoAction,
} from "./types.ts";

export abstract class StoreBase {
  protected state: StoreSnapshot;
  private readonly listeners = new Set<() => void>();
  protected readonly deps: ResolvedStoreDeps;
  protected rootValue: string;
  protected readonly operations = new OperationTracker(() => this.rootValue);
  protected dismissedVersionValue: string | null = null;
  protected github: GithubClient | null = null;
  protected lookupForkRepo?: RepoLookup;
  protected token: string | null = null;
  protected userLoginValue: string | null = null;
  protected undoStack: UndoAction[] = [];
  protected lastRepoClick: { index: number; time: number } | null = null;
  protected personalRepos: RepoInfo[] = [];
  protected orgReposCache = new Map<string, RepoInfo[]>();
  protected localConfig: RepotruckConfig | null = null;
  protected sessionAddedRepos = new Map<string, RepoInfo>();
  private nextStatusId = 1;
  protected initialized = false;
  private healthGen = 0;

  private lastDiagId = 0;
  private disposed = false;
  private unsubscribeDiagnostics: () => void = () => {};

  constructor(root: string, deps: StoreDeps = {}) {
    this.rootValue = root;
    this.deps = buildStoreDeps(deps);
    this.state = buildInitialSnapshot(root);
    // Background diagnostics (runtime handlers, Octokit, warnQuiet) raise an
    // instant FAILED toast on every view. Entries born from a FAILED status
    // are skipped — the status mirror already toasted those.
    const currentDiag = diagSnapshot();
    this.lastDiagId = currentDiag.length > 0 ? (currentDiag[currentDiag.length - 1]?.id ?? 0) : 0;
    this.unsubscribeDiagnostics = diagSubscribe(() => this.surfaceDiagErrors());
  }

  private surfaceDiagErrors(): void {
    const entries = diagSnapshot();
    for (const entry of entries) {
      if (entry.id <= this.lastDiagId) continue;
      if (entry.level === "error" && entry.fromStatus !== true) {
        this.showToast(
          "FAILED",
          `${entry.source}${entry.message.length > 0 ? ` — ${entry.message}` : ""}`,
        );
      }
    }
    const last = entries[entries.length - 1];
    if (last !== undefined && last.id > this.lastDiagId) this.lastDiagId = last.id;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): StoreSnapshot => this.state;

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.operations.invalidate();
    this.healthGen++;
    this.unsubscribeDiagnostics();
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    for (const task of this.activeTasks.values()) task.cancel?.();
    this.activeTasks.clear();
    this.listeners.clear();
  };

  protected set(partial: Partial<StoreSnapshot>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  protected workspaceOperation(key: string) {
    const operation = this.operations.start(key);
    return {
      ...operation,
      set: (partial: Partial<StoreSnapshot>) => {
        if (operation.current()) this.set(partial);
      },
      pushStatus: (...args: Parameters<typeof this.pushStatus>) => {
        if (operation.current()) this.pushStatus(...args);
      },
      pushUndo: (...args: Parameters<typeof this.pushUndo>) => {
        if (operation.current()) this.pushUndo(...args);
      },
      endTask: (...args: Parameters<typeof this.endTask>) => {
        if (operation.current()) this.endTask(...args);
      },
    };
  }

  get root(): string {
    return this.rootValue;
  }

  setModalError = (modalError: string | null): void => this.set({ modalError });
  openModal = (modal: ModalState): void => this.set({ modal, modalError: null });
  setModal = (modal: ModalState): void => this.set({ modal });
  closeModal = (): void => {
    this.operations.cancel("omnibar");
    this.operations.cancel("detail-local");
    this.set({ modal: null, modalError: null, movePrefill: null });
  };

  private dialogConfirm: (() => void) | null = null;

  confirmDialog = (
    options: { title: string; message: string; confirmLabel?: string; danger?: boolean },
    onConfirm: () => void,
  ): void => {
    this.dialogConfirm = onConfirm;
    this.set({
      dialog: {
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? "Confirm",
        danger: options.danger === true,
      },
    });
  };

  resolveDialog = (confirmed: boolean, expected = this.state.dialog): void => {
    if (expected !== this.state.dialog) return;
    const callback = this.dialogConfirm;
    this.dialogConfirm = null;
    this.set({ dialog: null });
    if (confirmed && callback !== null) callback();
  };

  // ---- background task model ---------------------------------------------
  // Generic long-running work (MCP server, command runs) tracked beside
  // the sync-specific `running` flag so the dashboard reflects both.

  protected activeTasks = new Map<string, { label: string; cancel?: () => void }>();

  beginTask = (id: string, label: string, cancel?: () => void): void => {
    this.activeTasks.set(id, { label, ...(cancel !== undefined ? { cancel } : {}) });
    this.set({ activeTaskCount: this.activeTasks.size });
    this.pushStatus("DONE", `[${label}]`, "started");
  };

  endTask = (id: string, message?: string, failed = false): void => {
    const task = this.activeTasks.get(id);
    this.activeTasks.delete(id);
    this.set({ activeTaskCount: this.activeTasks.size });
    if (task !== undefined) {
      this.pushStatus(
        failed ? "FAILED" : "DONE",
        `[${task.label}]`,
        message ?? (failed ? "failed" : "done"),
      );
    }
  };

  cancelTask = (id: string): void => {
    this.activeTasks.get(id)?.cancel?.();
    this.endTask(id, "cancelled");
  };

  taskLabel = (id: string): string | null => this.activeTasks.get(id)?.label ?? null;
  openHelpModal = (): void => this.openModal({ type: "help" });
  openDetailModal = (key: string): void => this.openModal({ type: "detail", key });
  openCloneModal = (): void => this.openModal({ type: "clone" });

  setFocus = (focus: FocusRegion): void => {
    if (this.state.focus !== focus || this.state.navFocused) {
      this.set({ focus, navFocused: false });
    }
  };

  setNavFocused = (navFocused: boolean): void => {
    if (this.state.navFocused !== navFocused) {
      const navCursor = navFocused
        ? Math.max(0, VIEW_ORDER.indexOf(this.state.view))
        : this.state.navCursor;
      this.set({ navFocused, navCursor });
    }
  };

  setNavCursor = (index: number): void => {
    const total = VIEW_ORDER.length;
    if (total === 0) return;
    this.set({ navCursor: Math.min(Math.max(0, index), total - 1) });
  };

  cycleFocus = (direction: 1 | -1 = 1): void => {
    if (this.state.view !== "cockpit") return;
    const index = FOCUS_ORDER.indexOf(this.state.focus);
    this.setFocus(FOCUS_ORDER[(index + direction + FOCUS_ORDER.length) % FOCUS_ORDER.length]!);
  };

  pushStatus = (phase: StatusPhase, key: string, message?: string): void => {
    const entry: StatusEntry = {
      id: this.nextStatusId++,
      key,
      phase,
      ...(message !== undefined ? { message } : {}),
    };
    this.set({ statuses: [...this.state.statuses, entry].slice(-STATUSES_CAP) });
    // Failures are captured in the diagnostics log so the Log view keeps a
    // complete error history; `fromStatus` stops the diag listener from
    // toasting what the mirror below already surfaced.
    if (phase === "FAILED") logDiag("error", key, message ?? "", { fromStatus: true });
    // Full-page views have no Status Panel, so surface the result as a
    // transient toast. The cockpit already shows the activity log inline and
    // a running sync keeps its progress in the footer summary instead.
    if (this.state.view !== "cockpit" && this.state.modal === null && !this.state.running) {
      this.showToast(phase, `${key}${message !== undefined ? ` — ${message}` : ""}`);
    }
  };

  // ---- transient toast -------------------------------------------------------

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  protected showToast = (phase: StatusPhase, message: string): void => {
    const toast: ToastEntry = { id: this.nextStatusId++, phase, message };
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.set({ toast });
    // Failures carry a path/next step worth reading; successes can vanish fast.
    const delay = phase === "FAILED" ? TOAST_FAILED_MS : TOAST_MS;
    const timer = setTimeout(() => {
      this.toastTimer = null;
      if (this.state.toast?.id === toast.id) this.set({ toast: null });
    }, delay);
    timer.unref?.();
    this.toastTimer = timer;
  };

  dismissToast = (): void => {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.state.toast !== null) this.set({ toast: null });
  };

  protected progressToStatus: EmitProgress = (progress) => {
    const phase =
      progress.phase === "cloning"
        ? "CLONING"
        : progress.phase === "pulling"
          ? "PULLING"
          : progress.phase === "done"
            ? "DONE"
            : "FAILED";
    this.pushStatus(phase, progress.key, progress.message);
  };

  protected pushUndo = (action: UndoAction): void => {
    this.undoStack.push(action);
    if (this.undoStack.length > UNDO_STACK_CAP) this.undoStack.shift();
    this.set({ canUndo: this.undoStack.length > 0 });
  };

  protected composeRepos(
    selectedOrgs: ReadonlySet<string> = this.state.selectedOrgs,
    includePersonal: boolean = this.state.includePersonal,
    offline: boolean = this.state.offline,
    includeWorkspace: boolean = this.state.includeWorkspace,
  ): RepoInfo[] {
    const remote = new Map<string, RepoInfo>();
    if (!offline) {
      for (const repo of this.personalRepos) remote.set(repoKey(repo).toLowerCase(), repo);
      for (const repos of this.orgReposCache.values()) {
        for (const repo of repos) remote.set(repoKey(repo).toLowerCase(), repo);
      }
      for (const repo of this.sessionAddedRepos.values())
        remote.set(repoKey(repo).toLowerCase(), repo);
    }
    const repos = new Map<string, RepoInfo>();
    if (includeWorkspace) {
      const entries = [...(this.localConfig?.repos ?? [])].sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath),
      );
      for (const entry of entries) {
        const key = repoKey(entry).toLowerCase();
        repos.set(key, remote.get(key) ?? inventoryEntryToRepoInfo(entry));
      }
    }
    const add = (list: Iterable<RepoInfo>): void => {
      for (const repo of list) repos.set(repoKey(repo).toLowerCase(), repo);
    };
    if (!offline) {
      if (includePersonal) add(this.personalRepos);
      for (const org of selectedOrgs) add(this.orgReposCache.get(org) ?? []);
      add(this.sessionAddedRepos.values());
    }
    return [...repos.values()];
  }

  protected visibleFrom(
    repos: readonly RepoInfo[],
    filters: FiltersState = this.state.filters,
    search: string | null = this.state.search,
    sortKey: SortKey = this.state.sortKey,
    sortDescending: boolean = this.state.sortDescending,
    healthFilter: HealthFilter = this.state.healthFilter,
    localHealth: ReadonlyMap<string, RepoLocalHealth> = this.state.localHealth,
  ): RepoInfo[] {
    const byCat = filterRepos(repos, filters);
    const byHealth = filterByHealth(byCat, healthFilter, localHealth);
    const bySearch = searchRepos(byHealth, search, localHealth);
    return sortRepos(bySearch, sortKey, sortDescending, localHealth);
  }

  protected recomputeVisible(partial: Partial<StoreSnapshot> = {}): void {
    const nextState = { ...this.state, ...partial };
    const repos =
      partial.repos ??
      this.composeRepos(
        nextState.selectedOrgs,
        nextState.includePersonal,
        nextState.offline,
        nextState.includeWorkspace,
      );
    const filteredRepos = this.visibleFrom(
      repos,
      nextState.filters,
      nextState.search,
      nextState.sortKey,
      nextState.sortDescending,
      nextState.healthFilter,
      nextState.localHealth,
    );
    const currentRepo = this.state.filteredRepos[this.state.cursor];
    const sameRepo =
      partial.cursor === undefined && currentRepo !== undefined
        ? filteredRepos.findIndex(
            (repo) => repoKey(repo).toLowerCase() === repoKey(currentRepo).toLowerCase(),
          )
        : -1;
    const clampedCursor =
      sameRepo >= 0 ? sameRepo : Math.max(0, Math.min(nextState.cursor, filteredRepos.length - 1));
    this.set({ ...partial, repos, filteredRepos, cursor: clampedCursor });
  }

  protected scheduleHydrateGitHealth(
    config: RepotruckConfig,
    fastMap: Map<string, RepoLocalHealth>,
  ): void {
    const gen = ++this.healthGen;
    const root = this.rootValue;
    void hydrateAsyncGitHealth(root, config, fastMap, () => gen !== this.healthGen)
      .then((hydrated) => {
        if (hydrated !== null && gen === this.healthGen && root === this.rootValue) {
          this.recomputeVisible({ localHealth: hydrated });
        }
      })
      .catch(() => {});
  }

  refreshDetailLocal = async (key: string): Promise<void> => {
    const operation = this.workspaceOperation("detail-local");
    operation.set({ detailData: { key, local: null } });
    try {
      const local = await detailLocalFor(operation.root, key);
      operation.set({ detailData: { key, local } });
    } catch {
      operation.set({
        detailData: {
          key,
          local: {
            tracked: false,
            relativePath: null,
            alias: null,
            disk: "unable to read repository state",
          },
        },
      });
    } finally {
      operation.finish();
    }
  };

  refreshInspector = async (): Promise<void> => {
    const repo = this.state.filteredRepos[this.state.cursor];
    if (repo === undefined) return this.set({ inspector: null });
    const key = repoKey(repo);
    this.set({
      inspector: {
        key,
        loading: true,
        tracked: false,
        relativePath: null,
        alias: null,
        pinned: false,
        missing: false,
        worktree: false,
        details: null,
      },
    });
    const operation = this.operations.start("refreshInspector");
    try {
      const config = this.localConfig ?? (await loadWorkspace(operation.root));
      const inspector = await loadRepoInspectorDetails(operation.root, config, key);
      if (!operation.current()) return;
      const current = this.state.filteredRepos[this.state.cursor];
      if (current !== undefined && repoKey(current) === key) this.set({ inspector });
    } catch {
    } finally {
      operation.finish();
    }
  };

  refreshHealthTab = async (): Promise<void> => {
    const prev = this.state.healthData;
    this.set({
      healthData: {
        loading: true,
        stats: prev?.stats ?? null,
        trashCount: prev?.trashCount ?? 0,
        trashBytes: prev?.trashBytes ?? 0,
        checks: prev?.checks ?? [],
      },
    });
    const operation = this.operations.start("refreshHealthTab");
    try {
      const config = await loadWorkspace(operation.root);
      if (!operation.current()) return;
      this.localConfig = config;
      const healthData = await loadWorkspaceHealthData(operation.root, config);
      if (operation.current()) this.set({ healthData });
    } catch {
      if (!operation.current()) return;
      this.set({
        healthData: { loading: false, stats: null, trashCount: 0, trashBytes: 0, checks: [] },
      });
    } finally {
      operation.finish();
    }
  };

  refreshLocalState = async (): Promise<void> => {
    const root = this.rootValue;
    try {
      const config = await loadWorkspace(root);
      const customPresets = await readCustomPresets();
      if (this.rootValue !== root) return;
      this.localConfig = config;
      const fast = buildFastLocalHealthMap(root, config);
      this.recomputeVisible({
        localHealth: fast.map,
        pinnedCount: fast.pinnedCount,
        lastSync: config.lastSync,
        preset: config.preset,
        workspacePreset: config.preset,
        customPresets,
        profiles: config.profiles ?? {},
      });
      this.scheduleHydrateGitHealth(config, fast.map);
      if (this.state.rightPaneTab === "inspector") void this.refreshInspector();
      if (this.state.rightPaneTab === "health") void this.refreshHealthTab();
    } catch {}
  };

  protected async runStartupUpdateCheck(): Promise<void> {
    return;
  }

  ensureInit = async (): Promise<void> => {
    if (!this.initialized) await this.init();
  };

  abstract init: () => Promise<void>;
  abstract enterOfflineMode: () => Promise<void>;
}

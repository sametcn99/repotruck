import { AuthError } from "../../services/auth.ts";
import type { EmitProgress } from "../../services/cloner.ts";
import { firstErrorLine } from "../../services/cloner.ts";
import type { RepotruckConfig } from "../../services/config.ts";
import type { RepoInfo } from "../../services/github.ts";
import {
  DEFAULT_GITHUB_BASE_URL,
  readCustomPresets,
  resolveGithubBaseUrl,
} from "../../services/settings.ts";
import { loadWorkspace } from "../../services/workspace.ts";
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
  UNDO_STACK_CAP,
  type UndoAction,
} from "./types.ts";

export class StoreBase {
  protected state: StoreSnapshot;
  private readonly listeners = new Set<() => void>();
  protected readonly deps: ResolvedStoreDeps;
  protected rootValue: string;
  protected dismissedVersionValue: string | null = null;
  protected github: GithubClient | null = null;
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

  constructor(root: string, deps: StoreDeps = {}) {
    this.rootValue = root;
    this.deps = buildStoreDeps(deps);
    this.state = buildInitialSnapshot(root);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): StoreSnapshot => this.state;

  protected set(partial: Partial<StoreSnapshot>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  get root(): string {
    return this.rootValue;
  }

  setModalError = (modalError: string | null): void => this.set({ modalError });
  openModal = (modal: ModalState): void => this.set({ modal, modalError: null });
  setModal = (modal: ModalState): void => this.set({ modal });
  closeModal = (): void => this.set({ modal: null, modalError: null, movePrefill: null });
  openHelpModal = (): void => this.openModal({ type: "help" });
  openDetailModal = (key: string): void => this.openModal({ type: "detail", key });
  openCloneModal = (): void => this.openModal({ type: "clone" });

  setFocus = (focus: FocusRegion): void => {
    if (this.state.focus !== focus) this.set({ focus });
  };

  cycleFocus = (): void => {
    const index = FOCUS_ORDER.indexOf(this.state.focus);
    this.set({ focus: FOCUS_ORDER[(index + 1) % FOCUS_ORDER.length]! });
  };

  pushStatus = (phase: StatusPhase, key: string, message?: string): void => {
    const entry: StatusEntry = {
      id: this.nextStatusId++,
      key,
      phase,
      ...(message !== undefined ? { message } : {}),
    };
    this.set({ statuses: [...this.state.statuses, entry].slice(-STATUSES_CAP) });
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
    healthFilter: HealthFilter = this.state.healthFilter,
  ): RepoInfo[] {
    if (offline) return (this.localConfig?.repos ?? []).map(inventoryEntryToRepoInfo);
    const repos: RepoInfo[] = includePersonal ? [...this.personalRepos] : [];
    const seen = new Set(repos.map((r) => repoKey(r).toLowerCase()));
    const addUnique = (repo: RepoInfo): void => {
      const k = repoKey(repo).toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        repos.push(repo);
      }
    };
    for (const org of selectedOrgs) {
      for (const repo of this.orgReposCache.get(org) ?? []) addUnique(repo);
    }
    for (const repo of this.sessionAddedRepos.values()) addUnique(repo);
    const includeAllLocal = healthFilter !== "all" && healthFilter !== "uncloned";
    for (const entry of this.localConfig?.repos ?? []) {
      if (entry.internal === false || includeAllLocal) addUnique(inventoryEntryToRepoInfo(entry));
    }
    return repos;
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
        nextState.healthFilter,
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
    const clampedCursor =
      filteredRepos.length === 0 ? 0 : Math.min(nextState.cursor, filteredRepos.length - 1);
    this.set({ ...partial, repos, filteredRepos, cursor: clampedCursor });
  }

  protected scheduleHydrateGitHealth(
    config: RepotruckConfig,
    fastMap: Map<string, RepoLocalHealth>,
  ): void {
    const gen = ++this.healthGen;
    void hydrateAsyncGitHealth(this.rootValue, config, fastMap, () => gen !== this.healthGen)
      .then((hydrated) => {
        if (hydrated !== null && gen === this.healthGen) {
          this.recomputeVisible({ localHealth: hydrated });
        }
      })
      .catch(() => {});
  }

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
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      const inspector = await loadRepoInspectorDetails(this.rootValue, config, key);
      const current = this.state.filteredRepos[this.state.cursor];
      if (current !== undefined && repoKey(current) === key) this.set({ inspector });
    } catch {}
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
    try {
      const config = await loadWorkspace(this.rootValue);
      this.localConfig = config;
      this.set({ healthData: await loadWorkspaceHealthData(this.rootValue, config) });
    } catch {
      this.set({
        healthData: { loading: false, stats: null, trashCount: 0, trashBytes: 0, checks: [] },
      });
    }
  };

  refreshLocalState = async (): Promise<void> => {
    try {
      const config = await loadWorkspace(this.rootValue);
      this.localConfig = config;
      const customPresets = await readCustomPresets();
      const fast = buildFastLocalHealthMap(this.rootValue, config);
      this.recomputeVisible({
        localHealth: fast.map,
        pinnedCount: fast.pinnedCount,
        lastSync: config.lastSync,
        preset: config.preset,
        customPresets,
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

  init = async (): Promise<void> => {
    this.initialized = true;
    this.set({ phase: "loading", errorMessage: null, offline: false });
    try {
      this.dismissedVersionValue = (await this.deps.readUpdateStateFn()).dismissedVersion;
    } catch {
      this.dismissedVersionValue = null;
    }
    void this.runStartupUpdateCheck();
    if (process.env.REPOTRUCK_OFFLINE === "1") {
      await this.enterOfflineMode();
      return;
    }
    try {
      const baseUrl = await resolveGithubBaseUrl(process.env);
      const auth = await this.deps.auth();
      this.token = auth.token;
      this.github = this.deps.github(
        auth.token,
        baseUrl !== DEFAULT_GITHUB_BASE_URL ? baseUrl : undefined,
      );
      const userLogin = await this.github.getUserLogin();
      const orgs = await this.github.getActiveOrgs();
      this.userLoginValue = userLogin;
      this.personalRepos = await this.github.listUserRepos();
      this.orgReposCache.clear();
      const [customPresets, config] = await Promise.all([
        readCustomPresets(),
        loadWorkspace(this.rootValue),
      ]);
      this.localConfig = config;
      const fast = buildFastLocalHealthMap(this.rootValue, config);
      const repos = this.composeRepos(new Set<string>(), true, false, "all");
      this.set({
        phase: "ready",
        errorMessage: null,
        offline: false,
        authMethod: auth.method,
        userLogin,
        includePersonal: true,
        orgs,
        selectedOrgs: new Set<string>(),
        selected: new Set<string>(),
        localHealth: fast.map,
        pinnedCount: fast.pinnedCount,
        repos,
        filteredRepos: this.visibleFrom(
          repos,
          this.state.filters,
          null,
          "default",
          false,
          "all",
          fast.map,
        ),
        preset: config.preset,
        customPresets,
        lastSync: config.lastSync,
        cursor: 0,
        sortKey: "default",
        healthFilter: "all",
        search: null,
      });
      this.scheduleHydrateGitHealth(config, fast.map);
    } catch (error) {
      this.set({
        phase: "error",
        errorMessage: error instanceof AuthError ? error.message : firstErrorLine(error),
      });
    }
  };

  enterOfflineMode = async (): Promise<void> => {
    try {
      const [customPresets, config] = await Promise.all([
        readCustomPresets(),
        loadWorkspace(this.rootValue),
      ]);
      this.localConfig = config;
      const fast = buildFastLocalHealthMap(this.rootValue, config);
      const repos = this.composeRepos(new Set<string>(), true, true, "all");
      this.set({
        phase: "ready",
        errorMessage: null,
        offline: true,
        authMethod: "offline",
        userLogin: "local",
        orgs: [],
        selectedOrgs: new Set<string>(),
        localHealth: fast.map,
        pinnedCount: fast.pinnedCount,
        repos,
        filteredRepos: this.visibleFrom(
          repos,
          this.state.filters,
          null,
          "default",
          false,
          "all",
          fast.map,
        ),
        preset: config.preset,
        customPresets,
        lastSync: config.lastSync,
        cursor: 0,
      });
      this.pushStatus("DONE", "[offline]", `loaded ${repos.length} local tracked repositories`);
      this.scheduleHydrateGitHealth(config, fast.map);
    } catch (error) {
      this.set({ phase: "error", errorMessage: firstErrorLine(error) });
    }
  };
}

import { existsSync } from "node:fs";
import path from "node:path";
import {
  type CustomPreset,
  isInternalOwner,
  PRESET_IDS,
  type PresetRef,
  targetSegmentsForPreset,
} from "../presets/index.ts";
import type { AuthInfo } from "../services/auth.ts";
import { AuthError, getAuthInfo } from "../services/auth.ts";
import type { EmitProgress } from "../services/cloner.ts";
import { firstErrorLine } from "../services/cloner.ts";
import type { EnvLike, RepoInventoryEntry, RepotruckConfig } from "../services/config.ts";
import { createRepository, validateCreateName } from "../services/creator.ts";
import { warnQuiet } from "../services/diagnostics.ts";
import type { CreateRepoOptions, GitHubRepoReader, RepoInfo } from "../services/github.ts";
import { GitHubService } from "../services/github.ts";
import type { AppEntry, ResolvedApp, SpawnImpl } from "../services/launcher.ts";
import {
  detectApps,
  resolveApp,
  resolveRepoRef,
  runAppInRepo,
  setAlias,
} from "../services/launcher.ts";
import { deleteRepository, forgetRepository } from "../services/lifecycle.ts";
import { moveDir, moveRepository, validateMoveDestination } from "../services/mover.ts";
import { type ReorganizeResult, reorganizeWorkspace } from "../services/reorganizer.ts";
import {
  effectiveRoot,
  readCustomPresets,
  readSettings,
  validateRootInput,
  writeSettings,
} from "../services/settings.ts";
import { cloneSingleRepository, parseGitUrl } from "../services/singleCloner.ts";
import type { UpdateCheckResult, UpdateState } from "../services/updater.ts";
import { checkForUpdate, readUpdateState, writeUpdateState } from "../services/updater.ts";
import {
  loadWorkspace,
  type SyncReposOptions,
  type SyncReposResult,
  saveWorkspace,
  syncRepos,
} from "../services/workspace.ts";
import {
  centralStorePath,
  listWorkspaces,
  removeWorkspace,
  resolveWorkspaceRoot,
  type WorkspaceListing,
} from "../services/workspaceRegistry.ts";
import type { PreviewTreeEntry } from "./windowing.ts";
import {
  FOOTER_ROWS,
  HEADER_ROWS,
  repoViewportRows,
  sidebarWidth,
  statusWidth,
  TOAST_RESERVED_ROWS,
  visibleSlice,
} from "./windowing.ts";

export type FocusRegion = "sidebar" | "list" | "status";

export type StatusPhase = "CLONING" | "PULLING" | "DONE" | "FAILED";

export interface MouseEventPayload {
  button: number;
  x: number;
  y: number;
  type?: string;
  scroll?: { direction?: string; delta?: number };
  modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean };
}

export interface MouseCallbacks {
  onQuit?: () => void;
}

export interface StatusEntry {
  id: number;
  key: string;
  phase: StatusPhase;
  message?: string;
}

export interface FiltersState {
  active: boolean;
  forks: boolean;
  archived: boolean;
}

export type CreateStep = "name" | "source" | "org" | "path" | "description" | "visibility";

export interface CreateDraft {
  name: string;
  path: string;
  isPrivate: boolean;
  description?: string;
  fromDir?: string;
  org?: string;
}

export type SortKey = "default" | "name" | "language" | "updatedAt";

export const SORT_CYCLE: readonly SortKey[] = ["default", "name", "language", "updatedAt"];

export type ModalState =
  | null
  | { type: "clone" }
  | { type: "move"; key: string }
  | { type: "workspaces"; recordsPath: string }
  | { type: "create"; step: CreateStep; draft: CreateDraft }
  | { type: "open"; key: string; apps: AppEntry[] | null }
  | { type: "alias"; key: string; prefill: string }
  | { type: "preview"; entries: readonly PreviewTreeEntry[] }
  | { type: "root"; effective: string; fromOverride: boolean }
  | { type: "search"; initial: string }
  | { type: "help" }
  | { type: "detail"; key: string }
  | { type: "confirmDelete"; key: string; absPath: string }
  | { type: "confirmUntrack"; key: string }
  | {
      type: "reorganize";
      target: PresetRef;
      keepCustom: boolean;
      preview: ReorganizeResult | null;
    };

export interface StoreSnapshot {
  phase: "loading" | "ready" | "error";
  errorMessage: string | null;
  userLogin: string | null;
  authMethod: string | null;
  orgs: readonly string[];
  selectedOrgs: ReadonlySet<string>;
  repos: readonly RepoInfo[];
  filteredRepos: readonly RepoInfo[];
  filters: FiltersState;
  sortKey: SortKey;
  sortDescending: boolean;
  search: string | null;
  selected: ReadonlySet<string>;
  statuses: readonly StatusEntry[];
  statusScroll: number;
  preset: PresetRef;
  customPresets: readonly CustomPreset[];
  focus: FocusRegion;
  modal: ModalState;
  modalError: string | null;
  cursor: number;
  sidebarCursor: number;
  workspaces: readonly WorkspaceListing[];
  movePrefill: string | null;
  updateToast: { version: string } | null;
  running: boolean;
  root: string;
  lastSync: string | null;
  canUndo: boolean;
}

export interface GithubClient extends GitHubRepoReader {
  getUserLogin(): Promise<string>;
  getActiveOrgs(): Promise<string[]>;
  listUserRepos(): Promise<RepoInfo[]>;
  listOrgRepos(org: string): Promise<RepoInfo[]>;
  createRepo(name: string, options: CreateRepoOptions): Promise<RepoInfo>;
}

export interface StoreDeps {
  auth?: () => Promise<AuthInfo>;
  github?: (token: string) => GithubClient;
  cloneSingle?: typeof cloneSingleRepository;
  sync?: (options: SyncReposOptions) => Promise<SyncReposResult>;
  move?: typeof moveRepository;
  create?: typeof createRepository;
  forget?: typeof forgetRepository;
  deleteRepo?: typeof deleteRepository;
  reorganize?: typeof reorganizeWorkspace;
  listWorkspacesFn?: typeof listWorkspaces;
  removeWorkspaceFn?: typeof removeWorkspace;
  detectAppsFn?: (options: { env?: EnvLike }) => Promise<AppEntry[]>;
  resolveAppFn?: (name: string) => Promise<ResolvedApp | null>;
  spawnImpl?: SpawnImpl;
  /** Directory move used by undo; injectable for tests. */
  moveDirImpl?: (source: string, dest: string) => void;
  updater?: () => Promise<UpdateCheckResult>;
  readUpdateStateFn?: () => Promise<UpdateState>;
  persistDismissedVersion?: (version: string) => Promise<void>;
  now?: () => string;
}

/** Reversible dashboard actions; undo (z) walks this stack newest-first. */
export type UndoAction =
  | { type: "move"; key: string; from: string; to: string; config: RepotruckConfig }
  | {
      type: "delete";
      key: string;
      relativePath: string;
      trashPath: string;
      config: RepotruckConfig;
    };

export const UNDO_STACK_CAP = 10;

export const STATUSES_CAP = 300;

// Rows of the status log visible at once in the status panel; the scroll
// offset is clamped against this window size.
export const STATUS_VIEW_ROWS = 12;

export const FOCUS_ORDER: readonly FocusRegion[] = ["sidebar", "list", "status"];

export function filterRepos(repos: readonly RepoInfo[], filters: FiltersState): RepoInfo[] {
  return repos.filter((repo) => {
    if (repo.isArchived) return filters.archived;
    if (repo.isFork) return filters.forks;
    return filters.active;
  });
}

export function searchRepos(repos: readonly RepoInfo[], term: string | null): RepoInfo[] {
  if (term === null || term.length === 0) return [...repos];
  const needle = term.toLowerCase();
  return repos.filter(
    (repo) => repo.owner.toLowerCase().includes(needle) || repo.name.toLowerCase().includes(needle),
  );
}

function repoOrderKey(repo: RepoInfo): string {
  return `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
}

export function sortRepos(
  repos: readonly RepoInfo[],
  key: SortKey,
  descending = false,
): RepoInfo[] {
  const ascending = sortReposAscending(repos, key);
  return descending ? ascending.reverse() : ascending;
}

function sortReposAscending(repos: readonly RepoInfo[], key: SortKey): RepoInfo[] {
  if (key === "default") return [...repos];
  const sorted = [...repos];
  sorted.sort((a, b) => {
    let result = 0;
    if (key === "name") {
      result = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    } else if (key === "language") {
      if (a.language === null && b.language === null) result = 0;
      else if (a.language === null) result = 1;
      else if (b.language === null) result = -1;
      else result = a.language.toLowerCase().localeCompare(b.language.toLowerCase());
    } else {
      if (a.updatedAt === null && b.updatedAt === null) result = 0;
      else if (a.updatedAt === null) result = 1;
      else if (b.updatedAt === null) result = -1;
      else result = a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
    }
    if (result !== 0) return result;
    const fallback = repoOrderKey(a).localeCompare(repoOrderKey(b));
    return fallback;
  });
  return sorted;
}

export type CreateStepOrNull = CreateStep | null;

export function nextCreateStep(step: CreateStep): CreateStepOrNull {
  if (step === "name") return "source";
  if (step === "source") return "org";
  if (step === "org") return "path";
  if (step === "path") return "description";
  if (step === "description") return "visibility";
  return null;
}

export function prevCreateStep(step: CreateStep): CreateStepOrNull {
  if (step === "visibility") return "description";
  if (step === "description") return "path";
  if (step === "path") return "org";
  if (step === "org") return "source";
  if (step === "source") return "name";
  return null;
}

export function validateCreateDraft(draft: CreateDraft): string | null {
  const nameError = validateCreateName(draft.name);
  if (nameError === null) {
    return `invalid repository name: ${draft.name}`;
  }
  if (draft.path.length > 0 && validateMoveDestination(draft.path) === null) {
    return `invalid destination path: ${draft.path}`;
  }
  return null;
}

export type SidebarRow =
  | { kind: "personal"; label: string; checked: true }
  | { kind: "org"; org: string; label: string; checked: boolean }
  | { kind: "preset"; label: string; checked: false }
  | { kind: "filter"; key: keyof FiltersState; label: string; checked: boolean };

export function buildSidebarRows(snapshot: StoreSnapshot): SidebarRow[] {
  const rows: SidebarRow[] = [
    {
      kind: "personal",
      label: `Personal (${snapshot.userLogin ?? "unknown"})`,
      checked: true,
    },
  ];
  for (const org of snapshot.orgs) {
    rows.push({
      kind: "org",
      org,
      label: org,
      checked: snapshot.selectedOrgs.has(org),
    });
  }
  rows.push({ kind: "preset", label: `Preset: ${snapshot.preset}`, checked: false });
  rows.push({
    kind: "filter",
    key: "active",
    label: "Active",
    checked: snapshot.filters.active,
  });
  rows.push({
    kind: "filter",
    key: "forks",
    label: "Forks",
    checked: snapshot.filters.forks,
  });
  rows.push({
    kind: "filter",
    key: "archived",
    label: "Archived",
    checked: snapshot.filters.archived,
  });
  return rows;
}

export function sidebarRowIndexForY(localY: number, orgCount: number): number | null {
  if (localY <= 0) return null;
  // localY in 1..(1 + orgCount): Personal (0), orgs (1..orgCount)
  if (localY <= 1 + orgCount) {
    return localY - 1;
  }
  // localY = 2 + orgCount: PRESET header
  if (localY === 2 + orgCount) return null;
  // localY = 3 + orgCount: Preset row (index 1 + orgCount)
  if (localY === 3 + orgCount) {
    return 1 + orgCount;
  }
  // localY = 4 + orgCount: FILTERS header
  if (localY === 4 + orgCount) return null;
  // localY >= 5 + orgCount: Active, Forks, Archived
  const filterOffset = localY - (5 + orgCount);
  if (filterOffset >= 0 && filterOffset < 3) {
    return 2 + orgCount + filterOffset;
  }
  return null;
}

function repoKey(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`;
}

export class Store {
  private state: StoreSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly deps: Required<Omit<StoreDeps, "spawnImpl">> & Pick<StoreDeps, "spawnImpl">;
  private rootValue: string;
  private dismissedVersionValue: string | null = null;
  private github: GithubClient | null = null;
  private token: string | null = null;
  private userLoginValue: string | null = null;
  private undoStack: UndoAction[] = [];
  private lastRepoClick: { index: number; time: number } | null = null;
  private personalRepos: RepoInfo[] = [];
  private orgReposCache = new Map<string, RepoInfo[]>();
  private nextStatusId = 1;

  constructor(root: string, deps: StoreDeps = {}) {
    this.rootValue = root;
    this.deps = {
      auth: deps.auth ?? (() => getAuthInfo(process.env)),
      github: deps.github ?? ((token: string) => new GitHubService(token)),
      cloneSingle: deps.cloneSingle ?? cloneSingleRepository,
      sync: deps.sync ?? syncRepos,
      move: deps.move ?? moveRepository,
      create: deps.create ?? createRepository,
      forget: deps.forget ?? forgetRepository,
      deleteRepo: deps.deleteRepo ?? deleteRepository,
      moveDirImpl: deps.moveDirImpl ?? moveDir,
      reorganize: deps.reorganize ?? reorganizeWorkspace,
      listWorkspacesFn: deps.listWorkspacesFn ?? listWorkspaces,
      removeWorkspaceFn: deps.removeWorkspaceFn ?? removeWorkspace,
      detectAppsFn: deps.detectAppsFn ?? ((options) => detectApps(options)),
      resolveAppFn: deps.resolveAppFn ?? ((name: string) => resolveApp(name, { env: process.env })),
      spawnImpl: deps.spawnImpl,
      updater: deps.updater ?? (() => checkForUpdate(process.env)),
      readUpdateStateFn: deps.readUpdateStateFn ?? (() => readUpdateState(process.env)),
      persistDismissedVersion:
        deps.persistDismissedVersion ??
        (async (version: string) => {
          const state = await readUpdateState(process.env);
          await writeUpdateState(process.env, { ...state, dismissedVersion: version });
        }),
      now: deps.now ?? (() => new Date().toISOString()),
    };
    this.state = {
      phase: "loading",
      errorMessage: null,
      userLogin: null,
      authMethod: null,
      orgs: [],
      selectedOrgs: new Set<string>(),
      repos: [],
      filteredRepos: [],
      filters: { active: true, forks: true, archived: true },
      sortKey: "default",
      sortDescending: false,
      search: null,
      selected: new Set<string>(),
      statuses: [],
      statusScroll: 0,
      preset: "categorized",
      customPresets: [],
      focus: "list",
      modal: null,
      modalError: null,
      cursor: 0,
      sidebarCursor: 0,
      workspaces: [],
      movePrefill: null,
      updateToast: null,
      running: false,
      root,
      lastSync: null,
      canUndo: false,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): StoreSnapshot => this.state;

  private set(partial: Partial<StoreSnapshot>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  get root(): string {
    return this.rootValue;
  }

  private snapshotStatus(phase: StatusPhase, key: string, message?: string): StatusEntry {
    const entry: StatusEntry = {
      id: this.nextStatusId,
      key,
      phase,
      ...(message !== undefined ? { message } : {}),
    };
    this.nextStatusId += 1;
    return entry;
  }

  pushStatus(phase: StatusPhase, key: string, message?: string): void {
    const entry = this.snapshotStatus(phase, key, message);
    this.set({ statuses: [...this.state.statuses, entry].slice(-STATUSES_CAP) });
  }

  private progressToStatus: EmitProgress = (progress) => {
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

  private composeRepos(selected: ReadonlySet<string>): RepoInfo[] {
    const repos = [...this.personalRepos];
    const seen = new Set(repos.map(repoKey));
    for (const org of selected) {
      for (const repo of this.orgReposCache.get(org) ?? []) {
        const key = repoKey(repo).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          repos.push(repo);
        }
      }
    }
    return repos;
  }

  private visibleFrom(
    repos: readonly RepoInfo[],
    filters: FiltersState,
    search: string | null,
    sortKey: SortKey,
    sortDescending: boolean,
  ): RepoInfo[] {
    return sortRepos(searchRepos(filterRepos(repos, filters), search), sortKey, sortDescending);
  }

  private applyRepos(repos: readonly RepoInfo[]): void {
    this.set({
      repos,
      filteredRepos: this.visibleFrom(
        repos,
        this.state.filters,
        this.state.search,
        this.state.sortKey,
        this.state.sortDescending,
      ),
    });
  }

  init = async (): Promise<void> => {
    this.set({ phase: "loading", errorMessage: null });
    try {
      const updateState = await this.deps.readUpdateStateFn();
      this.dismissedVersionValue = updateState.dismissedVersion;
    } catch {
      this.dismissedVersionValue = null;
    }
    void this.runUpdateCheck();
    try {
      const auth = await this.deps.auth();
      this.token = auth.token;
      this.github = this.deps.github(auth.token);
      const userLogin = await this.github.getUserLogin();
      const orgs = await this.github.getActiveOrgs();
      this.userLoginValue = userLogin;
      this.personalRepos = await this.github.listUserRepos();
      this.orgReposCache.clear();
      const customPresets = await readCustomPresets();
      const config = await loadWorkspace(this.rootValue);
      const repos = this.composeRepos(new Set<string>());
      this.set({
        phase: "ready",
        errorMessage: null,
        authMethod: auth.method,
        userLogin,
        orgs,
        selectedOrgs: new Set<string>(),
        selected: new Set<string>(),
        repos,
        filteredRepos: this.visibleFrom(repos, this.state.filters, null, "default", false),
        preset: config.preset,
        customPresets,
        lastSync: config.lastSync,
        cursor: 0,
        sortKey: "default",
        search: null,
      });
    } catch (error) {
      this.set({
        phase: "error",
        errorMessage: error instanceof AuthError ? error.message : firstErrorLine(error),
      });
    }
  };

  toggleOrg = async (org: string): Promise<void> => {
    const selected = new Set(this.state.selectedOrgs);
    if (selected.has(org)) {
      selected.delete(org);
      this.set({ selectedOrgs: selected });
      this.applyRepos(this.composeRepos(selected));
      return;
    }
    selected.add(org);
    this.set({ selectedOrgs: selected });
    this.applyRepos(this.composeRepos(selected));
    if (!this.orgReposCache.has(org)) {
      try {
        const github = this.github;
        if (github === null) return;
        this.orgReposCache.set(org, await github.listOrgRepos(org));
        this.applyRepos(this.composeRepos(this.state.selectedOrgs));
      } catch (error) {
        this.pushStatus("FAILED", `org:${org}`, firstErrorLine(error));
      }
    }
  };

  setFilter = (key: keyof FiltersState, value: boolean): void => {
    const filters = { ...this.state.filters, [key]: value };
    this.set({
      filters,
      filteredRepos: this.visibleFrom(
        this.state.repos,
        filters,
        this.state.search,
        this.state.sortKey,
        this.state.sortDescending,
      ),
      cursor: 0,
    });
  };

  cycleSort = (): void => {
    const index = SORT_CYCLE.indexOf(this.state.sortKey);
    const sortKey = SORT_CYCLE[(index + 1) % SORT_CYCLE.length]!;
    this.set({
      sortKey,
      filteredRepos: this.visibleFrom(
        this.state.repos,
        this.state.filters,
        this.state.search,
        sortKey,
        this.state.sortDescending,
      ),
      cursor: 0,
    });
  };

  toggleSortDirection = (): void => {
    const sortDescending = !this.state.sortDescending;
    this.set({
      sortDescending,
      filteredRepos: this.visibleFrom(
        this.state.repos,
        this.state.filters,
        this.state.search,
        this.state.sortKey,
        sortDescending,
      ),
      cursor: 0,
    });
  };

  openSearchModal = (): void => {
    this.openModal({ type: "search", initial: this.state.search ?? "" });
  };

  applySearch = (term: string): void => {
    const search = term.length === 0 ? null : term;
    this.set({
      search,
      filteredRepos: this.visibleFrom(
        this.state.repos,
        this.state.filters,
        search,
        this.state.sortKey,
        this.state.sortDescending,
      ),
      cursor: 0,
    });
  };

  clearSearch = (): void => {
    if (this.state.search === null) return;
    this.applySearch("");
  };

  private pushUndo(action: UndoAction): void {
    this.undoStack.push(action);
    if (this.undoStack.length > UNDO_STACK_CAP) this.undoStack.shift();
    this.set({ canUndo: this.undoStack.length > 0 });
  }

  /** Reverts the newest reversible dashboard action (move / delete). */
  undoLast = async (): Promise<void> => {
    const action = this.undoStack.pop();
    this.set({ canUndo: this.undoStack.length > 0 });
    if (action === undefined) {
      this.pushStatus("FAILED", "[undo]", "nothing to undo");
      return;
    }
    try {
      if (action.type === "move") {
        const fromAbs = path.join(this.rootValue, ...action.to.split("/"));
        const backAbs = path.join(this.rootValue, ...action.from.split("/"));
        this.deps.moveDirImpl(fromAbs, backAbs);
        await saveWorkspace(this.rootValue, action.config);
        this.pushStatus("DONE", "[undo]", `moved ${action.key} back to ${action.from}`);
      } else {
        const backAbs = path.join(this.rootValue, ...action.relativePath.split("/"));
        this.deps.moveDirImpl(action.trashPath, backAbs);
        await saveWorkspace(this.rootValue, action.config);
        this.pushStatus(
          "DONE",
          "[undo]",
          `restored ${action.key} from trash to ${action.relativePath}`,
        );
      }
      const updated = await loadWorkspace(this.rootValue);
      this.set({ lastSync: updated.lastSync, preset: updated.preset });
    } catch (error) {
      this.pushStatus("FAILED", "[undo]", firstErrorLine(error));
    }
  };

  /**
   * Full-fledged mouse support:
   * - Scroll wheel: scrolls RepoList, Sidebar cursor, StatusPanel log history, or Reorganize preset
   * - Left click: moves focus, navigates rows, toggles repo/sidebar checkboxes, clicks footer/header/toast buttons
   * - Double click on repo: opens Detail modal
   * - Right click: opens Detail modal on repo, or dismisses open modal
   * - Header/footer/toast clicks: cycles preset, opens root modal, cycles focus, toggles select, help, quit, dismiss toast
   */
  handleMouse = (
    event: MouseEventPayload,
    width: number,
    height: number,
    callbacks?: MouseCallbacks,
  ): void => {
    const isWheel =
      event.button === 4 ||
      event.button === 5 ||
      event.type === "scroll" ||
      event.scroll !== undefined;

    if (isWheel) {
      const isScrollUp =
        event.button === 4 ||
        event.scroll?.direction === "up" ||
        (event.type === "scroll" && event.button === 0 && !event.scroll);

      if (this.state.modal !== null) {
        if (this.state.modal.type === "reorganize") {
          void this.cycleReorganizeTarget(isScrollUp ? -1 : 1);
        }
        return;
      }

      if (event.x <= sidebarWidth(width)) {
        this.set({ focus: "sidebar" });
        this.moveSidebarCursor(isScrollUp ? -1 : 1);
        return;
      }

      if (event.x > width - statusWidth(width)) {
        this.set({ focus: "status" });
        this.moveStatusScroll(isScrollUp ? 3 : -3);
        return;
      }

      this.set({ focus: "list" });
      this.moveCursor(isScrollUp ? -3 : 3);
      return;
    }

    if (event.button === 2) {
      // Right click dismisses open modal or shows detail for the clicked repo
      if (this.state.modal !== null) {
        this.closeModal();
        return;
      }
      if (event.x > sidebarWidth(width) && event.x <= width - statusWidth(width)) {
        this.set({ focus: "list" });
        const view = repoViewportRows(height, this.state.updateToast !== null);
        const total = this.state.filteredRepos.length;
        if (total === 0) return;
        const slice = visibleSlice(this.state.cursor, total, view);
        const local = event.y - 1 - HEADER_ROWS;
        if (local >= 0 && local < slice.end - slice.start) {
          const clickedIndex = slice.start + local;
          const repo = this.state.filteredRepos[clickedIndex];
          if (repo !== undefined) {
            this.setCursor(clickedIndex);
            this.openDetailModal(repoKey(repo));
          }
        }
      }
      return;
    }

    if (event.button !== 0) return;

    if (this.state.modal !== null) {
      // Clicking header or footer outside the modal closes it
      if (event.y < HEADER_ROWS || event.y >= height - FOOTER_ROWS) {
        this.closeModal();
      }
      return;
    }

    // Dismiss update toast on click
    if (this.state.updateToast !== null) {
      const toastTop = height - FOOTER_ROWS - TOAST_RESERVED_ROWS;
      if (event.y >= toastTop && event.y < toastTop + TOAST_RESERVED_ROWS) {
        this.dismissUpdateToast();
        return;
      }
    }

    // Footer actions
    if (event.y >= height - FOOTER_ROWS) {
      if (this.state.running) {
        callbacks?.onQuit?.();
        return;
      }
      if (event.x <= 15) {
        this.cycleFocus();
      } else if (event.x <= 32) {
        this.toggleCurrent();
      } else if (event.x <= 45) {
        this.openHelpModal();
      } else {
        callbacks?.onQuit?.();
      }
      return;
    }

    // Header actions
    if (event.y < HEADER_ROWS) {
      if (event.x >= 35 && event.x <= 65) {
        this.cyclePreset();
      } else if (event.x > 65 && event.x <= 95) {
        void this.openRootModal();
      }
      return;
    }

    // Sidebar
    if (event.x <= sidebarWidth(width)) {
      this.set({ focus: "sidebar" });
      const localY = event.y - 1 - HEADER_ROWS;
      const rowIndex = sidebarRowIndexForY(localY, this.state.orgs.length);
      if (rowIndex !== null) {
        const prevCursor = this.state.sidebarCursor;
        this.setSidebarCursor(rowIndex);
        if (event.x <= 6 || prevCursor === rowIndex) {
          this.activateSidebarRow();
        }
      }
      return;
    }

    // Status Panel
    if (event.x > width - statusWidth(width)) {
      this.set({ focus: "status" });
      return;
    }

    // Repo List
    this.set({ focus: "list" });
    const view = repoViewportRows(height, this.state.updateToast !== null);
    const total = this.state.filteredRepos.length;
    if (total === 0) return;
    const slice = visibleSlice(this.state.cursor, total, view);
    const local = event.y - 1 - HEADER_ROWS;
    if (local < 0 || local >= slice.end - slice.start) return;
    const clickedIndex = slice.start + local;
    const repo = this.state.filteredRepos[clickedIndex];
    if (repo === undefined) return;

    const relX = event.x - sidebarWidth(width);
    this.handleRepoRowClick(clickedIndex, repoKey(repo), relX);
  };

  openHelpModal = (): void => {
    this.openModal({ type: "help" });
  };

  openDetailModal = (key: string): void => {
    this.openModal({ type: "detail", key });
  };

  openUntrackConfirm = (key: string): void => {
    this.openModal({ type: "confirmUntrack", key });
  };

  confirmUntrack = async (key: string): Promise<void> => {
    this.closeModal();
    await this.untrackRepo(key);
  };

  untrackRepo = async (key: string): Promise<void> => {
    try {
      const config = await loadWorkspace(this.rootValue);
      const result = await this.deps.forget(this.rootValue, config, key);
      if (result.ok) {
        this.pushStatus("DONE", "[tui]", result.message);
      } else {
        this.pushStatus("FAILED", "[tui]", result.message);
      }
    } catch (error) {
      this.pushStatus("FAILED", "[tui]", firstErrorLine(error));
    }
  };

  openDeleteConfirm = async (key: string): Promise<void> => {
    try {
      const entry = await this.findTrackedEntry(key);
      if (entry === null) {
        this.pushStatus("FAILED", "[tui]", `not tracked by repotruck: ${key}`);
        return;
      }
      const absPath = path.join(this.rootValue, ...entry.relativePath.split("/"));
      this.openModal({ type: "confirmDelete", key, absPath });
    } catch (error) {
      this.pushStatus("FAILED", "[tui]", firstErrorLine(error));
    }
  };

  confirmDelete = async (key: string): Promise<boolean> => {
    this.closeModal();
    try {
      const config = await loadWorkspace(this.rootValue);
      const match = resolveRepoRef(config, key);
      // Dashboard deletes park the directory in .repotruck/trash so the
      // undo key (z) can restore both the files and the inventory entry.
      const result = await this.deps.deleteRepo(this.rootValue, config, key, {
        yes: true,
        trash: true,
      });
      if (result.ok) {
        if (match !== null && result.trashPath !== undefined) {
          this.pushUndo({
            type: "delete",
            key,
            relativePath: match.entry.relativePath,
            trashPath: result.trashPath,
            config,
          });
        }
        this.pushStatus("DONE", "[tui]", result.message);
        return true;
      }
      this.pushStatus("FAILED", "[tui]", result.message);
      return false;
    } catch (error) {
      this.pushStatus("FAILED", "[tui]", firstErrorLine(error));
      return false;
    }
  };

  openReorganizeModal = async (): Promise<void> => {
    const target = this.state.preset;
    this.openModal({ type: "reorganize", target, keepCustom: true, preview: null });
    await this.refreshReorganizePreview(target, true);
  };

  private refreshReorganizePreview = async (
    target: PresetRef,
    keepCustom: boolean,
  ): Promise<void> => {
    const modal = this.state.modal;
    if (modal === null || modal.type !== "reorganize") return;
    try {
      const preview = await this.deps.reorganize(this.rootValue, target, {
        dryRun: true,
        keepCustom,
        customPresets: this.state.customPresets,
      });
      if (this.state.modal?.type === "reorganize") {
        this.setModal({ ...this.state.modal, preview });
      }
    } catch (error) {
      if (this.state.modal?.type === "reorganize") {
        this.setModal({
          ...this.state.modal,
          preview: {
            moved: [],
            skipped: [],
            failed: [{ key: "preview", message: firstErrorLine(error) }],
            collisions: [],
          },
        });
      }
    }
  };

  setReorganizeTarget = async (target: PresetRef): Promise<void> => {
    const modal = this.state.modal;
    if (modal === null || modal.type !== "reorganize") return;
    this.setModal({ ...modal, target, preview: null });
    await this.refreshReorganizePreview(target, modal.keepCustom);
  };

  cycleReorganizeTarget = async (delta: number): Promise<void> => {
    const modal = this.state.modal;
    if (modal === null || modal.type !== "reorganize") return;
    const ids = [...PRESET_IDS, ...this.state.customPresets.map((preset) => preset.id)];
    const index = Math.max(0, ids.indexOf(modal.target));
    const next = ids[(index + delta + ids.length) % ids.length]!;
    await this.setReorganizeTarget(next);
  };

  toggleReorganizeKeepCustom = async (): Promise<void> => {
    const modal = this.state.modal;
    if (modal === null || modal.type !== "reorganize") return;
    this.setModal({ ...modal, keepCustom: !modal.keepCustom, preview: null });
    await this.refreshReorganizePreview(modal.target, !modal.keepCustom);
  };

  confirmReorganize = async (): Promise<void> => {
    const modal = this.state.modal;
    if (modal === null || modal.type !== "reorganize") return;
    this.closeModal();
    try {
      const result = await this.deps.reorganize(this.rootValue, modal.target, {
        keepCustom: modal.keepCustom,
        customPresets: this.state.customPresets,
      });
      this.pushStatus(
        "DONE",
        "[reorganize]",
        `${modal.target}: ${result.moved.length} moved, ${result.skipped.length} skipped, ${result.collisions.length} collisions, ${result.failed.length} failed`,
      );
      const updated = await loadWorkspace(this.rootValue);
      this.set({
        preset: updated.preset,
        customPresets: await readCustomPresets(),
        lastSync: updated.lastSync,
      });
    } catch (error) {
      this.pushStatus("FAILED", "[reorganize]", firstErrorLine(error));
    }
  };

  removeWorkspaceEntry = async (target: string): Promise<void> => {
    try {
      await this.deps.removeWorkspaceFn(target);
      this.set({ workspaces: await this.deps.listWorkspacesFn() });
      this.pushStatus("DONE", "[workspaces]", `removed ${target}`);
    } catch (error) {
      this.pushStatus("FAILED", "[workspaces]", firstErrorLine(error));
    }
  };

  cyclePreset = async (): Promise<void> => {
    const ids: PresetRef[] = [
      ...PRESET_IDS,
      ...this.state.customPresets.map((preset) => preset.id),
    ];
    const currentIndex = ids.indexOf(this.state.preset);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % ids.length;
    const nextPreset: PresetRef = ids[nextIndex] ?? PRESET_IDS[0]!;
    this.set({
      preset: nextPreset,
    });
    if (this.state.modal !== null && this.state.modal.type === "preview") {
      await this.refreshStartPreviewModal(nextPreset);
    }
  };

  private refreshStartPreviewModal = async (preset: PresetRef): Promise<void> => {
    if (this.state.modal === null || this.state.modal.type !== "preview") return;
    const chosen = this.state.repos.filter((repo) => this.state.selected.has(repoKey(repo)));
    const config = await loadWorkspace(this.rootValue, preset);
    const orgs = [...this.state.selectedOrgs];
    const userLogin = this.userLoginValue ?? "";
    const entries: PreviewTreeEntry[] = chosen.map((repo) => {
      const internal = isInternalOwner(repo.owner, userLogin, orgs);
      const relPath = targetSegmentsForPreset(
        repo,
        preset,
        internal,
        this.state.customPresets,
      ).join("/");
      const tracked = config.repos.find(
        (item) =>
          item.owner.toLowerCase() === repo.owner.toLowerCase() &&
          item.name.toLowerCase() === repo.name.toLowerCase(),
      );
      return {
        key: repoKey(repo),
        relPath,
        exists: existsSync(path.join(this.rootValue, ...relPath.split("/"))),
        ...(tracked?.custom === true ? { custom: true } : {}),
      };
    });
    if (this.state.modal !== null && this.state.modal.type === "preview") {
      this.set({ modal: { type: "preview", entries } });
    }
  };

  moveCursor = (delta: number): void => {
    const total = this.state.filteredRepos.length;
    if (total === 0) return;
    const cursor = Math.min(Math.max(this.state.cursor + delta, 0), total - 1);
    this.set({ cursor });
  };

  setCursor = (index: number): void => {
    const total = this.state.filteredRepos.length;
    if (total === 0) return;
    const cursor = Math.min(Math.max(index, 0), total - 1);
    this.set({ cursor });
  };

  pageCursor = (delta: number, viewportRows: number): void => {
    const page = Math.max(1, viewportRows);
    this.moveCursor(delta * page);
  };

  moveStatusScroll = (delta: number): void => {
    const maxScroll = Math.max(0, this.state.statuses.length - STATUS_VIEW_ROWS);
    const statusScroll = Math.min(Math.max(this.state.statusScroll + delta, 0), maxScroll);
    if (statusScroll === this.state.statusScroll) return;
    this.set({ statusScroll });
  };

  moveSidebarCursor = (delta: number): void => {
    const rows = buildSidebarRows(this.state).length;
    if (rows === 0) return;
    const sidebarCursor = (this.state.sidebarCursor + delta + rows) % rows;
    this.set({ sidebarCursor });
  };

  setSidebarCursor = (index: number): void => {
    const total = buildSidebarRows(this.state).length;
    if (total === 0) return;
    const sidebarCursor = Math.min(Math.max(index, 0), total - 1);
    this.set({ sidebarCursor });
  };

  activateSidebarRow = (index?: number): void => {
    if (index !== undefined) {
      this.setSidebarCursor(index);
    }
    const rows = buildSidebarRows(this.state);
    const row = rows[this.state.sidebarCursor];
    if (row === undefined) return;
    if (row.kind === "org") {
      void this.toggleOrg(row.org);
      return;
    }
    if (row.kind === "preset") {
      this.cyclePreset();
      return;
    }
    if (row.kind === "filter") {
      this.setFilter(row.key, !row.checked);
    }
  };

  toggleCurrent = (): void => {
    const repo = this.state.filteredRepos[this.state.cursor];
    if (repo === undefined) return;
    const key = repoKey(repo);
    const selected = new Set(this.state.selected);
    if (selected.has(key)) {
      selected.delete(key);
    } else {
      selected.add(key);
    }
    this.set({ selected });
  };

  toggleRepoAt = (index: number): void => {
    const repo = this.state.filteredRepos[index];
    if (repo === undefined) return;
    const key = repoKey(repo);
    const selected = new Set(this.state.selected);
    if (selected.has(key)) {
      selected.delete(key);
    } else {
      selected.add(key);
    }
    this.set({ selected, cursor: index });
  };

  handleRepoRowClick = (index: number, key: string, relX?: number): void => {
    if (relX !== undefined && relX <= 6) {
      this.lastRepoClick = null;
      this.toggleRepoAt(index);
      return;
    }

    const now = Date.now();
    const isDouble =
      this.lastRepoClick !== null &&
      this.lastRepoClick.index === index &&
      now - this.lastRepoClick.time < 400;

    if (isDouble) {
      this.lastRepoClick = null;
      this.setCursor(index);
      this.openDetailModal(key);
      return;
    }
    this.lastRepoClick = { index, time: now };

    if (index !== this.state.cursor) {
      this.setCursor(index);
    } else {
      this.toggleCurrent();
    }
  };

  selectAll = (): void => {
    const keys = this.state.filteredRepos.map(repoKey);
    const selected = new Set(this.state.selected);
    const allSelected = keys.every((key) => selected.has(key));
    for (const key of keys) {
      if (allSelected) {
        selected.delete(key);
      } else {
        selected.add(key);
      }
    }
    this.set({ selected });
  };

  start = async (): Promise<void> => {
    if (this.state.running) return;
    const chosen = this.state.repos.filter((repo) => this.state.selected.has(repoKey(repo)));
    if (chosen.length === 0) {
      this.pushStatus("FAILED", "sync", "nothing selected");
      return;
    }
    const github = this.github;
    if (github === null) {
      this.pushStatus("FAILED", "sync", "not initialized");
      return;
    }
    this.set({ running: true });
    try {
      const config = await loadWorkspace(this.rootValue, this.state.preset);
      await this.deps.sync({
        root: this.rootValue,
        config,
        repos: chosen,
        userLogin: this.userLoginValue ?? "",
        orgs: [...this.state.selectedOrgs],
        token: this.token,
        emit: this.progressToStatus,
        customPresets: this.state.customPresets,
      });
      const updated = await loadWorkspace(this.rootValue);
      this.set({ lastSync: updated.lastSync, preset: updated.preset });
    } catch (error) {
      this.pushStatus("FAILED", "sync", firstErrorLine(error));
    } finally {
      this.set({ running: false });
    }
  };

  openStartPreview = async (): Promise<void> => {
    if (this.state.running) return;
    const chosen = this.state.repos.filter((repo) => this.state.selected.has(repoKey(repo)));
    if (chosen.length === 0) {
      this.pushStatus("FAILED", "sync", "nothing selected");
      return;
    }
    if (this.github === null) {
      this.pushStatus("FAILED", "sync", "not initialized");
      return;
    }
    const config = await loadWorkspace(this.rootValue, this.state.preset);
    const orgs = [...this.state.selectedOrgs];
    const userLogin = this.userLoginValue ?? "";
    const entries: PreviewTreeEntry[] = chosen.map((repo) => {
      const internal = isInternalOwner(repo.owner, userLogin, orgs);
      const relPath = targetSegmentsForPreset(
        repo,
        this.state.preset,
        internal,
        this.state.customPresets,
      ).join("/");
      const tracked = config.repos.find(
        (item) =>
          item.owner.toLowerCase() === repo.owner.toLowerCase() &&
          item.name.toLowerCase() === repo.name.toLowerCase(),
      );
      return {
        key: repoKey(repo),
        relPath,
        exists: existsSync(path.join(this.rootValue, ...relPath.split("/"))),
        ...(tracked?.custom === true ? { custom: true } : {}),
      };
    });
    this.openModal({ type: "preview", entries });
  };

  confirmStartPreview = async (): Promise<void> => {
    if (this.state.modal === null || this.state.modal.type !== "preview") return;
    this.closeModal();
    await this.start();
  };

  openModal = (modal: ModalState): void => {
    this.set({ modal, modalError: null });
  };

  setModal = (modal: ModalState): void => {
    this.set({ modal });
  };

  closeModal = (): void => {
    this.set({ modal: null, modalError: null, movePrefill: null });
  };

  setFocus = (focus: FocusRegion): void => {
    if (this.state.focus === focus) return;
    this.set({ focus });
  };

  cycleFocus = (): void => {
    const index = FOCUS_ORDER.indexOf(this.state.focus);
    this.set({ focus: FOCUS_ORDER[(index + 1) % FOCUS_ORDER.length]! });
  };

  runUpdateCheck = async (): Promise<void> => {
    try {
      const result = await this.deps.updater();
      if (
        !result.updateAvailable ||
        result.latestVersion === null ||
        result.latestVersion === this.dismissedVersionValue
      ) {
        return;
      }
      this.set({ updateToast: { version: result.latestVersion } });
    } catch (error) {
      /* update check is best-effort and must never disturb the session */
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

  openCloneModal = (): void => {
    this.openModal({ type: "clone" });
  };

  openOpenModal = async (key: string): Promise<void> => {
    // apps === null marks detection as pending so the modal can show
    // "detecting apps…" instead of flashing "no apps detected".
    this.openModal({ type: "open", key, apps: null });
    try {
      const apps = await this.deps.detectAppsFn({ env: process.env });
      if (this.state.modal?.type === "open") {
        this.set({ modal: { type: "open", key, apps } });
      }
    } catch (error) {
      if (this.state.modal?.type === "open") {
        this.set({ modal: { type: "open", key, apps: [] } });
      }
      this.set({ modalError: firstErrorLine(error) });
    }
  };

  currentAliasFor = async (key: string): Promise<string | null> => {
    const entry = await this.findTrackedEntry(key);
    if (entry === null) return null;
    const aliases = (await this.readConfigAliases()) ?? {};
    for (const [alias, target] of Object.entries(aliases)) {
      if (target.toLowerCase() === entry.relativePath.toLowerCase()) return alias;
    }
    return null;
  };

  private async readConfigAliases(): Promise<Record<string, string> | null> {
    try {
      const config = await loadWorkspace(this.rootValue);
      return config.aliases ?? null;
    } catch {
      return null;
    }
  }

  openAliasModal = async (key: string): Promise<void> => {
    const prefill = await this.currentAliasFor(key);
    this.openModal({ type: "alias", key, prefill: prefill ?? "" });
  };

  submitAlias = async (key: string, alias: string): Promise<boolean> => {
    const config = await loadWorkspace(this.rootValue);
    const result = setAlias(config, alias, key);
    if (!result.ok) {
      this.set({ modalError: result.message });
      return false;
    }
    await saveWorkspace(this.rootValue, result.config);
    this.closeModal();
    return true;
  };

  runOpenApp = async (appName: string): Promise<number> => {
    const modal = this.state.modal;
    if (modal === null || modal.type !== "open") return 1;
    const resolved = await this.deps.resolveAppFn(appName);
    if (resolved === null) {
      this.set({ modalError: `unknown app: ${appName}` });
      return 1;
    }
    const config = await loadWorkspace(this.rootValue);
    const options: { spawnImpl?: SpawnImpl } =
      this.deps.spawnImpl !== undefined ? { spawnImpl: this.deps.spawnImpl } : {};
    const result = await runAppInRepo(
      { root: this.rootValue, config, ref: modal.key, app: resolved, mode: "attached-resume" },
      options,
    );
    if (result.message !== undefined && !result.ok) {
      this.set({ modalError: result.message });
    }
    return result.code ?? 1;
  };

  openMoveModal = async (key: string): Promise<void> => {
    let prefill: string | null = null;
    try {
      const entry = await this.findTrackedEntry(key);
      prefill = entry?.relativePath ?? null;
    } catch {
      prefill = null;
    }
    this.set({ movePrefill: prefill });
    this.openModal({ type: "move", key });
  };

  private async findTrackedEntry(key: string): Promise<RepoInventoryEntry | null> {
    const config = await loadWorkspace(this.rootValue);
    const [owner, name, ...rest] = key.split("/");
    if (owner === undefined || name === undefined || rest.length > 0) return null;
    for (const item of config.repos) {
      if (
        item.owner.toLowerCase() === owner.toLowerCase() &&
        item.name.toLowerCase() === name.toLowerCase() &&
        typeof item.relativePath === "string"
      ) {
        return item;
      }
    }
    return null;
  }

  openWorkspacePicker = async (): Promise<void> => {
    this.openModal({ type: "workspaces", recordsPath: centralStorePath() });
    try {
      this.set({ workspaces: await this.deps.listWorkspacesFn() });
    } catch (error) {
      this.set({ workspaces: [] });
      this.pushStatus("FAILED", "workspaces", firstErrorLine(error));
    }
  };

  switchWorkspace = async (target: string): Promise<void> => {
    this.rootValue = target;
    this.set({ root: target });
    this.closeModal();
    this.personalRepos = [];
    this.orgReposCache.clear();
    await this.init();
  };

  openCreateModal = (): void => {
    this.openModal({
      type: "create",
      step: "name",
      draft: { name: "", path: "", isPrivate: true },
    });
  };

  openRootModal = async (): Promise<void> => {
    const effective = await effectiveRoot(process.env);
    this.openModal({
      type: "root",
      effective: effective.root,
      fromOverride: effective.fromOverride,
    });
  };

  submitRoot = async (input: string): Promise<boolean> => {
    const validated = validateRootInput(input, process.env);
    if (!validated.ok) {
      this.set({ modalError: validated.error });
      return false;
    }
    const settings = await readSettings(process.env);
    await writeSettings(process.env, { ...settings, defaultRoot: validated.root });
    const walked = await resolveWorkspaceRoot(process.cwd());
    const nextRoot = walked.found ? walked.root : validated.root;
    this.rootValue = nextRoot;
    const config = await loadWorkspace(nextRoot);
    this.set({
      root: nextRoot,
      preset: config.preset,
      customPresets: await readCustomPresets(),
      lastSync: config.lastSync,
    });
    this.closeModal();
    return true;
  };

  presetTargetFor = (name: string, org?: string): string => {
    const internal = org === undefined || org === this.userLoginValue;
    return targetSegmentsForPreset(
      {
        owner: org ?? this.userLoginValue ?? "",
        name,
        isArchived: false,
        isFork: false,
        language: null,
      },
      this.state.preset,
      internal,
      this.state.customPresets,
    ).join("/");
  };

  submitClone = async (url: string): Promise<boolean> => {
    const parsed = parseGitUrl(url);
    if (parsed === null) {
      this.set({
        modalError: "invalid GitHub repository URL (expected owner/repo or a github.com URL)",
      });
      return false;
    }
    if (this.state.running) return false;
    const github = this.github;
    if (github === null) {
      this.set({ modalError: "not initialized" });
      return false;
    }
    this.set({ running: true });
    try {
      await this.deps.cloneSingle(url, {
        root: this.rootValue,
        github,
        userLogin: this.userLoginValue ?? "",
        orgs: [...this.state.selectedOrgs],
        token: this.token,
        presetOverride: this.state.preset,
        emit: this.progressToStatus,
      });
      this.closeModal();
      return true;
    } catch (error) {
      this.set({ modalError: firstErrorLine(error) });
      return false;
    } finally {
      this.set({ running: false });
    }
  };

  submitMove = async (dest: string): Promise<boolean> => {
    const modal = this.state.modal;
    if (modal === null || modal.type !== "move") return false;
    if (validateMoveDestination(dest) === null) {
      this.set({ modalError: `invalid destination path: ${dest}` });
      return false;
    }
    this.set({ running: true });
    try {
      const config = await loadWorkspace(this.rootValue);
      const match = resolveRepoRef(config, modal.key);
      const result = await this.deps.move(this.rootValue, config, modal.key, dest, {
        emit: (message) => this.pushStatus("DONE", modal.key, message),
      });
      if (!result.ok) {
        this.set({ modalError: result.message });
        return false;
      }
      if (match !== null) {
        this.pushUndo({
          type: "move",
          key: modal.key,
          from: match.entry.relativePath,
          to: validateMoveDestination(dest)?.join("/") ?? dest,
          config,
        });
      }
      const updated = await loadWorkspace(this.rootValue);
      this.set({ lastSync: updated.lastSync });
      this.closeModal();
      return true;
    } catch (error) {
      this.set({ modalError: firstErrorLine(error) });
      return false;
    } finally {
      this.set({ running: false });
    }
  };

  submitCreate = async (draft: CreateDraft): Promise<boolean> => {
    const draftError = validateCreateDraft(draft);
    if (draftError !== null) {
      this.set({ modalError: draftError });
      return false;
    }
    const github = this.github;
    if (github === null) {
      this.set({ modalError: "not initialized" });
      return false;
    }
    this.set({ running: true });
    try {
      const config = await loadWorkspace(this.rootValue);
      const result = await this.deps.create({
        root: this.rootValue,
        config,
        github,
        token: this.token,
        userLogin: this.userLoginValue ?? "",
        orgs: [...this.state.selectedOrgs],
        options: {
          name: draft.name,
          isPrivate: draft.isPrivate,
          ...(draft.description !== undefined && draft.description.length > 0
            ? { description: draft.description }
            : {}),
          ...(draft.path.length > 0 ? { customPath: draft.path } : {}),
          ...(draft.fromDir !== undefined && draft.fromDir.length > 0
            ? { fromDir: draft.fromDir }
            : {}),
          ...(draft.org !== undefined && draft.org.length > 0 ? { org: draft.org } : {}),
        },
        emit: (message) => this.pushStatus("DONE", draft.name, message),
      });
      if (!result.ok) {
        this.set({ modalError: result.message });
        return false;
      }
      const updated = await loadWorkspace(this.rootValue);
      this.set({ lastSync: updated.lastSync });
      this.closeModal();
      return true;
    } catch (error) {
      this.set({ modalError: firstErrorLine(error) });
      return false;
    } finally {
      this.set({ running: false });
    }
  };
}

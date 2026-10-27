import type { CustomPreset, PresetRef } from "../../presets/index.ts";
import type { AuthInfo } from "../../services/auth.ts";
import type {
  CodeSearchMatch,
  CodeSearchResult,
  SearchCodeOptions,
} from "../../services/codeSearch.ts";
import type { EnvLike, RepotruckConfig } from "../../services/config.ts";
import type { createRepository } from "../../services/creator.ts";
import type { DoctorCheck } from "../../services/doctor.ts";
import type { CreateRepoOptions, GitHubRepoReader, RepoInfo } from "../../services/github.ts";
import type { DetailedGitStatus } from "../../services/gitState.ts";
import type { AppEntry, ResolvedApp, SpawnImpl } from "../../services/launcher.ts";
import type {
  archiveRepository,
  deleteRepository,
  forgetRepository,
} from "../../services/lifecycle.ts";
import type { moveRepository } from "../../services/mover.ts";
import type { ReorganizeResult, reorganizeWorkspace } from "../../services/reorganizer.ts";
import type { RunInReposOptions, RunInReposResult } from "../../services/runner.ts";
import type { cloneSingleRepository } from "../../services/singleCloner.ts";
import type { WorkspaceStatsOutput } from "../../services/stats.ts";
import type { UpdateCheckResult, UpdateState } from "../../services/updater.ts";
import type { SyncReposOptions, SyncReposResult } from "../../services/workspace.ts";
import type {
  listWorkspaces,
  removeWorkspace,
  WorkspaceListing,
} from "../../services/workspaceRegistry.ts";
import type { RepoWorktreeDetail } from "../../services/worktree.ts";
import type { ThemeName } from "../theme.ts";
import type { PreviewTreeEntry } from "../windowing.ts";

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

export type HealthFilter = "all" | "dirty" | "ahead" | "behind" | "pinned" | "local" | "uncloned";

export const HEALTH_FILTERS: readonly HealthFilter[] = [
  "all",
  "dirty",
  "ahead",
  "behind",
  "pinned",
  "local",
  "uncloned",
];

export type RightPaneTab = "activity" | "inspector" | "health";

export type OmnibarMode = "commands" | "symbols" | "github" | "runner";

export interface OmnibarCommandItem {
  id: string;
  label: string;
  category?: string;
  shortcut?: string;
  detail?: string;
  keywords?: string;
}

export type WorkspaceMaintenanceKind =
  | "scan"
  | "instructions"
  | "code-index"
  | "backup"
  | "trash-empty";

export type CreateStep = "name" | "source" | "org" | "path" | "description" | "visibility";

export interface CreateDraft {
  name: string;
  path: string;
  isPrivate: boolean;
  description?: string;
  fromDir?: string;
  org?: string;
}

export type SortKey = "default" | "name" | "language" | "updatedAt" | "stars" | "dirty";

export const SORT_CYCLE: readonly SortKey[] = ["default", "name", "language", "updatedAt"];

export interface RepoLocalHealth {
  tracked: boolean;
  relativePath: string | null;
  alias: string | null;
  pinned: boolean;
  custom: boolean;
  missing: boolean;
  dirty: boolean;
  ahead: number;
  behind: number;
  branch: string | null;
  worktree: boolean;
}

export interface InspectorState {
  key: string;
  loading: boolean;
  tracked: boolean;
  relativePath: string | null;
  alias: string | null;
  pinned: boolean;
  missing: boolean;
  worktree: boolean;
  details: DetailedGitStatus | null;
}

export interface HealthPanelData {
  loading: boolean;
  stats: WorkspaceStatsOutput | null;
  trashCount: number;
  trashBytes: number;
  checks: readonly DoctorCheck[];
}

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
  | { type: "confirmDelete"; key: string; absPath: string; keys?: readonly string[] }
  | { type: "confirmUntrack"; key: string; keys?: readonly string[] }
  | { type: "confirmArchive"; key: string; keys?: readonly string[] }
  | {
      type: "reorganize";
      target: PresetRef;
      keepCustom: boolean;
      preview: ReorganizeResult | null;
    }
  | {
      type: "worktree";
      key: string;
      worktrees: readonly RepoWorktreeDetail[];
      loading: boolean;
      error: string | null;
    }
  | {
      type: "omnibar";
      mode: OmnibarMode;
      query: string;
    };

export interface StoreSnapshot {
  phase: "loading" | "ready" | "error";
  errorMessage: string | null;
  offline: boolean;
  themeName: ThemeName;
  userLogin: string | null;
  authMethod: string | null;
  includePersonal: boolean;
  orgs: readonly string[];
  selectedOrgs: ReadonlySet<string>;
  repos: readonly RepoInfo[];
  filteredRepos: readonly RepoInfo[];
  filters: FiltersState;
  healthFilter: HealthFilter;
  localHealth: ReadonlyMap<string, RepoLocalHealth>;
  pinnedCount: number;
  sortKey: SortKey;
  sortDescending: boolean;
  search: string | null;
  selected: ReadonlySet<string>;
  statuses: readonly StatusEntry[];
  statusScroll: number;
  rightPaneTab: RightPaneTab;
  inspector: InspectorState | null;
  healthData: HealthPanelData | null;
  omnibarLoading: boolean;
  omnibarSymbols: readonly CodeSearchMatch[];
  omnibarGithubRepos: readonly RepoInfo[];
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
  archiveRepo?(owner: string, name: string): Promise<RepoInfo>;
  searchRepos?(query: string, limit: number): Promise<RepoInfo[]>;
}

export interface StoreDeps {
  auth?: () => Promise<AuthInfo>;
  github?: (token: string, baseUrl?: string) => GithubClient;
  cloneSingle?: typeof cloneSingleRepository;
  sync?: (options: SyncReposOptions) => Promise<SyncReposResult>;
  move?: typeof moveRepository;
  create?: typeof createRepository;
  forget?: typeof forgetRepository;
  deleteRepo?: typeof deleteRepository;
  archiveRepoFn?: typeof archiveRepository;
  reorganize?: typeof reorganizeWorkspace;
  searchCodeFn?: (options: SearchCodeOptions) => Promise<CodeSearchResult>;
  runInReposFn?: (options: RunInReposOptions) => Promise<RunInReposResult>;
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

export interface DeletedUndoItem {
  key: string;
  relativePath: string;
  trashPath: string;
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
      batch?: readonly DeletedUndoItem[];
    };

export const UNDO_STACK_CAP = 10;

export const STATUSES_CAP = 300;

export const STATUS_VIEW_ROWS = 12;

export const FOCUS_ORDER: readonly FocusRegion[] = ["sidebar", "list", "status"];

export type SidebarRow =
  | { kind: "personal"; label: string; checked: boolean }
  | { kind: "org"; org: string; label: string; checked: boolean }
  | { kind: "preset"; label: string; checked: false }
  | { kind: "filter"; key: keyof FiltersState; label: string; checked: boolean };

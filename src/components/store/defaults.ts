import { getAuthInfo } from "../../services/auth.ts";
import { searchCode } from "../../services/codeSearch.ts";
import { createRepository } from "../../services/creator.ts";
import { GitHubService } from "../../services/github.ts";
import { detectApps, resolveApp, type SpawnImpl } from "../../services/launcher.ts";
import { archiveRepository, deleteRepository, forgetRepository } from "../../services/lifecycle.ts";
import { moveDir, moveRepository } from "../../services/mover.ts";
import { reorganizeWorkspace } from "../../services/reorganizer.ts";
import { runInRepos } from "../../services/runner.ts";
import { cloneSingleRepository } from "../../services/singleCloner.ts";
import { checkForUpdate, readUpdateState, writeUpdateState } from "../../services/updater.ts";
import { syncRepos } from "../../services/workspace.ts";
import { listWorkspaces, removeWorkspace } from "../../services/workspaceRegistry.ts";
import { activeThemeName } from "../theme.ts";
import type { RepoLocalHealth, StoreDeps, StoreSnapshot } from "./types.ts";

export type ResolvedStoreDeps = Required<Omit<StoreDeps, "spawnImpl">> &
  Pick<StoreDeps, "spawnImpl">;

export function buildStoreDeps(deps: StoreDeps = {}): ResolvedStoreDeps {
  return {
    auth: deps.auth ?? (() => getAuthInfo(process.env)),
    github:
      deps.github ??
      ((token: string, baseUrl?: string) =>
        new GitHubService(token, baseUrl !== undefined ? { baseUrl } : {})),
    cloneSingle: deps.cloneSingle ?? cloneSingleRepository,
    sync: deps.sync ?? syncRepos,
    move: deps.move ?? moveRepository,
    create: deps.create ?? createRepository,
    forget: deps.forget ?? forgetRepository,
    deleteRepo: deps.deleteRepo ?? deleteRepository,
    archiveRepoFn: deps.archiveRepoFn ?? archiveRepository,
    moveDirImpl: deps.moveDirImpl ?? moveDir,
    reorganize: deps.reorganize ?? reorganizeWorkspace,
    searchCodeFn: deps.searchCodeFn ?? searchCode,
    runInReposFn: deps.runInReposFn ?? runInRepos,
    listWorkspacesFn: deps.listWorkspacesFn ?? listWorkspaces,
    removeWorkspaceFn: deps.removeWorkspaceFn ?? removeWorkspace,
    detectAppsFn: deps.detectAppsFn ?? ((options) => detectApps(options)),
    resolveAppFn: deps.resolveAppFn ?? ((name: string) => resolveApp(name, { env: process.env })),
    spawnImpl: deps.spawnImpl as SpawnImpl | undefined,
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
}

export function buildInitialSnapshot(root: string): StoreSnapshot {
  return {
    phase: "loading",
    errorMessage: null,
    offline: false,
    themeName: activeThemeName(),
    userLogin: null,
    authMethod: null,
    includePersonal: true,
    orgs: [],
    selectedOrgs: new Set<string>(),
    repos: [],
    filteredRepos: [],
    filters: { active: true, forks: true, archived: true },
    healthFilter: "all",
    localHealth: new Map<string, RepoLocalHealth>(),
    pinnedCount: 0,
    sortKey: "default",
    sortDescending: false,
    search: null,
    selected: new Set<string>(),
    statuses: [],
    statusScroll: 0,
    rightPaneTab: "activity",
    inspector: null,
    healthData: null,
    omnibarLoading: false,
    omnibarSymbols: [],
    omnibarGithubRepos: [],
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

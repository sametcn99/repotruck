import { AuthError } from "../../services/auth.ts";
import { firstErrorLine } from "../../services/cloner.ts";
import { memoizeRepoLookup } from "../../services/forkSource.ts";
import {
  DEFAULT_GITHUB_BASE_URL,
  readCustomPresets,
  resolveGithubBaseUrl,
} from "../../services/settings.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { isRegisteredWorkspace } from "../../services/workspaceRegistry.ts";
import { buildFastLocalHealthMap } from "./gitHealth.ts";
import { StoreBase } from "./StoreBase.ts";

export class StoreInitialization extends StoreBase {
  init = async (): Promise<void> => {
    const operation = this.operations.start("init");
    this.initialized = true;
    this.operations.cancel("project-star");
    this.set({
      phase: "loading",
      errorMessage: null,
      offline: false,
      projectStar: { status: "idle", message: null },
    });
    void this.runStartupUpdateCheck();
    if (process.env.REPOTRUCK_OFFLINE === "1") {
      await this.enterOfflineMode();
      return;
    }
    let hasWorkspace = false;
    try {
      const [customPresets, config] = await Promise.all([
        readCustomPresets(),
        loadWorkspace(operation.root),
      ]);
      const hasWorkspaceRepos = config.repos.length > 0;
      hasWorkspace = hasWorkspaceRepos || (await isRegisteredWorkspace(operation.root));
      const baseUrl = await resolveGithubBaseUrl(process.env);
      const auth = await this.deps.auth();
      if (!operation.current()) return;
      this.token = auth.token;
      const github = this.deps.github(
        auth.token,
        baseUrl !== DEFAULT_GITHUB_BASE_URL ? baseUrl : undefined,
      );
      this.github = github;
      this.lookupForkRepo = memoizeRepoLookup((owner, name) => github.getRepo(owner, name));
      const userLogin = await github.getUserLogin();
      const orgs = await github.getActiveOrgs();
      const personalRepos = await github.listUserRepos();
      if (!operation.current()) return;
      this.userLoginValue = userLogin;
      this.personalRepos = personalRepos;
      this.orgReposCache.clear();
      this.localConfig = config;
      const fast = buildFastLocalHealthMap(operation.root, config);
      const includePersonal = !hasWorkspaceRepos;
      const repos = this.composeRepos(new Set<string>(), includePersonal, false, true);
      this.set({
        phase: "ready",
        errorMessage: null,
        offline: false,
        authMethod: auth.method,
        userLogin,
        includeWorkspace: true,
        includePersonal,
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
        workspacePreset: config.preset,
        customPresets,
        profiles: config.profiles ?? {},
        lastSync: config.lastSync,
        cursor: 0,
        sortKey: "default",
        sortDescending: false,
        sidebarCursor: 0,
        healthFilter: "all",
        search: null,
      });
      this.scheduleHydrateGitHealth(config, fast.map);
    } catch (error) {
      if (!operation.current()) return;
      if (hasWorkspace) {
        await this.enterOfflineMode();
        this.pushStatus("FAILED", "[github]", firstErrorLine(error));
        return;
      }
      this.set({
        phase: "error",
        errorMessage: error instanceof AuthError ? error.message : firstErrorLine(error),
      });
    } finally {
      operation.finish();
    }
  };

  enterOfflineMode = async (): Promise<void> => {
    const operation = this.operations.start("offline-init");
    this.operations.cancel("project-star");
    this.set({
      projectStar: {
        status: "unavailable",
        message: "Sign in to GitHub and go online to give a star.",
      },
    });
    this.github = null;
    this.lookupForkRepo = undefined;
    this.token = null;
    this.userLoginValue = null;
    try {
      const [customPresets, config] = await Promise.all([
        readCustomPresets(),
        loadWorkspace(operation.root),
      ]);
      if (!operation.current()) return;
      this.localConfig = config;
      const fast = buildFastLocalHealthMap(operation.root, config);
      const repos = this.composeRepos(new Set<string>(), false, true, true);
      this.set({
        phase: "ready",
        errorMessage: null,
        offline: true,
        authMethod: "offline",
        userLogin: "local",
        includeWorkspace: true,
        includePersonal: false,
        orgs: [],
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
        workspacePreset: config.preset,
        customPresets,
        profiles: config.profiles ?? {},
        lastSync: config.lastSync,
        cursor: 0,
        sidebarCursor: 0,
        sortKey: "default",
        sortDescending: false,
        healthFilter: "all",
        search: null,
      });
      this.pushStatus("DONE", "[offline]", `loaded ${repos.length} local tracked repositories`);
      this.scheduleHydrateGitHealth(config, fast.map);
    } catch (error) {
      if (!operation.current()) return;
      this.set({ phase: "error", errorMessage: firstErrorLine(error) });
    } finally {
      operation.finish();
    }
  };
}

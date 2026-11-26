import { PRESET_IDS, type PresetRef } from "../../presets/index.ts";
import { createCloneLimiter, firstErrorLine } from "../../services/cloner.ts";
import { refreshCodeIndexIfPresent } from "../../services/codeSearch.ts";
import { filterReposByKey, parseFilterFlags } from "../../services/filters.ts";
import {
  autoGistsEnabled,
  GistService,
  gistSyncSummary,
  syncWorkspaceGists,
} from "../../services/gists.ts";
import type { RepoInfo } from "../../services/github.ts";
import { detachedSpawnImpl, launchAppInDirectory } from "../../services/launcher.ts";
import { readSettings, resolveSyncSettings } from "../../services/settings.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { repoKey } from "./filters.ts";
import { buildPreviewEntries, computeReorganizePreview } from "./modalWorkflows.ts";
import { StoreInsightsPages } from "./StoreInsightsPages.ts";

/**
 * Workspace & data page actions — Sync Center, Discover, Changelog,
 * Scan & Adopt, Worktrees, Stats, Trash & Backups and the Status Matrix —
 * split out of StoreCore for the file-size budget. Behavior is unchanged.
 */
export class StoreWorkspacePages extends StoreInsightsPages {
  hasGistSession = (): boolean => !this.state.offline && Boolean(this.github?.gists);

  gistService = (): GistService =>
    new GistService({
      root: this.rootValue,
      github: this.hasGistSession() ? this.github : null,
      token: this.token,
      login: this.userLoginValue,
      env: process.env,
    });

  openGistInApp = async (ref: string, appName: string): Promise<void> => {
    const directory = await this.gistService().localPath(ref);
    const app = await this.deps.resolveAppFn(appName);
    if (app === null) throw new Error("Editor or agent app not found");
    const code = await launchAppInDirectory(
      directory,
      app,
      this.deps.spawnImpl ?? detachedSpawnImpl,
    );
    if (code !== 0) throw new Error(`The app exited with code ${code}`);
  };

  private async syncRepoMetadata(repos: readonly RepoInfo[]): Promise<RepoInfo[]> {
    const github = this.github;
    if (this.state.offline || github === null) return [...repos];
    const known = new Set(
      [
        ...this.personalRepos,
        ...[...this.orgReposCache.values()].flat(),
        ...this.sessionAddedRepos.values(),
      ].map((repo) => repoKey(repo).toLowerCase()),
    );
    const limit = createCloneLimiter(4);
    return await Promise.all(
      repos.map((repo) => {
        if (known.has(repoKey(repo).toLowerCase())) return repo;
        return limit(async () => {
          try {
            return await github.getRepo(repo.owner, repo.name);
          } catch {
            return repo;
          }
        });
      }),
    );
  }

  // ---- Sync Center (t14) -------------------------------------------------------
  updateSyncCenter = (partial: Partial<import("./types.ts").SyncCenterState>): void => {
    const current = this.state.syncCenter ?? defaultSyncCenterState();
    this.set({ syncCenter: { ...current, ...partial } });
  };

  startSyncCenter = async (): Promise<void> => {
    const state = this.state.syncCenter ?? defaultSyncCenterState();
    if (state.running || this.taskLabel("sync-center") !== null) return;
    const operation = this.operations.start("sync-center");
    this.set({ syncCenter: { ...state, running: true } });
    this.beginTask("sync-center", "sync");
    this.pushStatus("PULLING", "[sync]", `started ${syncCenterCliLine(state)}`);
    try {
      const scope = state.scope;
      let chosen: RepoInfo[] = [];
      if (scope === "selection") {
        const keys = new Set([...this.state.selected].map((key) => key.toLowerCase()));
        chosen = this.state.repos.filter((repo) => keys.has(repoKey(repo).toLowerCase()));
      } else if (scope === "pinned") {
        const keys = new Set(
          [...this.state.localHealth]
            .filter(([, health]) => health.pinned)
            .map(([key]) => key.toLowerCase()),
        );
        chosen = this.composeRepos(new Set(), false, this.state.offline, true).filter((repo) =>
          keys.has(repoKey(repo).toLowerCase()),
        );
      } else if (scope.startsWith("org:")) {
        const org = scope.slice(4);
        if (this.github && !this.orgReposCache.has(org)) {
          const repos = await this.github.listOrgRepos(org);
          if (!operation.current()) return;
          this.orgReposCache.set(org, repos);
        }
        chosen = this.orgReposCache.get(org) ?? [];
      } else if (scope === "all") {
        for (const org of this.state.orgs) {
          if (!this.orgReposCache.has(org) && this.github) {
            const repos = await this.github.listOrgRepos(org);
            if (!operation.current()) return;
            this.orgReposCache.set(org, repos);
          }
        }
        chosen = this.composeRepos(new Set(this.state.orgs), true, this.state.offline, true);
      } else chosen = this.state.offline ? [] : this.personalRepos;
      chosen = filterReposByKey(
        chosen,
        parseFilterFlags(state.include),
        parseFilterFlags(state.exclude),
      );
      if (state.limit > 0) chosen = chosen.slice(0, state.limit);
      const includeGists = this.hasGistSession() && syncCenterIncludesGists(state);
      if (!chosen.length && !includeGists)
        throw new Error("nothing to sync (0 repositories in selection)");
      const config = await loadWorkspace(operation.root, this.state.preset);
      const repos = await this.syncRepoMetadata(chosen);
      if (!operation.current()) return;
      await this.deps.sync({
        root: operation.root,
        config,
        repos,
        getRepo: this.lookupForkRepo,
        userLogin: this.userLoginValue ?? "",
        orgs: this.state.orgs,
        token: this.token,
        emit: (progress) => {
          if (operation.current()) this.progressToStatus(progress);
        },
        customPresets: this.state.customPresets,
        concurrency: state.concurrency,
        ...(state.depth > 0 ? { depth: state.depth } : {}),
        blobless: state.blobless,
        stash: state.stash,
        divergence: state.divergence,
      });
      if (!operation.current()) return;
      const gists = includeGists
        ? await syncWorkspaceGists({
            root: operation.root,
            github: this.github,
            login: this.userLoginValue,
            token: this.token,
            concurrency: state.concurrency,
          })
        : undefined;
      if (!operation.current()) return;
      this.endTask(
        "sync-center",
        gists ? gistSyncSummary(gists) : `${syncCenterCliLine(state)} — done`,
        Boolean(gists?.failed),
      );
      await this.refreshLocalState();
    } catch (error) {
      if (operation.current()) this.endTask("sync-center", firstErrorLine(error), true);
    } finally {
      if (operation.current()) {
        this.endTask("sync-center");
        const current = this.state.syncCenter;
        if (current) this.set({ syncCenter: { ...current, running: false } });
      }
      operation.finish();
    }
  };

  stopSyncCenter = (): void => {
    if (this.taskLabel("sync-center") === null) return;
    // Git mutations are allowed to finish safely. Keep start locked until the
    // in-flight operation completes instead of pretending it was cancelled.
    this.pushStatus(
      "PULLING",
      "[sync]",
      "Waiting for the active sync to finish; another sync cannot start yet.",
    );
  };

  // ---- Discover (t16) ------------------------------------------------------------
  updateDiscoverPage = (partial: Partial<import("./types.ts").DiscoverPageState>): void => {
    const current = this.state.discoverPage ?? defaultDiscoverPageState();
    this.set({ discoverPage: { ...current, ...partial } });
  };

  discoverSearch = async (): Promise<void> => {
    const operation = this.workspaceOperation("discoverSearch");
    const { set: update, pushStatus } = operation;
    try {
      const state = this.state.discoverPage ?? defaultDiscoverPageState();
      if (state.query.trim().length === 0) return;
      update({ discoverPage: { ...state, loading: true } });
      try {
        if (this.github === null || this.github.searchRepos === undefined) {
          throw new Error("GitHub search unavailable (offline or not initialized)");
        }
        const repos = await this.github.searchRepos(state.query.trim(), state.limit);
        const guard = this.state.discoverPage;
        if (guard !== null)
          update({
            discoverPage: { ...guard, loading: false, results: repos, selected: new Set<string>() },
          });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushStatus("FAILED", "[discover]", message);
        const guard = this.state.discoverPage;
        if (guard !== null) update({ discoverPage: { ...guard, loading: false } });
      }
    } finally {
      operation.finish();
    }
  };

  discoverCloneSelected = async (): Promise<void> => {
    if (this.operations.has("discoverCloneSelected")) return;
    const operation = this.workspaceOperation("discoverCloneSelected");
    const { endTask } = operation;
    try {
      const state = this.state.discoverPage ?? defaultDiscoverPageState();
      const targets = state.results.filter((repo) =>
        state.selected.has(`${repo.owner}/${repo.name}`),
      );
      if (targets.length === 0) return;
      this.beginTask("discover-clone", "discover --clone");
      let synced = 0;
      let failed = 0;
      for (const repo of targets) {
        if (!operation.current()) return;
        try {
          if (this.github === null) throw new Error("not initialized");
          await this.deps.cloneSingle(`https://github.com/${repo.owner}/${repo.name}.git`, {
            root: operation.root,
            github: this.github,
            userLogin: this.userLoginValue ?? "",
            orgs: [...this.state.selectedOrgs],
            token: this.token,
            ...(state.depth > 0 ? { depth: state.depth } : {}),
            ...(state.blobless ? { blobless: true } : {}),
            emit: (progress) => {
              if (operation.current()) this.progressToStatus(progress);
            },
          });
          synced += 1;
        } catch {
          failed += 1;
        }
      }
      endTask(
        "discover-clone",
        `clone summary: ${synced} synced, ${targets.length - synced - failed} skipped, ${failed} failed`,
        failed > 0,
      );
      if (operation.current()) await this.refreshLocalState();
    } finally {
      operation.finish();
    }
  };

  openReorganizeModal = async (): Promise<void> => {
    if (this.state.running) return;
    const current = this.localConfig?.preset ?? this.state.preset;
    this.openModal({
      type: "reorganize",
      current,
      target: current,
      keepCustom: true,
      scan: this.localConfig?.repos.length === 0,
      preview: null,
    });
    await this.refreshReorganizePreview();
  };

  private refreshReorganizePreview = async () => {
    const modal = this.state.modal;
    if (modal?.type !== "reorganize") return;
    const preview = await computeReorganizePreview(
      this.rootValue,
      modal.target,
      modal.keepCustom,
      this.state.customPresets,
      this.deps.reorganize,
      modal.scan,
      this.lookupForkRepo,
    );
    if (this.state.modal === modal) this.setModal({ ...modal, preview });
  };

  setReorganizeTarget = async (target: PresetRef): Promise<void> => {
    if (this.state.modal?.type !== "reorganize") return;
    this.setModal({ ...this.state.modal, target, preview: null });
    await this.refreshReorganizePreview();
  };

  cycleReorganizeTarget = async (delta: number): Promise<void> => {
    if (this.state.modal?.type !== "reorganize") return;
    const ids = [...PRESET_IDS, ...this.state.customPresets.map((preset) => preset.id)];
    const index = Math.max(0, ids.indexOf(this.state.modal.target));
    await this.setReorganizeTarget(ids[(index + delta + ids.length) % ids.length]!);
  };

  toggleReorganizeKeepCustom = async (): Promise<void> => {
    if (this.state.modal?.type !== "reorganize") return;
    this.setModal({ ...this.state.modal, keepCustom: !this.state.modal.keepCustom, preview: null });
    await this.refreshReorganizePreview();
  };

  toggleReorganizeScan = async (): Promise<void> => {
    if (this.state.modal?.type !== "reorganize") return;
    this.setModal({ ...this.state.modal, scan: !this.state.modal.scan, preview: null });
    await this.refreshReorganizePreview();
  };

  confirmReorganize = async (): Promise<void> => {
    if (this.operations.has("confirmReorganize")) return;
    const operation = this.workspaceOperation("confirmReorganize");
    const { set: update, pushStatus } = operation;
    try {
      const modal = this.state.modal;
      if (modal?.type !== "reorganize" || modal.preview === null || this.state.running) return;
      if (modal.preview.failed.some((failure) => failure.key === "preview")) return;
      if (operation.current()) this.closeModal();
      update({ running: true });
      const root = operation.root;
      try {
        const result = await this.deps.reorganize(root, modal.target, {
          keepCustom: modal.keepCustom,
          customPresets: this.state.customPresets,
          scan: modal.scan,
          getRepo: this.lookupForkRepo,
        });
        pushStatus(
          "DONE",
          "[reorganize]",
          `${modal.target}: ${result.moved.length} moved, ${result.skipped.length} skipped, ${result.collisions.length} collisions, ${result.failed.length} failed`,
        );
        if (operation.root === root) if (operation.current()) await this.refreshLocalState();
      } catch (error) {
        pushStatus("FAILED", "[reorganize]", firstErrorLine(error));
      } finally {
        update({ running: false });
      }
    } finally {
      operation.finish();
    }
  };

  start = async (includeGists = this.hasGistSession()): Promise<void> => {
    if (this.operations.has("start")) return;
    const operation = this.workspaceOperation("start");
    const { set: update, pushStatus } = operation;
    try {
      if (this.state.running) return;
      const chosen = this.state.repos.filter((repo) => this.state.selected.has(repoKey(repo)));
      if (chosen.length === 0 && !includeGists)
        return pushStatus("FAILED", "sync", "nothing selected");
      if (this.github === null && !this.state.offline) {
        return pushStatus("FAILED", "sync", "not initialized");
      }
      update({ running: true });
      try {
        const syncCfg = resolveSyncSettings(await readSettings(process.env));
        const config = await loadWorkspace(operation.root, this.state.preset);
        const repos = await this.syncRepoMetadata(chosen);
        if (!operation.current()) return;
        await this.deps.sync({
          root: operation.root,
          config,
          repos,
          getRepo: this.lookupForkRepo,
          userLogin: this.userLoginValue ?? "",
          orgs: this.state.orgs,
          token: this.token,
          emit: (progress) => {
            if (operation.current()) this.progressToStatus(progress);
          },
          customPresets: this.state.customPresets,
          ...syncCfg,
        });
        if (!operation.current()) return;
        const gists = includeGists
          ? await syncWorkspaceGists({
              root: operation.root,
              github: this.github,
              login: this.userLoginValue,
              token: this.token,
              concurrency: syncCfg.concurrency,
            })
          : undefined;
        if (!operation.current()) return;
        if (gists) pushStatus(gists.failed ? "FAILED" : "DONE", "Gists", gistSyncSummary(gists));
        if (repos.length > 0)
          await refreshCodeIndexIfPresent(operation.root, await loadWorkspace(operation.root));
        if (operation.current()) await this.refreshLocalState();
      } catch (error) {
        pushStatus("FAILED", "sync", firstErrorLine(error));
      } finally {
        update({ running: false });
      }
    } finally {
      operation.finish();
    }
  };

  openStartPreview = async (): Promise<void> => {
    if (this.state.running) return;
    const chosen = this.state.repos.filter((repo) => this.state.selected.has(repoKey(repo)));
    const includeGists = this.hasGistSession();
    if (chosen.length === 0 && !includeGists)
      return this.pushStatus("FAILED", "sync", "nothing selected");
    if (this.github === null && !this.state.offline) {
      return this.pushStatus("FAILED", "sync", "not initialized");
    }
    this.openModal({ type: "preview", entries: [], includeGists });
    await this.refreshStartPreviewModal(this.state.preset);
  };

  togglePreviewGists = (): void => {
    const modal = this.state.modal;
    if (modal?.type === "preview" && this.hasGistSession()) {
      this.setModal({ ...modal, includeGists: !modal.includeGists });
    }
  };

  confirmStartPreview = async (): Promise<void> => {
    const modal = this.state.modal;
    if (modal?.type !== "preview") return;
    if (modal.entries.length === 0 && (this.state.selected.size > 0 || !modal.includeGists)) return;
    this.closeModal();
    await this.start(modal.includeGists);
  };

  protected refreshStartPreviewModal = async (preset: PresetRef): Promise<void> => {
    if (this.state.modal?.type !== "preview") return;
    const operation = this.operations.start("start-preview");
    this.setModal({ ...this.state.modal, entries: [] });
    const chosen = this.state.repos.filter((repo) => this.state.selected.has(repoKey(repo)));
    try {
      const entries = await buildPreviewEntries({
        root: operation.root,
        chosen,
        preset,
        getRepo: this.lookupForkRepo,
        orgs: this.state.orgs,
        userLogin: this.userLoginValue ?? "",
        customPresets: this.state.customPresets,
      });
      if (operation.current() && this.state.modal?.type === "preview") {
        this.setModal({ ...this.state.modal, entries });
      }
    } catch (error) {
      if (operation.current() && this.state.modal?.type === "preview")
        this.setModalError(firstErrorLine(error));
    } finally {
      operation.finish();
    }
  };
}

export function defaultSyncCenterState(): import("./types.ts").SyncCenterState {
  return {
    scope: "selection",
    limit: 0,
    concurrency: 3,
    depth: 0,
    blobless: false,
    stash: false,
    divergence: "fail",
    include: "",
    exclude: "",
    watchSeconds: 0,
    running: false,
  };
}
export function syncCenterIncludesGists(state: import("./types.ts").SyncCenterState): boolean {
  return (
    state.includeGists ??
    autoGistsEnabled({
      scope: state.scope,
      targeted: state.limit > 0 || Boolean(state.include.trim() || state.exclude.trim()),
    })
  );
}

export function syncCenterCliLine(state: import("./types.ts").SyncCenterState): string {
  const parts = ["repotruck sync"];
  if (state.scope !== "user") parts.push(`--scope ${state.scope}`);
  if (state.includeGists === false) parts.push("--no-gists");
  if (state.limit > 0) parts.push(`--limit ${state.limit}`);
  if (state.concurrency !== 3) parts.push(`-c ${state.concurrency}`);
  if (state.depth > 0) parts.push(`--depth ${state.depth}`);
  if (state.blobless) parts.push("--blobless");
  if (state.stash) parts.push("--stash");
  if (state.divergence !== "fail") parts.push(`--divergence ${state.divergence}`);
  for (const glob of state.include
    .split(",")
    .map((piece) => piece.trim())
    .filter(Boolean)) {
    parts.push(`--include ${glob}`);
  }
  for (const glob of state.exclude
    .split(",")
    .map((piece) => piece.trim())
    .filter(Boolean)) {
    parts.push(`--exclude ${glob}`);
  }
  if (state.watchSeconds > 0) parts.push(`--watch ${state.watchSeconds}`);
  return parts.join(" ");
}
export function defaultDiscoverPageState(): import("./types.ts").DiscoverPageState {
  return {
    query: "",
    limit: 20,
    depth: 0,
    blobless: false,
    loading: false,
    results: [],
    selected: new Set<string>(),
  };
}

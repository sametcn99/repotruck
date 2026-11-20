import { existsSync } from "node:fs";
import path from "node:path";
import type { PresetRef } from "../../presets/index.ts";
import { formatChangelogMarkdown, getWorkspaceChangelog } from "../../services/changelog.ts";
import { firstErrorLine } from "../../services/cloner.ts";
import { refreshCodeIndexIfPresent } from "../../services/codeSearch.ts";
import { computeWorkspaceHealthScore } from "../../services/healthScore.ts";
import { pruneWorkspace } from "../../services/lifecycle.ts";
import {
  adoptUnregisteredRepos,
  buildAdoptPlan,
  scanWorkspaceRepos,
} from "../../services/scanner.ts";
import { readSettings, resolveSyncSettings } from "../../services/settings.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { listRepoWorktrees } from "../../services/worktree.ts";
import { repoKey } from "./filters.ts";
import { loadWorkspaceHealthData } from "./gitHealth.ts";
import { buildPreviewEntries } from "./modalWorkflows.ts";
import { StoreCore } from "./StoreCore.ts";

/**
 * Workspace & data page actions — Sync Center, Discover, Changelog,
 * Scan & Adopt, Worktrees, Stats, Trash & Backups and the Status Matrix —
 * split out of StoreCore for the file-size budget. Behavior is unchanged.
 */
export class StoreWorkspacePages extends StoreCore {
  // ---- Sync Center (t14) -------------------------------------------------------
  updateSyncCenter = (partial: Partial<import("./types.ts").SyncCenterState>): void => {
    const current = this.state.syncCenter ?? defaultSyncCenterState();
    this.set({ syncCenter: { ...current, ...partial } });
  };

  startSyncCenter = async (): Promise<void> => {
    const state = this.state.syncCenter ?? defaultSyncCenterState();
    if (state.running) return;
    const scope = state.scope;
    let chosen: typeof this.state.repos = [];
    if (scope === "selection") {
      chosen = this.state.repos.filter((repo) =>
        [...this.state.selected].some(
          (key) => key.toLowerCase() === `${repo.owner}/${repo.name}`.toLowerCase(),
        ),
      );
    } else if (scope === "pinned") {
      const pinned = new Set(
        [...this.state.localHealth.entries()]
          .filter(([, h]) => h.pinned)
          .map(([k]) => k.toLowerCase()),
      );
      chosen = this.state.repos.filter((repo) =>
        pinned.has(`${repo.owner}/${repo.name}`.toLowerCase()),
      );
    } else if (scope.startsWith("org:")) {
      const org = scope.slice(4);
      if (this.github !== null && !this.orgReposCache.has(org)) {
        try {
          this.orgReposCache.set(org, await this.github.listOrgRepos(org));
        } catch {}
      }
      chosen = this.orgReposCache.get(org) ?? [];
    } else if (scope === "all") {
      chosen = this.state.repos;
      for (const org of this.state.orgs) {
        if (!this.orgReposCache.has(org) && this.github !== null) {
          try {
            this.orgReposCache.set(org, await this.github.listOrgRepos(org));
          } catch {}
        }
        chosen = [...chosen, ...(this.orgReposCache.get(org) ?? [])];
      }
    } else {
      chosen = this.state.repos.filter((repo) => repo.owner === (this.userLoginValue ?? ""));
    }
    const includeGlobs = state.include
      .split(",")
      .map((piece) => piece.trim())
      .filter(Boolean);
    const excludeGlobs = state.exclude
      .split(",")
      .map((piece) => piece.trim())
      .filter(Boolean);
    const globMatch = (key: string, glob: string): boolean => {
      if (glob.endsWith("/*")) return key.startsWith(glob.slice(0, -1));
      return key.toLowerCase() === glob.toLowerCase();
    };
    chosen = chosen.filter((repo) => {
      const key = `${repo.owner}/${repo.name}`;
      if (includeGlobs.length > 0 && !includeGlobs.some((glob) => globMatch(key, glob)))
        return false;
      return !excludeGlobs.some((glob) => globMatch(key, glob));
    });
    if (state.limit > 0) chosen = chosen.slice(0, state.limit);
    if (chosen.length === 0) {
      this.pushStatus("FAILED", "[sync]", "nothing to sync (0 repositories in selection)");
      return;
    }
    if (this.github === null && !this.state.offline) {
      this.pushStatus("FAILED", "[sync]", "not initialized");
      return;
    }
    this.set({ syncCenter: { ...state, running: true } });
    this.beginTask("sync-center", "sync");
    const cli = syncCenterCliLine(state);
    this.pushStatus("DONE", "[sync]", `started ${cli}`);
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
        concurrency: state.concurrency,
        ...(state.depth > 0 ? { depth: state.depth } : {}),
        blobless: state.blobless,
        stash: state.stash,
        divergence: state.divergence,
      });
      this.endTask("sync-center", `${cli} — done`);
      await this.refreshLocalState();
    } catch (error) {
      this.endTask("sync-center", firstErrorLine(error), true);
    } finally {
      const guard = this.state.syncCenter;
      if (guard !== null) this.set({ syncCenter: { ...guard, running: false } });
    }
  };

  stopSyncCenter = (): void => {
    if (this.taskLabel("sync-center") === null) return;
    this.cancelTask("sync-center");
    const guard = this.state.syncCenter;
    if (guard !== null) this.set({ syncCenter: { ...guard, running: false } });
  };

  // ---- Discover (t16) ------------------------------------------------------------
  updateDiscoverPage = (partial: Partial<import("./types.ts").DiscoverPageState>): void => {
    const current = this.state.discoverPage ?? defaultDiscoverPageState();
    this.set({ discoverPage: { ...current, ...partial } });
  };

  discoverSearch = async (): Promise<void> => {
    const state = this.state.discoverPage ?? defaultDiscoverPageState();
    if (state.query.trim().length === 0) return;
    this.set({ discoverPage: { ...state, loading: true } });
    try {
      if (this.github === null || this.github.searchRepos === undefined) {
        throw new Error("GitHub search unavailable (offline or not initialized)");
      }
      const repos = await this.github.searchRepos(state.query.trim(), state.limit);
      const guard = this.state.discoverPage;
      if (guard !== null)
        this.set({
          discoverPage: { ...guard, loading: false, results: repos, selected: new Set<string>() },
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushStatus("FAILED", "[discover]", message);
      const guard = this.state.discoverPage;
      if (guard !== null) this.set({ discoverPage: { ...guard, loading: false } });
    }
  };

  discoverCloneSelected = async (): Promise<void> => {
    const state = this.state.discoverPage ?? defaultDiscoverPageState();
    const targets = state.results.filter((repo) =>
      state.selected.has(`${repo.owner}/${repo.name}`),
    );
    if (targets.length === 0) return;
    this.beginTask("discover-clone", "discover --clone");
    let synced = 0;
    let failed = 0;
    for (const repo of targets) {
      try {
        if (this.github === null) throw new Error("not initialized");
        await this.deps.cloneSingle(`https://github.com/${repo.owner}/${repo.name}.git`, {
          root: this.rootValue,
          github: this.github,
          userLogin: this.userLoginValue ?? "",
          orgs: [...this.state.selectedOrgs],
          token: this.token,
          ...(state.depth > 0 ? { depth: state.depth } : {}),
          ...(state.blobless ? { blobless: true } : {}),
          emit: this.progressToStatus,
        });
        synced += 1;
      } catch {
        failed += 1;
      }
    }
    this.endTask(
      "discover-clone",
      `clone summary: ${synced} synced, ${targets.length - synced - failed} skipped, ${failed} failed`,
      failed > 0,
    );
    await this.refreshLocalState();
  };

  // ---- Changelog (t17) -------------------------------------------------------------
  generateChangelog = async (options: {
    since?: string;
    until?: string;
    author?: string;
    repoRef?: string;
  }): Promise<void> => {
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const changelogs = await getWorkspaceChangelog(this.rootValue, config, options);
      const since = options.since ?? "7 days ago";
      const markdown = formatChangelogMarkdown(changelogs, since);
      this.set({ changelogPage: { markdown } });
      this.pushStatus(
        "DONE",
        "[changelog]",
        `${changelogs.length} repos with commits since ${since}`,
      );
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[changelog]",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  // ---- Scan & adopt + prune (t17) ---------------------------------------------------
  scanAndAdopt = async (adopt: boolean): Promise<void> => {
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const result = await scanWorkspaceRepos(this.rootValue, config);
      if (!adopt) {
        const lines = result.unregistered.map(
          (repo) =>
            `${repo.owner}/${repo.name} · ${repo.relativePath}${repo.internal ? "" : " (external)"}`,
        );
        this.set({ scanPage: { unregistered: lines } });
        this.pushStatus(
          "DONE",
          "[scan]",
          `scanned ${result.allDiscovered.length} repositories (${result.tracked.length} tracked, ${result.unregistered.length} unregistered)`,
        );
        return;
      }
      const plans = buildAdoptPlan(
        this.rootValue,
        config,
        result.unregistered,
        this.state.customPresets,
      );
      const execution = await adoptUnregisteredRepos(this.rootValue, config, plans);
      this.pushStatus(
        execution.errors.length > 0 ? "FAILED" : "DONE",
        "[scan]",
        `adopted ${execution.adopted.length}, ${execution.errors.length} errors${execution.errors.length > 0 ? ` (${execution.errors[0]?.error})` : ""}`,
      );
      await this.refreshLocalState();
    } catch (error) {
      this.pushStatus("FAILED", "[scan]", error instanceof Error ? error.message : String(error));
    }
  };

  pruneWorkspaceConfirm = (): void => {
    this.confirmDialog(
      {
        title: "Prune repositories",
        message:
          "Untrack repositories GitHub answers 404 for? Unclear answers (network/permission) are kept and reported.",
        confirmLabel: "Prune",
        danger: true,
      },
      () => {
        void (async () => {
          try {
            const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
            if (this.github === null) throw new Error("not initialized");
            if (this.github === null) throw new Error("not initialized");
            const github = {
              getRepo: async (owner: string, name: string) => this.github!.getRepo(owner, name),
              archiveRepo: async (owner: string, name: string) => {
                if (this.github!.archiveRepo === undefined) throw new Error("archive unavailable");
                return await this.github!.archiveRepo(owner, name);
              },
            };
            const result = await pruneWorkspace(this.rootValue, config, github);
            this.pushStatus(result.ok ? "DONE" : "FAILED", "[prune]", result.message);
            await this.refreshLocalState();
          } catch (error) {
            this.pushStatus(
              "FAILED",
              "[prune]",
              error instanceof Error ? error.message : String(error),
            );
          }
        })();
      },
    );
  };

  // ---- Worktree scan (t18) -----------------------------------------------------------
  scanWorkspaceWorktrees = async (): Promise<void> => {
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const rows: { repo: string; branch: string | null; path: string }[] = [];
      for (const entry of config.repos) {
        const dir = path.join(this.rootValue, ...entry.relativePath.split("/"));
        if (!existsSync(dir)) continue;
        const worktrees = await listRepoWorktrees(dir);
        for (const worktree of worktrees) {
          if (worktree.isMain) continue;
          rows.push({
            repo: `${entry.owner}/${entry.name}`,
            branch: worktree.branch,
            path: worktree.path,
          });
        }
      }
      this.set({ worktreePage: { rows } });
      this.pushStatus(
        "DONE",
        "[worktree]",
        rows.length === 0
          ? "no linked worktrees discovered in workspace"
          : `${rows.length} linked worktree(s) discovered`,
      );
    } catch (error) {
      this.pushStatus(
        "FAILED",
        "[worktree]",
        error instanceof Error ? error.message : String(error),
      );
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

  start = async (): Promise<void> => {
    if (this.state.running) return;
    const chosen = this.state.repos.filter((repo) => this.state.selected.has(repoKey(repo)));
    if (chosen.length === 0) return this.pushStatus("FAILED", "sync", "nothing selected");
    if (this.github === null && !this.state.offline) {
      return this.pushStatus("FAILED", "sync", "not initialized");
    }
    this.set({ running: true });
    try {
      const syncCfg = resolveSyncSettings(await readSettings(process.env));
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
        ...syncCfg,
      });
      await refreshCodeIndexIfPresent(this.rootValue, await loadWorkspace(this.rootValue));
      await this.refreshLocalState();
    } catch (error) {
      this.pushStatus("FAILED", "sync", firstErrorLine(error));
    } finally {
      this.set({ running: false });
    }
  };

  openStartPreview = async (): Promise<void> => {
    if (this.state.running) return;
    const chosen = this.state.repos.filter((repo) => this.state.selected.has(repoKey(repo)));
    if (chosen.length === 0) return this.pushStatus("FAILED", "sync", "nothing selected");
    if (this.github === null && !this.state.offline) {
      return this.pushStatus("FAILED", "sync", "not initialized");
    }
    this.openModal({ type: "preview", entries: [] });
    await this.refreshStartPreviewModal(this.state.preset);
  };

  confirmStartPreview = async (): Promise<void> => {
    if (this.state.modal?.type !== "preview") return;
    this.closeModal();
    await this.start();
  };
  protected refreshStartPreviewModal = async (preset: PresetRef): Promise<void> => {
    if (this.state.modal?.type !== "preview") return;
    const chosen = this.state.repos.filter((repo) => this.state.selected.has(repoKey(repo)));
    const entries = await buildPreviewEntries({
      root: this.rootValue,
      chosen,
      preset,
      orgs: [...this.state.selectedOrgs],
      userLogin: this.userLoginValue ?? "",
      customPresets: this.state.customPresets,
    });
    if (this.state.modal?.type === "preview") this.set({ modal: { type: "preview", entries } });
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
export function syncCenterCliLine(state: import("./types.ts").SyncCenterState): string {
  const parts = ["repotruck sync"];
  if (state.scope !== "user") parts.push(`--scope ${state.scope}`);
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

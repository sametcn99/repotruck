import path from "node:path";
import { PRESET_IDS, type PresetRef, targetSegmentsForPreset } from "../../presets/index.ts";
import { firstErrorLine } from "../../services/cloner.ts";
import { refreshCodeIndexIfPresent } from "../../services/codeSearch.ts";
import { effectiveRoot, readSettings, resolveSyncSettings } from "../../services/settings.ts";
import { parseGitUrl } from "../../services/singleCloner.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { centralStorePath } from "../../services/workspaceRegistry.ts";
import { buildSidebarRows, repoKey } from "./filters.ts";
import {
  performArchiveRepos,
  performDeleteRepos,
  performTogglePin,
  performUntrackRepos,
} from "./lifecycleActions.ts";
import {
  buildPreviewEntries,
  computeReorganizePreview,
  executeOmnibarCommandById,
  findTrackedEntryInRoot,
  performCreateWorktree,
  performOpenWorktreeModal,
  performRemoveWorktree,
  performRunOpenApp,
  performSubmitAlias,
  performSubmitClone,
  performSubmitCreate,
  performSubmitMove,
  performSubmitRoot,
  resolveCurrentAliasFor,
} from "./modalWorkflows.ts";
import { routeMouseEvent } from "./mouse.ts";
import { StoreCore } from "./StoreCore.ts";
import type { CreateDraft, MouseCallbacks, MouseEventPayload } from "./types.ts";

export class Store extends StoreCore {
  handleMouse = (
    event: MouseEventPayload,
    width: number,
    height: number,
    callbacks?: MouseCallbacks,
  ): void => routeMouseEvent(this, event, width, height, callbacks);

  executeOmnibarCommand = (id: string): void => executeOmnibarCommandById(this, id);

  activateSidebarRow = (index?: number): void => {
    if (index !== undefined) this.setSidebarCursor(index);
    const row = buildSidebarRows(this.state)[this.state.sidebarCursor];
    if (row === undefined) return;
    if (row.kind === "personal") this.togglePersonal();
    else if (row.kind === "org") void this.toggleOrg(row.org);
    else if (row.kind === "preset") void this.cyclePreset();
    else if (row.kind === "filter") this.setFilter(row.key, !row.checked);
  };

  cyclePreset = async (): Promise<void> => {
    const nextPreset = this.nextPresetId();
    this.set({ preset: nextPreset });
    if (this.state.modal?.type === "preview") await this.refreshStartPreviewModal(nextPreset);
  };

  private refreshStartPreviewModal = async (preset: PresetRef): Promise<void> => {
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

  togglePinSelection = async (): Promise<void> => {
    const keys = this.activeTargetKeys(true);
    if (keys.length === 0) return;
    await performTogglePin(this.rootValue, keys, this.pushStatus);
    await this.refreshLocalState();
  };

  openUntrackConfirm = (key: string, keys?: readonly string[]): void => {
    this.openModal({
      type: "confirmUntrack",
      key,
      ...(keys !== undefined && keys.length > 1 ? { keys } : {}),
    });
  };

  openSelectionUntrackConfirm = (): void => {
    const keys = this.activeTargetKeys(true);
    if (keys.length > 0) this.openUntrackConfirm(keys[0]!, keys.length > 1 ? keys : undefined);
  };

  confirmUntrack = async (key: string, keys?: readonly string[]): Promise<void> => {
    this.closeModal();
    await performUntrackRepos(this.rootValue, keys ?? [key], this.deps.forget, this.pushStatus);
    await this.refreshLocalState();
  };

  untrackRepo = async (key: string): Promise<void> => {
    try {
      await performUntrackRepos(this.rootValue, [key], this.deps.forget, this.pushStatus);
      await this.refreshLocalState();
    } catch (error) {
      this.pushStatus("FAILED", "[tui]", firstErrorLine(error));
    }
  };

  openDeleteConfirm = async (key: string, keys?: readonly string[]): Promise<void> => {
    try {
      const entry = await findTrackedEntryInRoot(this.rootValue, key);
      if (entry === null) {
        this.pushStatus("FAILED", "[tui]", `not tracked by repotruck: ${key}`);
        return;
      }
      const absPath = path.join(this.rootValue, ...entry.relativePath.split("/"));
      this.openModal({
        type: "confirmDelete",
        key,
        absPath,
        ...(keys !== undefined && keys.length > 1 ? { keys } : {}),
      });
    } catch (error) {
      this.pushStatus("FAILED", "[tui]", firstErrorLine(error));
    }
  };

  openSelectionDeleteConfirm = async (): Promise<void> => {
    const keys = this.activeTargetKeys(true);
    if (keys.length > 0) await this.openDeleteConfirm(keys[0]!, keys.length > 1 ? keys : undefined);
  };

  confirmDelete = async (key: string, keys?: readonly string[]): Promise<boolean> => {
    this.closeModal();
    try {
      const ok = await performDeleteRepos(this.rootValue, keys ?? [key], this.deps.deleteRepo, {
        pushStatus: this.pushStatus,
        pushUndo: this.pushUndo,
      });
      await this.refreshLocalState();
      return ok;
    } catch (error) {
      this.pushStatus("FAILED", "[tui]", firstErrorLine(error));
      return false;
    }
  };

  openArchiveConfirm = (key: string, keys?: readonly string[]): void => {
    this.openModal({
      type: "confirmArchive",
      key,
      ...(keys !== undefined && keys.length > 1 ? { keys } : {}),
    });
  };

  openSelectionArchiveConfirm = (): void => {
    const keys = this.activeTargetKeys(true);
    if (keys.length > 0) this.openArchiveConfirm(keys[0]!, keys.length > 1 ? keys : undefined);
  };

  confirmArchive = async (key: string, keys?: readonly string[]): Promise<boolean> => {
    this.closeModal();
    try {
      const ok = await performArchiveRepos(
        this.rootValue,
        keys ?? [key],
        this.github,
        this.deps.archiveRepoFn,
        this.pushStatus,
      );
      await this.refreshLocalState();
      return ok;
    } catch (error) {
      this.pushStatus("FAILED", "[archive]", firstErrorLine(error));
      return false;
    }
  };

  openReorganizeModal = async (): Promise<void> => {
    const target = this.state.preset;
    this.openModal({ type: "reorganize", target, keepCustom: true, preview: null });
    await this.refreshReorganizePreview(target, true);
  };

  private refreshReorganizePreview = async (target: PresetRef, keepCustom: boolean) => {
    if (this.state.modal?.type !== "reorganize") return;
    const preview = await computeReorganizePreview(
      this.rootValue,
      target,
      keepCustom,
      this.state.customPresets,
      this.deps.reorganize,
    );
    if (this.state.modal?.type === "reorganize") this.setModal({ ...this.state.modal, preview });
  };

  setReorganizeTarget = async (target: PresetRef): Promise<void> => {
    if (this.state.modal?.type !== "reorganize") return;
    const { keepCustom } = this.state.modal;
    this.setModal({ ...this.state.modal, target, preview: null });
    await this.refreshReorganizePreview(target, keepCustom);
  };

  cycleReorganizeTarget = async (delta: number): Promise<void> => {
    if (this.state.modal?.type !== "reorganize") return;
    const ids = [...PRESET_IDS, ...this.state.customPresets.map((preset) => preset.id)];
    const index = Math.max(0, ids.indexOf(this.state.modal.target));
    await this.setReorganizeTarget(ids[(index + delta + ids.length) % ids.length]!);
  };

  toggleReorganizeKeepCustom = async (): Promise<void> => {
    if (this.state.modal?.type !== "reorganize") return;
    const next = !this.state.modal.keepCustom;
    const { target } = this.state.modal;
    this.setModal({ ...this.state.modal, keepCustom: next, preview: null });
    await this.refreshReorganizePreview(target, next);
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
      await this.refreshLocalState();
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

  openOpenModal = async (key: string): Promise<void> => {
    this.openModal({ type: "open", key, apps: null });
    try {
      const apps = await this.deps.detectAppsFn({ env: process.env });
      if (this.state.modal?.type === "open") this.set({ modal: { type: "open", key, apps } });
    } catch (error) {
      if (this.state.modal?.type === "open") this.set({ modal: { type: "open", key, apps: [] } });
      this.set({ modalError: firstErrorLine(error) });
    }
  };

  currentAliasFor = (key: string): Promise<string | null> =>
    resolveCurrentAliasFor(this.rootValue, key);

  openAliasModal = async (key: string): Promise<void> => {
    this.openModal({ type: "alias", key, prefill: (await this.currentAliasFor(key)) ?? "" });
  };

  submitAlias = async (key: string, alias: string): Promise<boolean> => {
    const res = await performSubmitAlias(this.rootValue, key, alias);
    if (!res.ok) {
      this.set({ modalError: res.error });
      return false;
    }
    await this.refreshLocalState();
    this.closeModal();
    return true;
  };

  openWorktreeModal = async (key: string): Promise<void> => {
    this.openModal({ type: "worktree", key, worktrees: [], loading: true, error: null });
    try {
      const worktrees = await performOpenWorktreeModal(this.rootValue, key);
      if (this.state.modal?.type === "worktree") {
        this.set({ modal: { type: "worktree", key, worktrees, loading: false, error: null } });
      }
    } catch (error) {
      if (this.state.modal?.type === "worktree") {
        this.set({
          modal: {
            type: "worktree",
            key,
            worktrees: [],
            loading: false,
            error: firstErrorLine(error),
          },
        });
      }
    }
  };

  createWorktree = async (
    key: string,
    branch: string,
    targetPath?: string,
    newBranch = false,
  ): Promise<{ ok: boolean; message: string }> => {
    const res = await performCreateWorktree(this.rootValue, key, branch, targetPath, newBranch);
    if (res.ok) {
      await this.openWorktreeModal(key);
      await this.refreshLocalState();
    }
    return res;
  };

  removeWorktree = async (
    key: string,
    targetPath: string,
    force = false,
  ): Promise<{ ok: boolean; message: string }> => {
    const res = await performRemoveWorktree(this.rootValue, key, targetPath, force);
    if (res.ok) {
      await this.openWorktreeModal(key);
      await this.refreshLocalState();
    }
    return res;
  };

  runOpenApp = async (appName: string): Promise<number> => {
    if (this.state.modal?.type !== "open") return 1;
    const res = await performRunOpenApp(this.rootValue, this.state.modal.key, appName, this.deps);
    if (res.error !== undefined) this.set({ modalError: res.error });
    return res.code;
  };

  openMoveModal = async (key: string): Promise<void> => {
    let prefill: string | null = null;
    try {
      prefill = (await findTrackedEntryInRoot(this.rootValue, key))?.relativePath ?? null;
    } catch {}
    this.set({ movePrefill: prefill });
    this.openModal({ type: "move", key });
  };

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
    this.sessionAddedRepos.clear();
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
    const res = await performSubmitRoot(input);
    if (!res.ok) {
      this.set({ modalError: res.error });
      return false;
    }
    this.rootValue = res.nextRoot;
    this.set({ root: res.nextRoot });
    await this.refreshLocalState();
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
    if (parseGitUrl(url) === null) {
      this.set({
        modalError: "invalid GitHub repository URL (expected owner/repo or a github.com URL)",
      });
      return false;
    }
    if (this.state.running) return false;
    if (this.github === null) {
      this.set({ modalError: "not initialized" });
      return false;
    }
    this.set({ running: true });
    try {
      const res = await performSubmitClone({
        url,
        running: false,
        github: this.github,
        root: this.rootValue,
        userLogin: this.userLoginValue ?? "",
        orgs: [...this.state.selectedOrgs],
        token: this.token,
        preset: this.state.preset,
        emit: this.progressToStatus,
        cloneSingle: this.deps.cloneSingle,
      });
      if (!res.ok) {
        if (res.error !== undefined) this.set({ modalError: res.error });
        return false;
      }
      if (res.repo !== undefined) {
        this.sessionAddedRepos.set(repoKey(res.repo).toLowerCase(), res.repo);
      }
      await this.refreshLocalState();
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
    this.set({ running: true });
    try {
      const res = await performSubmitMove({
        root: this.rootValue,
        key: modal.key,
        dest,
        move: this.deps.move,
        pushStatus: this.pushStatus,
        pushUndo: this.pushUndo,
      });
      if (!res.ok) {
        this.set({ modalError: res.error });
        return false;
      }
      await this.refreshLocalState();
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
    this.set({ running: true });
    try {
      const res = await performSubmitCreate({
        draft,
        github: this.github,
        root: this.rootValue,
        token: this.token,
        userLogin: this.userLoginValue ?? "",
        orgs: [...this.state.selectedOrgs],
        create: this.deps.create,
        now: this.deps.now,
        pushStatus: this.pushStatus,
      });
      if (!res.ok) {
        this.set({ modalError: res.error });
        return false;
      }
      this.sessionAddedRepos.set(repoKey(res.repo).toLowerCase(), res.repo);
      await this.refreshLocalState();
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

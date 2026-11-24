import path from "node:path";
import { targetSegmentsForPreset } from "../../presets/index.ts";
import { firstErrorLine } from "../../services/cloner.ts";
import { effectiveRoot, validateRootInput } from "../../services/settings.ts";
import { parseGitUrl } from "../../services/singleCloner.ts";
import { loadWorkspace, registerWorkspace } from "../../services/workspace.ts";
import { centralStorePath } from "../../services/workspaceRegistry.ts";
import { executeContextAction } from "./contextActions.ts";
import { buildSidebarRows, repoKey } from "./filters.ts";
import {
  performArchiveRepos,
  performDeleteRepos,
  performTogglePin,
  performUntrackRepos,
} from "./lifecycleActions.ts";
import {
  executeOmnibarCommandById,
  findTrackedEntryInRoot,
  performSubmitClone,
  performSubmitCreate,
  performSubmitMove,
  performSubmitRoot,
} from "./modalWorkflows.ts";
import { routeMouseEvent } from "./mouse.ts";
import { StoreModals } from "./StoreModals.ts";
import type { CreateDraft, MouseCallbacks, MouseEventPayload } from "./types.ts";

export class Store extends StoreModals {
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
    if (row.kind === "workspace") this.toggleWorkspace();
    else if (row.kind === "personal") this.togglePersonal();
    else if (row.kind === "org") void this.toggleOrg(row.org);
    else if (row.kind === "preset") void this.openReorganizeModal();
    else if (row.kind === "filter") this.setFilter(row.key, !row.checked);
  };

  cyclePreset = async (): Promise<void> => {
    const nextPreset = this.nextPresetId();
    this.set({ preset: nextPreset });
    if (this.state.modal?.type === "preview") await this.refreshStartPreviewModal(nextPreset);
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
    const operation = this.workspaceOperation("openDeleteConfirm");
    const { pushStatus } = operation;
    const openModal: typeof this.openModal = (modal) => {
      if (operation.current()) this.openModal(modal);
    };
    try {
      try {
        const entry = await findTrackedEntryInRoot(operation.root, key);
        if (entry === null) {
          pushStatus("FAILED", "[tui]", `not tracked by repotruck: ${key}`);
          return;
        }
        const absPath = path.join(operation.root, ...entry.relativePath.split("/"));
        openModal({
          type: "confirmDelete",
          key,
          absPath,
          ...(keys !== undefined && keys.length > 1 ? { keys } : {}),
        });
      } catch (error) {
        pushStatus("FAILED", "[tui]", firstErrorLine(error));
      }
    } finally {
      operation.finish();
    }
  };

  openSelectionDeleteConfirm = async (): Promise<void> => {
    const keys = this.activeTargetKeys(true);
    if (keys.length > 0) await this.openDeleteConfirm(keys[0]!, keys.length > 1 ? keys : undefined);
  };

  confirmPermanentDelete = async (key: string): Promise<void> => {
    if (this.operations.has("confirmPermanentDelete")) return;
    const operation = this.workspaceOperation("confirmPermanentDelete");
    const { pushStatus } = operation;
    try {
      if (operation.current()) this.closeModal();
      try {
        const config = await loadWorkspace(operation.root);
        await this.deps.deleteRepo(operation.root, config, key, { yes: true });
        pushStatus("DONE", "[delete]", `${key} permanently deleted (delete --yes)`);
        if (operation.current()) await this.refreshLocalState();
      } catch (error) {
        pushStatus("FAILED", "[delete]", firstErrorLine(error));
      }
    } finally {
      operation.finish();
    }
  };

  confirmDelete = async (key: string, keys?: readonly string[]): Promise<boolean> => {
    if (this.operations.has("confirmDelete")) return false;
    const operation = this.workspaceOperation("confirmDelete");
    const { pushStatus, pushUndo } = operation;
    try {
      if (operation.current()) this.closeModal();
      try {
        const ok = await performDeleteRepos(operation.root, keys ?? [key], this.deps.deleteRepo, {
          pushStatus: pushStatus,
          pushUndo: pushUndo,
        });
        if (operation.current()) await this.refreshLocalState();
        return ok;
      } catch (error) {
        pushStatus("FAILED", "[tui]", firstErrorLine(error));
        return false;
      }
    } finally {
      operation.finish();
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
    if (this.operations.has("confirmArchive")) return false;
    const operation = this.workspaceOperation("confirmArchive");
    const { pushStatus } = operation;
    try {
      if (operation.current()) this.closeModal();
      try {
        const ok = await performArchiveRepos(
          operation.root,
          keys ?? [key],
          this.github,
          this.deps.archiveRepoFn,
          pushStatus,
        );
        if (operation.current()) await this.refreshLocalState();
        return ok;
      } catch (error) {
        pushStatus("FAILED", "[archive]", firstErrorLine(error));
        return false;
      }
    } finally {
      operation.finish();
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

  openWorkspacePicker = async (): Promise<void> => {
    this.openModal({ type: "workspaces", recordsPath: centralStorePath() });
    try {
      this.set({ workspaces: await this.deps.listWorkspacesFn() });
    } catch (error) {
      this.set({ workspaces: [] });
      this.pushStatus("FAILED", "workspaces", firstErrorLine(error));
    }
  };

  openWorkspaceAdd = (): void => this.openModal({ type: "workspaceAdd" });

  submitWorkspaceAdd = async (input: string): Promise<void> => {
    const validated = validateRootInput(input);
    if (!validated.ok) return this.setModalError(validated.error);
    try {
      const config = await registerWorkspace(validated.root);
      await this.switchWorkspace(config.root);
    } catch (error) {
      this.setModalError(firstErrorLine(error));
    }
  };

  switchWorkspace = async (target: string): Promise<void> => {
    this.operations.invalidate();
    for (const task of this.activeTasks.values()) task.cancel?.();
    this.activeTasks.clear();
    this.rootValue = target;
    this.resolveDialog(false);
    this.github = null;
    this.lookupForkRepo = undefined;
    this.token = null;
    this.userLoginValue = null;
    this.set({
      root: target,
      phase: "loading",
      running: false,
      profiles: {},
      statuses: [],
      contextMenu: null,
      repos: [],
      filteredRepos: [],
      selected: new Set(),
      localHealth: new Map(),
      inspector: null,
      detailData: null,
      healthData: null,
      statsPage: null,
      changelogPage: null,
      scanPage: null,
      worktreePage: null,
      orgs: [],
      selectedOrgs: new Set(),
      activeTaskCount: 0,
      syncCenter: null,
      codeSearchPage: null,
      statusMatrix: null,
      discoverPage: null,
      runConsole: null,
      trashPage: null,
    });
    this.closeModal();
    this.personalRepos = [];
    this.orgReposCache.clear();
    this.sessionAddedRepos.clear();
    this.localConfig = null;
    this.undoStack = [];
    this.set({ canUndo: false });
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
    if (this.rootValue === res.nextRoot) this.closeModal();
    else await this.switchWorkspace(res.nextRoot);
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
    if (this.operations.has("submitClone")) return false;
    const operation = this.workspaceOperation("submitClone");
    const { set: update } = operation;
    try {
      if (parseGitUrl(url) === null) {
        update({
          modalError: "invalid GitHub repository URL (expected owner/repo or a github.com URL)",
        });
        return false;
      }
      if (this.state.running) return false;
      if (this.github === null) {
        update({ modalError: "not initialized" });
        return false;
      }
      update({ running: true });
      try {
        const res = await performSubmitClone({
          url,
          running: false,
          github: this.github,
          root: operation.root,
          userLogin: this.userLoginValue ?? "",
          orgs: [...this.state.selectedOrgs],
          token: this.token,
          preset: this.state.preset,
          emit: (progress) => {
            if (operation.current()) this.progressToStatus(progress);
          },
          cloneSingle: this.deps.cloneSingle,
        });
        if (!res.ok) {
          if (res.error !== undefined) update({ modalError: res.error });
          return false;
        }
        if (!operation.current()) return false;
        if (res.repo !== undefined) {
          this.sessionAddedRepos.set(repoKey(res.repo).toLowerCase(), res.repo);
        }
        if (operation.current()) await this.refreshLocalState();
        if (operation.current()) this.closeModal();
        return true;
      } catch (error) {
        update({ modalError: firstErrorLine(error) });
        return false;
      } finally {
        update({ running: false });
      }
    } finally {
      operation.finish();
    }
  };

  submitMove = async (dest: string): Promise<boolean> => {
    if (this.operations.has("submitMove")) return false;
    const operation = this.workspaceOperation("submitMove");
    const { set: update, pushStatus, pushUndo } = operation;
    try {
      const modal = this.state.modal;
      if (modal === null || modal.type !== "move") return false;
      update({ running: true });
      try {
        const res = await performSubmitMove({
          root: operation.root,
          key: modal.key,
          dest,
          move: this.deps.move,
          pushStatus: pushStatus,
          pushUndo: pushUndo,
        });
        if (!res.ok) {
          update({ modalError: res.error });
          return false;
        }
        if (operation.current()) await this.refreshLocalState();
        if (operation.current()) this.closeModal();
        return true;
      } catch (error) {
        update({ modalError: firstErrorLine(error) });
        return false;
      } finally {
        update({ running: false });
      }
    } finally {
      operation.finish();
    }
  };

  submitCreate = async (draft: CreateDraft): Promise<boolean> => {
    if (this.operations.has("submitCreate")) return false;
    const operation = this.workspaceOperation("submitCreate");
    const { set: update, pushStatus } = operation;
    try {
      update({ running: true });
      try {
        const res = await performSubmitCreate({
          draft,
          github: this.github,
          root: operation.root,
          token: this.token,
          userLogin: this.userLoginValue ?? "",
          orgs: [...this.state.selectedOrgs],
          create: this.deps.create,
          now: this.deps.now,
          pushStatus: pushStatus,
        });
        if (!res.ok) {
          update({ modalError: res.error });
          return false;
        }
        if (!operation.current()) return false;
        this.sessionAddedRepos.set(repoKey(res.repo).toLowerCase(), res.repo);
        if (operation.current()) await this.refreshLocalState();
        if (operation.current()) this.closeModal();
        return true;
      } catch (error) {
        update({ modalError: firstErrorLine(error) });
        return false;
      } finally {
        update({ running: false });
      }
    } finally {
      operation.finish();
    }
  };

  // ---- Repo context menu (t13) --------------------------------------------------
  openRepoContextMenu = (key: string): void => {
    this.set({ contextMenu: { key } });
  };

  closeRepoContextMenu = (): void => {
    if (this.state.contextMenu !== null) this.set({ contextMenu: null });
  };

  executeContextAction = (action: string): void => {
    const menu = this.state.contextMenu;
    this.closeRepoContextMenu();
    if (menu)
      executeContextAction(this, menu.key, action, (key) => this.set({ selected: new Set([key]) }));
  };
}

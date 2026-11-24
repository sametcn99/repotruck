import { firstErrorLine } from "../../services/cloner.ts";
import {
  findTrackedEntryInRoot,
  performCreateWorktree,
  performOpenWorktreeModal,
  performRemoveWorktree,
  performRunOpenApp,
  performSubmitAlias,
  resolveCurrentAliasFor,
} from "./modalWorkflows.ts";
import { StorePages } from "./StorePages.ts";

export class StoreModals extends StorePages {
  openOpenModal = async (key: string): Promise<void> => {
    const operation = this.workspaceOperation("openOpenModal");
    const { set: update } = operation;
    const openModal: typeof this.openModal = (modal) => {
      if (operation.current()) this.openModal(modal);
    };
    try {
      openModal({ type: "open", key, apps: null });
      try {
        const apps = await this.deps.detectAppsFn({ env: process.env });
        if (this.state.modal?.type === "open") update({ modal: { type: "open", key, apps } });
      } catch (error) {
        if (this.state.modal?.type === "open") update({ modal: { type: "open", key, apps: [] } });
        update({ modalError: firstErrorLine(error) });
      }
    } finally {
      operation.finish();
    }
  };

  currentAliasFor = (key: string): Promise<string | null> =>
    resolveCurrentAliasFor(this.rootValue, key);

  openAliasModal = async (key: string): Promise<void> => {
    const operation = this.workspaceOperation("openAliasModal");
    const openModal: typeof this.openModal = (modal) => {
      if (operation.current()) this.openModal(modal);
    };
    try {
      openModal({ type: "alias", key, prefill: (await this.currentAliasFor(key)) ?? "" });
    } finally {
      operation.finish();
    }
  };

  submitAlias = async (key: string, alias: string): Promise<boolean> => {
    if (this.operations.has("submitAlias")) return false;
    const operation = this.workspaceOperation("submitAlias");
    const { set: update } = operation;
    try {
      const res = await performSubmitAlias(operation.root, key, alias);
      if (!res.ok) {
        update({ modalError: res.error });
        return false;
      }
      if (operation.current()) await this.refreshLocalState();
      if (operation.current()) this.closeModal();
      return true;
    } finally {
      operation.finish();
    }
  };

  openWorktreeModal = async (key: string): Promise<void> => {
    const operation = this.workspaceOperation("openWorktreeModal");
    const { set: update } = operation;
    const openModal: typeof this.openModal = (modal) => {
      if (operation.current()) this.openModal(modal);
    };
    try {
      const pending = { type: "worktree", key, worktrees: [], loading: true, error: null } as const;
      openModal(pending);
      try {
        const worktrees = await performOpenWorktreeModal(operation.root, key);
        if (this.state.modal === pending) {
          update({ modal: { type: "worktree", key, worktrees, loading: false, error: null } });
        }
      } catch (error) {
        if (this.state.modal === pending) {
          update({
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
    } finally {
      operation.finish();
    }
  };

  createWorktree = async (
    key: string,
    branch: string,
    targetPath?: string,
    newBranch = false,
  ): Promise<{ ok: boolean; message: string }> => {
    if (this.operations.has("createWorktree"))
      return { ok: false, message: "operation already running" };
    const operation = this.workspaceOperation("createWorktree");
    try {
      const modal = this.state.modal;
      const res = await performCreateWorktree(operation.root, key, branch, targetPath, newBranch);
      if (res.ok) {
        if (modal?.type === "worktree" && this.state.modal === modal) {
          await this.openWorktreeModal(key);
        }
        if (operation.current()) await this.refreshLocalState();
      }
      return res;
    } finally {
      operation.finish();
    }
  };

  removeWorktree = async (
    key: string,
    targetPath: string,
    force = false,
  ): Promise<{ ok: boolean; message: string }> => {
    if (this.operations.has("removeWorktree"))
      return { ok: false, message: "operation already running" };
    const operation = this.workspaceOperation("removeWorktree");
    try {
      const modal = this.state.modal;
      const res = await performRemoveWorktree(operation.root, key, targetPath, force);
      if (res.ok) {
        if (modal?.type === "worktree" && this.state.modal === modal) {
          await this.openWorktreeModal(key);
        }
        if (operation.current()) await this.refreshLocalState();
      }
      return res;
    } finally {
      operation.finish();
    }
  };

  runOpenApp = async (appName: string): Promise<number> => {
    if (this.state.modal?.type !== "open") return 1;
    const root = this.rootValue,
      key = this.state.modal.key;
    this.closeModal();
    const res = await performRunOpenApp(root, key, appName, this.deps);
    if (root !== this.rootValue) return res.code;
    if (res.error !== undefined) this.set({ modalError: res.error });
    return res.code;
  };

  openMoveModal = async (key: string): Promise<void> => {
    const operation = this.workspaceOperation("openMoveModal");
    const { set: update } = operation;
    const openModal: typeof this.openModal = (modal) => {
      if (operation.current()) this.openModal(modal);
    };
    try {
      let prefill: string | null = null;
      try {
        prefill = (await findTrackedEntryInRoot(operation.root, key))?.relativePath ?? null;
      } catch {}
      update({ movePrefill: prefill });
      openModal({ type: "move", key });
    } finally {
      operation.finish();
    }
  };
}

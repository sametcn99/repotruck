import { listWorkspaceSnapshots } from "../../services/backups.ts";
import { runDoctor } from "../../services/doctor.ts";
import { listTrashEntries } from "../../services/trash.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { performDoctorFixAction } from "./lifecycleActions.ts";
import { StoreWorkspacePages } from "./StoreWorkspacePages.ts";
import type { WorkspaceMaintenanceKind } from "./types.ts";

/**
 * Data page actions — Trash & Backups, the Status Matrix and workspace
 * maintenance — continuing the store class chain for the file-size budget.
 */
export class StoreDataPages extends StoreWorkspacePages {
  // ---- Trash & Backups page (t09) -------------------------------------------
  refreshTrashPage = async (): Promise<void> => {
    const operation = this.workspaceOperation("refreshTrashPage");
    const { set: update } = operation;
    try {
      try {
        const [trash, backups] = await Promise.all([
          listTrashEntries(operation.root),
          listWorkspaceSnapshots(operation.root),
        ]);
        update({ trashPage: { trash, backups } });
      } catch {
        update({ trashPage: { trash: [], backups: [] } });
      }
    } finally {
      operation.finish();
    }
  };

  trashRestoreEntry = async (id: string): Promise<void> => {
    if (this.operations.has("trashRestoreEntry")) return;
    const operation = this.workspaceOperation("trashRestoreEntry");
    const { pushStatus } = operation;
    try {
      try {
        const config = this.localConfig ?? (await loadWorkspace(operation.root));
        if (!operation.current()) return;
        this.localConfig = config;
        const result = await this.deps.restoreTrashFn(operation.root, id);
        pushStatus(result.ok ? "DONE" : "FAILED", "[trash]", result.message);
        if (operation.current()) await this.refreshLocalState();
        if (operation.current()) await this.refreshTrashPage();
      } catch (error) {
        pushStatus("FAILED", "[trash]", error instanceof Error ? error.message : String(error));
      }
    } finally {
      operation.finish();
    }
  };

  trashEmptyConfirm = (olderThanDays?: number): void => {
    const root = this.rootValue;
    const keep =
      olderThanDays !== undefined && olderThanDays > 0 ? ` --older-than ${olderThanDays}` : "";
    this.confirmDialog(
      {
        title: "Empty trash",
        message: `Permanently remove trashed directories? (trash empty --yes${keep})`,
        confirmLabel: "Empty",
        danger: true,
      },
      () => {
        if (this.rootValue !== root) return;
        void this.runWorkspaceMaintenance("trash-empty", { olderThanDays });
      },
    );
  };

  backupSnapshotNow = async (): Promise<void> => {
    if (this.operations.has("backupSnapshotNow")) return;
    const operation = this.workspaceOperation("backupSnapshotNow");
    try {
      await this.runWorkspaceMaintenance("backup");
      if (operation.current()) await this.refreshTrashPage();
    } finally {
      operation.finish();
    }
  };

  backupRestoreConfirm = (file: string): void => {
    const root = this.rootValue;
    this.confirmDialog(
      {
        title: "Restore snapshot",
        message: `Restore ${file}? This replaces the current workspace inventory.`,
        confirmLabel: "Restore",
        danger: true,
      },
      () => {
        if (this.rootValue === root) void this.restoreBackupSnapshot(file);
      },
    );
  };

  restoreBackupSnapshot = async (file: string): Promise<void> => {
    if (this.operations.has("restoreBackupSnapshot")) return;
    const operation = this.workspaceOperation("restoreBackupSnapshot");
    try {
      const result = await this.deps.restoreSnapshotFn(operation.root, file, process.env);
      operation.pushStatus(result.ok ? "DONE" : "FAILED", "[backup]", result.message);
      if (operation.current()) await this.refreshLocalState();
      if (operation.current()) await this.refreshTrashPage();
    } catch (error) {
      operation.pushStatus(
        "FAILED",
        "[backup]",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      operation.finish();
    }
  };

  refreshStatusMatrix = async (remote?: boolean): Promise<void> => {
    const operation = this.workspaceOperation("refreshStatusMatrix");
    const { set: update, pushStatus } = operation;
    try {
      const wantRemote = remote ?? this.state.statusMatrix?.remote ?? false;
      update({
        statusMatrix: {
          loading: true,
          remote: wantRemote,
          lastSync: this.state.statusMatrix?.lastSync ?? null,
          repos: this.state.statusMatrix?.repos ?? [],
        },
      });
      try {
        const config = this.localConfig ?? (await loadWorkspace(operation.root));
        if (!operation.current()) return;
        this.localConfig = config;
        const client = this.github;
        const github =
          wantRemote && client !== null && client.getRepoRemoteHealth !== undefined
            ? {
                getRepoRemoteHealth: (owner: string, name: string) =>
                  client.getRepoRemoteHealth!(owner, name),
              }
            : undefined;
        const result = await this.deps.workspaceStatusFn(operation.root, config, {
          detail: true,
          remote: wantRemote,
          ...(github !== undefined ? { github } : {}),
        });
        update({
          statusMatrix: {
            loading: false,
            remote: wantRemote,
            lastSync: result.lastSync,
            repos: result.repos,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushStatus("FAILED", "[status]", message);
        update({
          statusMatrix: { loading: false, remote: wantRemote, lastSync: null, repos: [] },
        });
      }
    } finally {
      operation.finish();
    }
  };

  runHealthDoctorFix = async (): Promise<void> => {
    const root = this.rootValue;
    const { checks } = await runDoctor({ workspaceRoot: root });
    const fixes = checks.flatMap((check) => (check.inventoryFix ? [check.inventoryFix] : []));
    const runFix = async () => {
      if (this.rootValue !== root) return;
      await performDoctorFixAction(this.pushStatus, root, fixes);
      await this.refreshLocalState();
      await this.refreshHealthTab();
    };
    if (fixes.length === 0) return await runFix();
    if (this.rootValue !== root) return;
    this.confirmDialog(
      {
        title: "Apply Doctor inventory fixes?",
        message: `${fixes.length} proposed inventory changes in ${root}. Doctor registers, relinks or removes records in the inventory.`,
        confirmLabel: "Apply fixes",
      },
      () => void runFix(),
    );
  };

  runWorkspaceMaintenance = async (
    kind: WorkspaceMaintenanceKind,
    options: { olderThanDays?: number } = {},
  ): Promise<void> => {
    const key = `maintenance:${kind}`;
    if (this.operations.has(key)) return;
    const operation = this.workspaceOperation(key);
    try {
      await this.deps.maintenanceFn(operation.root, kind, operation.pushStatus, options);
      if (operation.current()) await this.refreshLocalState();
      if (operation.current()) await this.refreshTrashPage();
    } catch (error) {
      operation.pushStatus(
        "FAILED",
        `[${kind}]`,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      operation.finish();
    }
  };
}

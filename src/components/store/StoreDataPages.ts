import { listWorkspaceSnapshots } from "../../services/backups.ts";
import { runDoctor } from "../../services/doctor.ts";
import { listTrashEntries, restoreTrashEntry } from "../../services/trash.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { restoreWorkspaceSnapshot } from "../../services/workspaceRegistry.ts";
import { performDoctorFixAction, performWorkspaceMaintenanceAction } from "./lifecycleActions.ts";
import { StoreWorkspacePages } from "./StoreWorkspacePages.ts";
import type { WorkspaceMaintenanceKind } from "./types.ts";

/**
 * Data page actions — Trash & Backups, the Status Matrix and workspace
 * maintenance — continuing the store class chain for the file-size budget.
 */
export class StoreDataPages extends StoreWorkspacePages {
  // ---- Trash & Backups page (t09) -------------------------------------------
  refreshTrashPage = async (): Promise<void> => {
    try {
      const [trash, backups] = await Promise.all([
        listTrashEntries(this.rootValue),
        listWorkspaceSnapshots(this.rootValue),
      ]);
      this.set({ trashPage: { trash, backups } });
    } catch {
      this.set({ trashPage: { trash: [], backups: [] } });
    }
  };

  trashRestoreEntry = async (id: string): Promise<void> => {
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const result = await restoreTrashEntry(this.rootValue, id);
      this.pushStatus("DONE", "[trash]", result.message);
      await this.refreshLocalState();
      await this.refreshTrashPage();
    } catch (error) {
      this.pushStatus("FAILED", "[trash]", error instanceof Error ? error.message : String(error));
    }
  };

  trashEmptyConfirm = (olderThanDays?: number): void => {
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
        void this.runWorkspaceMaintenance("trash-empty");
        void this.refreshTrashPage();
      },
    );
  };

  backupSnapshotNow = async (): Promise<void> => {
    await this.runWorkspaceMaintenance("backup");
    await this.refreshTrashPage();
  };

  backupRestoreConfirm = (file: string): void => {
    this.confirmDialog(
      {
        title: "Restore snapshot",
        message: `Restore ${file}? This replaces the current workspace inventory.`,
        confirmLabel: "Restore",
        danger: true,
      },
      () => {
        void (async () => {
          try {
            await restoreWorkspaceSnapshot(this.rootValue, file, process.env);
            this.pushStatus("DONE", "[backup]", `inventory restored from ${file}`);
            await this.refreshLocalState();
            await this.refreshTrashPage();
          } catch (error) {
            this.pushStatus(
              "FAILED",
              "[backup]",
              error instanceof Error ? error.message : String(error),
            );
          }
        })();
      },
    );
  };

  refreshStatusMatrix = async (remote?: boolean): Promise<void> => {
    const wantRemote = remote ?? this.state.statusMatrix?.remote ?? false;
    this.set({
      statusMatrix: {
        loading: true,
        remote: wantRemote,
        lastSync: this.state.statusMatrix?.lastSync ?? null,
        repos: this.state.statusMatrix?.repos ?? [],
      },
    });
    try {
      const config = this.localConfig ?? (await loadWorkspace(this.rootValue));
      this.localConfig = config;
      const github =
        wantRemote && this.github !== null && this.github.getRepoRemoteHealth !== undefined
          ? {
              getRepoRemoteHealth: (owner: string, name: string) =>
                this.github!.getRepoRemoteHealth!(owner, name),
            }
          : undefined;
      const result = await this.deps.workspaceStatusFn(this.rootValue, config, {
        detail: true,
        remote: wantRemote,
        ...(github !== undefined ? { github } : {}),
      });
      this.set({
        statusMatrix: {
          loading: false,
          remote: wantRemote,
          lastSync: result.lastSync,
          repos: result.repos,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pushStatus("FAILED", "[status]", message);
      this.set({
        statusMatrix: { loading: false, remote: wantRemote, lastSync: null, repos: [] },
      });
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

  runWorkspaceMaintenance = async (kind: WorkspaceMaintenanceKind): Promise<void> => {
    await performWorkspaceMaintenanceAction(this.rootValue, kind, this.pushStatus);
    await this.refreshLocalState();
  };
}

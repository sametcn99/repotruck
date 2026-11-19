import { useKeyboard } from "@opentui/react";
import { useEffect, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";

/**
 * `repotruck trash …` and `repotruck backup …` as one recovery page: trashed
 * repositories with restore, empty with an older-than filter, and the
 * snapshot generations with confirm-guarded restore.
 */
export function TrashBackupsView({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const page = snapshot.trashPage;

  useEffect(() => {
    if (page === null) void store.refreshTrashPage();
  }, [page, store]);

  useKeyboard((key) => {
    if (key.name === "r") void store.refreshTrashPage();
    else if (key.name === "b") void store.backupSnapshotNow();
  });

  const half = Math.max(30, Math.floor((width - 4) / 2));
  const trash = page?.trash ?? [];
  const backups = page?.backups ?? [];

  return (
    <box flexDirection="column" flexGrow={1} width="100%" gap={1}>
      <box flexDirection="row" flexGrow={1} gap={1}>
        <box border borderColor={theme.border()} flexDirection="column" width={half} padding={0}>
          <text fg={theme.accent()}>{" Trash · .repotruck/trash"}</text>
          {trash.length === 0 ? (
            <text fg={theme.dim()}>{"  trash is empty"}</text>
          ) : (
            trash.map((entry) => (
              <box key={entry.id} flexDirection="column">
                <text fg={theme.normal()} wrapMode="none">
                  {` ${entry.owner}/${entry.name} · ${formatSize(entry.sizeBytes)} · ${entry.trashedAt.slice(0, 10)}`}
                </text>
                <box flexDirection="row" gap={2}>
                  <text
                    fg={theme.accent()}
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      store.confirmDialog(
                        {
                          title: "Restore",
                          message: `Restore ${entry.owner}/${entry.name} to its original path? (trash restore)`,
                          confirmLabel: "Restore",
                        },
                        () => {
                          void store.trashRestoreEntry(entry.id);
                        },
                      );
                    }}
                  >
                    {"  [restore]"}
                  </text>
                  <text fg={theme.dim()} wrapMode="none">
                    {entry.id}
                  </text>
                </box>
              </box>
            ))
          )}
          <text
            fg={theme.error()}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              store.trashEmptyConfirm();
            }}
          >
            {" [E] empty trash --yes"}
          </text>
        </box>
        <box border borderColor={theme.border()} flexDirection="column" width={half} padding={0}>
          <text fg={theme.accent()}>{" Backups · 5 generations"}</text>
          {backups.length === 0 ? (
            <text fg={theme.dim()}>{"  no snapshots yet (written on every workspace change)"}</text>
          ) : (
            backups.map((entry) => (
              <box key={entry.file} flexDirection="column">
                <text fg={theme.normal()} wrapMode="none">
                  {` ${entry.createdAt.slice(0, 19).replace("T", " ")} · ${entry.repoCount} repos`}
                </text>
                <box flexDirection="row" gap={2}>
                  <text
                    fg={theme.accent()}
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      store.backupRestoreConfirm(entry.file);
                    }}
                  >
                    {"  [restore --yes]"}
                  </text>
                  <text fg={theme.dim()} wrapMode="none">
                    {entry.file}
                  </text>
                </box>
              </box>
            ))
          )}
          <text
            fg={theme.dim()}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              void store.backupSnapshotNow();
            }}
          >
            {" [b] snapshot now"}
          </text>
        </box>
      </box>
      <text fg={theme.dim()}>
        {"r refresh · b snapshot · restore/empty guarded by confirm · Esc cockpit"}
      </text>
    </box>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

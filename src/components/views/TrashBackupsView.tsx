import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { visibleSlice } from "../windowing.ts";

/**
 * `repotruck trash …` and `repotruck backup …` as one recovery page: trashed
 * repositories with restore, empty with an older-than filter, and the
 * snapshot generations with confirm-guarded restore.
 */
export function TrashBackupsView({
  store,
  width,
  height: heightProp,
}: {
  store: Store;
  width: number;
  height?: number;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height: termHeight } = useTerminalDimensions();
  const height = heightProp ?? Math.max(12, termHeight - 4);
  const page = snapshot.trashPage;
  const [scrollIdx, setScrollIdx] = useState(0);

  useEffect(() => {
    if (page === null) void store.refreshTrashPage();
  }, [page, store]);

  const trash = page?.trash ?? [];
  const backups = page?.backups ?? [];
  const maxItems = Math.max(trash.length, backups.length);

  useKeyboard((key) => {
    if (key.name === "r") void store.refreshTrashPage();
    else if (key.name === "b") void store.backupSnapshotNow();
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(Math.max(0, maxItems - 1), s + 1));
    }
  });

  const stacked = width < 78;
  const half = stacked ? width : Math.max(20, Math.floor((width - 2) / 2));
  // Each item takes 2 rows inside its bordered box
  const boxBudgetRows = stacked
    ? Math.max(1, Math.floor((height - 10) / 4))
    : Math.max(1, Math.floor((height - 8) / 2));
  const trashWin = visibleSlice(
    Math.min(scrollIdx, Math.max(0, trash.length - 1)),
    trash.length,
    boxBudgetRows,
  );
  const visibleTrash = trash.slice(trashWin.start, trashWin.end);
  const backupWin = visibleSlice(
    Math.min(scrollIdx, Math.max(0, backups.length - 1)),
    backups.length,
    boxBudgetRows,
  );
  const visibleBackups = backups.slice(backupWin.start, backupWin.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      gap={height < 20 ? 0 : 1}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) => Math.min(Math.max(0, maxItems - 1), Math.max(0, s + (isUp ? -1 : 1))));
      }}
    >
      <box
        flexDirection={stacked ? "column" : "row"}
        flexGrow={1}
        gap={stacked ? 0 : 1}
        width="100%"
      >
        <box
          border
          borderColor={theme.border()}
          flexDirection="column"
          width={stacked ? "100%" : half}
          padding={0}
          overflow="hidden"
          flexShrink={0}
        >
          <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
            {trash.length > boxBudgetRows
              ? ` Trash · .repotruck/trash (${trashWin.start + 1}-${trashWin.end}/${trash.length})`
              : " Trash · .repotruck/trash"}
          </text>
          {trash.length === 0 ? (
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {"  trash is empty"}
            </text>
          ) : (
            visibleTrash.map((entry) => (
              <box key={entry.id} flexDirection="column" flexShrink={0}>
                <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
                  {` ${entry.owner}/${entry.name} · ${formatSize(entry.sizeBytes)} · ${entry.trashedAt.slice(0, 10)}`}
                </text>
                <box flexDirection="row" gap={2} flexShrink={0}>
                  <text
                    fg={theme.accent()}
                    wrapMode="none"
                    flexShrink={0}
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
                  <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
                    {entry.id}
                  </text>
                </box>
              </box>
            ))
          )}
          <text
            fg={theme.error()}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              store.trashEmptyConfirm();
            }}
          >
            {" [E] empty trash --yes"}
          </text>
        </box>
        <box
          border
          borderColor={theme.border()}
          flexDirection="column"
          width={stacked ? "100%" : half}
          padding={0}
          overflow="hidden"
          flexShrink={0}
        >
          <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
            {backups.length > boxBudgetRows
              ? ` Backups · 5 generations (${backupWin.start + 1}-${backupWin.end}/${backups.length})`
              : " Backups · 5 generations"}
          </text>
          {backups.length === 0 ? (
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {"  no snapshots yet (written on every workspace change)"}
            </text>
          ) : (
            visibleBackups.map((entry) => (
              <box key={entry.file} flexDirection="column" flexShrink={0}>
                <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
                  {` ${entry.createdAt.slice(0, 19).replace("T", " ")} · ${entry.repoCount} repos`}
                </text>
                <box flexDirection="row" gap={2} flexShrink={0}>
                  <text
                    fg={theme.accent()}
                    wrapMode="none"
                    flexShrink={0}
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      store.backupRestoreConfirm(entry.file);
                    }}
                  >
                    {"  [restore --yes]"}
                  </text>
                  <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
                    {entry.file}
                  </text>
                </box>
              </box>
            ))
          )}
          <text
            fg={theme.dim()}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              void store.backupSnapshotNow();
            }}
          >
            {" [b] snapshot now"}
          </text>
        </box>
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
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

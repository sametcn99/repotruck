import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { clampBoxLine, scrollSlice } from "../windowing.ts";

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
  const height = heightProp ?? Math.max(8, termHeight - 11);
  const page = snapshot.trashPage;
  const [scrollIdx, setScrollIdx] = useState(0);

  useEffect(() => {
    if (page === null) void store.refreshTrashPage();
  }, [page, store]);

  const trash = page?.trash ?? [];
  const backups = page?.backups ?? [];
  const maxItems = Math.max(trash.length, backups.length);

  const stacked = width < 78;
  const boxInnerCols = stacked
    ? Math.max(10, width - 3)
    : Math.max(10, Math.floor((width - 1) / 2) - 3);
  // Side-by-side: each box has outer height (height - 1), inner height (height - 3),
  // minus 1 header line and 1 bottom action line = (height - 5) rows for 2-row items.
  const boxBudgetRows = stacked
    ? Math.max(1, Math.floor((Math.floor((height - 1) / 2) - 4) / 2))
    : Math.max(1, Math.floor((height - 5) / 2));
  const maxScroll = Math.max(0, maxItems - boxBudgetRows);

  useKeyboard((key) => {
    if (key.name === "r") void store.refreshTrashPage();
    else if (key.name === "b") void store.backupSnapshotNow();
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, Math.min(s, maxScroll) - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(maxScroll, s + 1));
    }
  });

  const trashWin = scrollSlice(scrollIdx, trash.length, boxBudgetRows);
  const visibleTrash = trash.slice(trashWin.start, trashWin.end);
  const backupWin = scrollSlice(scrollIdx, backups.length, boxBudgetRows);
  const visibleBackups = backups.slice(backupWin.start, backupWin.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(maxScroll, Math.max(0, Math.min(s, maxScroll) + (isUp ? -1 : 1))),
        );
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
          flexGrow={1}
          flexBasis={stacked ? undefined : 0}
          width={stacked ? "100%" : undefined}
          padding={0}
          overflow="hidden"
        >
          <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
            {clampBoxLine(
              trash.length > boxBudgetRows
                ? ` Trash · .repotruck/trash (${trashWin.start + 1}-${trashWin.end}/${trash.length})`
                : " Trash · .repotruck/trash",
              boxInnerCols,
            )}
          </text>
          {trash.length === 0 ? (
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {"  trash is empty"}
            </text>
          ) : (
            visibleTrash.map((entry) => (
              <box key={entry.id} flexDirection="column" flexShrink={0}>
                <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
                  {clampBoxLine(
                    ` ${entry.owner}/${entry.name} · ${formatSize(entry.sizeBytes)} · ${entry.trashedAt.slice(0, 10)}`,
                    boxInnerCols,
                  )}
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
                    {clampBoxLine(entry.id, Math.max(6, boxInnerCols - 13))}
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
          flexGrow={1}
          flexBasis={stacked ? undefined : 0}
          width={stacked ? "100%" : undefined}
          padding={0}
          overflow="hidden"
        >
          <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
            {clampBoxLine(
              backups.length > boxBudgetRows
                ? ` Backups · 5 generations (${backupWin.start + 1}-${backupWin.end}/${backups.length})`
                : " Backups · 5 generations",
              boxInnerCols,
            )}
          </text>
          {backups.length === 0 ? (
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {clampBoxLine("  no snapshots yet (written on every workspace change)", boxInnerCols)}
            </text>
          ) : (
            visibleBackups.map((entry) => (
              <box key={entry.file} flexDirection="column" flexShrink={0}>
                <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
                  {clampBoxLine(
                    ` ${entry.createdAt.slice(0, 19).replace("T", " ")} · ${entry.repoCount} repos`,
                    boxInnerCols,
                  )}
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
                    {clampBoxLine(entry.file, Math.max(6, boxInnerCols - 19))}
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
        {clampBoxLine(
          "r refresh · b snapshot · restore/empty guarded by confirm · Esc cockpit",
          width,
        )}
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

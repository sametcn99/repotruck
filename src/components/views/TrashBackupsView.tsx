import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { clampBoxLine, visibleSlice } from "../windowing.ts";

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
  const [pane, setPane] = useState<"trash" | "backups">("trash");
  const [trashCursor, setTrashCursor] = useState(0);
  const [backupCursor, setBackupCursor] = useState(0);

  useEffect(() => {
    if (page === null) void store.refreshTrashPage();
  }, [page, store]);

  const trash = page?.trash ?? [];
  const backups = page?.backups ?? [];

  const stacked = width < 78;
  const boxInnerCols = stacked
    ? Math.max(10, width - 3)
    : Math.max(10, Math.floor((width - 1) / 2) - 3);
  // Side-by-side: each box has outer height (height - 1), inner height (height - 3),
  // minus 1 header line and 1 bottom action line = (height - 5) rows for 2-row items.
  const boxBudgetRows = stacked
    ? Math.max(1, Math.floor((Math.floor((height - 1) / 2) - 4) / 2))
    : Math.max(1, Math.floor((height - 5) / 2));

  const maxTrash = Math.max(0, trash.length - 1);
  const clampedTrash = Math.min(trashCursor, maxTrash);
  const maxBackup = Math.max(0, backups.length - 1);
  const clampedBackup = Math.min(backupCursor, maxBackup);
  const focused =
    !snapshot.navFocused &&
    snapshot.dialog === null &&
    snapshot.modal === null &&
    snapshot.contextMenu === null;

  const confirmTrashRestore = (entry: (typeof trash)[number]) => {
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
  };

  useKeyboard((key) => {
    const snap = store.getSnapshot();
    if (
      snap.navFocused ||
      snap.dialog !== null ||
      snap.modal !== null ||
      snap.contextMenu !== null
    ) {
      return;
    }
    if (key.name === "r") {
      void store.refreshTrashPage();
    } else if (key.name === "b") {
      void store.backupSnapshotNow();
    } else if (key.sequence === "E" || (key.shift === true && key.name === "e")) {
      store.trashEmptyConfirm();
    } else if (key.name === "left" || key.sequence === "h") {
      setPane("trash");
    } else if (key.name === "right" || key.sequence === "l") {
      setPane("backups");
    } else if (key.name === "up" || key.sequence === "k") {
      if (pane === "trash") setTrashCursor((c) => Math.max(0, Math.min(c, maxTrash) - 1));
      else setBackupCursor((c) => Math.max(0, Math.min(c, maxBackup) - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      if (pane === "trash") setTrashCursor((c) => Math.min(maxTrash, Math.min(c, maxTrash) + 1));
      else setBackupCursor((c) => Math.min(maxBackup, Math.min(c, maxBackup) + 1));
    } else if (key.name === "home" || key.sequence === "g") {
      if (pane === "trash") setTrashCursor(0);
      else setBackupCursor(0);
    } else if (
      key.name === "end" ||
      key.sequence === "G" ||
      (key.shift === true && key.name === "g")
    ) {
      if (pane === "trash") setTrashCursor(maxTrash);
      else setBackupCursor(maxBackup);
    } else if (key.name === "return" || key.name === "space") {
      if (pane === "trash") {
        const entry = trash[clampedTrash];
        if (entry !== undefined) confirmTrashRestore(entry);
      } else {
        const entry = backups[clampedBackup];
        if (entry !== undefined) store.backupRestoreConfirm(entry.file);
      }
    }
  });

  const trashWin = visibleSlice(clampedTrash, trash.length, boxBudgetRows);
  const visibleTrash = trash.slice(trashWin.start, trashWin.end);
  const backupWin = visibleSlice(clampedBackup, backups.length, boxBudgetRows);
  const visibleBackups = backups.slice(backupWin.start, backupWin.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        if (pane === "trash") {
          setTrashCursor((c) =>
            Math.min(maxTrash, Math.max(0, Math.min(c, maxTrash) + (isUp ? -1 : 1))),
          );
        } else {
          setBackupCursor((c) =>
            Math.min(maxBackup, Math.max(0, Math.min(c, maxBackup) + (isUp ? -1 : 1))),
          );
        }
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
          borderColor={focused && pane === "trash" ? theme.focusBorder() : theme.border()}
          flexDirection="column"
          flexGrow={1}
          flexBasis={stacked ? undefined : 0}
          width={stacked ? "100%" : undefined}
          padding={0}
          overflow="hidden"
          onMouseDown={() => setPane("trash")}
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
            visibleTrash.map((entry, offset) => {
              const idx = trashWin.start + offset;
              const isCursor = focused && pane === "trash" && idx === clampedTrash;
              return (
                <box
                  key={entry.id}
                  flexDirection="column"
                  flexShrink={0}
                  onMouseDown={() => {
                    setPane("trash");
                    setTrashCursor(idx);
                  }}
                >
                  <text
                    fg={isCursor ? theme.cursorFg() : theme.normal()}
                    bg={isCursor ? theme.cursorBg() : undefined}
                    wrapMode="none"
                    flexShrink={0}
                  >
                    {clampBoxLine(
                      `${isCursor ? ">" : " "} ${entry.owner}/${entry.name} · ${formatSize(entry.sizeBytes)} · ${entry.trashedAt.slice(0, 10)}`,
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
                        setPane("trash");
                        setTrashCursor(idx);
                        confirmTrashRestore(entry);
                      }}
                    >
                      {"  [restore]"}
                    </text>
                    <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
                      {clampBoxLine(entry.id, Math.max(6, boxInnerCols - 13))}
                    </text>
                  </box>
                </box>
              );
            })
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
          borderColor={focused && pane === "backups" ? theme.focusBorder() : theme.border()}
          flexDirection="column"
          flexGrow={1}
          flexBasis={stacked ? undefined : 0}
          width={stacked ? "100%" : undefined}
          padding={0}
          overflow="hidden"
          onMouseDown={() => setPane("backups")}
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
            visibleBackups.map((entry, offset) => {
              const idx = backupWin.start + offset;
              const isCursor = focused && pane === "backups" && idx === clampedBackup;
              return (
                <box
                  key={entry.file}
                  flexDirection="column"
                  flexShrink={0}
                  onMouseDown={() => {
                    setPane("backups");
                    setBackupCursor(idx);
                  }}
                >
                  <text
                    fg={isCursor ? theme.cursorFg() : theme.normal()}
                    bg={isCursor ? theme.cursorBg() : undefined}
                    wrapMode="none"
                    flexShrink={0}
                  >
                    {clampBoxLine(
                      `${isCursor ? ">" : " "} ${entry.createdAt.slice(0, 19).replace("T", " ")} · ${entry.repoCount} repos`,
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
                        setPane("backups");
                        setBackupCursor(idx);
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
              );
            })
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
          "←→/hl pane · ↑↓/jk move · Enter restore · E empty · r refresh · b snapshot · Esc cockpit",
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

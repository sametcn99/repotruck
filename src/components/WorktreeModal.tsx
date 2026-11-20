import { useTerminalDimensions } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store, StoreSnapshot } from "./store.ts";
import { theme } from "./theme.ts";
import { clampBoxLine, visibleSlice } from "./windowing.ts";

export function WorktreeModal({ store }: { store: Store }) {
  const snapshot: StoreSnapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { width, height } = useTerminalDimensions();
  const modal = snapshot.modal;
  const key = modal !== null && modal.type === "worktree" ? modal.key : "";
  const worktrees = modal !== null && modal.type === "worktree" ? modal.worktrees : [];
  const loading = modal !== null && modal.type === "worktree" ? modal.loading : false;
  const error = modal !== null && modal.type === "worktree" ? modal.error : null;

  const [branch, setBranch] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [newBranch, setNewBranch] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [scrollIdx, setScrollIdx] = useState(0);

  const accentColor = theme.accent();
  const compact = height < 24;
  const maxCols = Math.max(16, width - (compact || width < 68 ? 2 : 4));
  // Reserve rows for chrome, title, inputs, and buttons so they remain reachable on short terminals
  const wtViewport = Math.max(1, height - (compact ? 17 : 21));
  const boundedScroll = Math.min(Math.max(0, scrollIdx), Math.max(0, worktrees.length - 1));
  const wtWin = visibleSlice(boundedScroll, worktrees.length, wtViewport);
  const visibleWorktrees = worktrees.slice(wtWin.start, wtWin.end);

  return (
    <ModalShell
      store={store}
      title={`Worktrees - ${key}`}
      hint="Escape cancels"
      borderColor={accentColor}
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(Math.max(0, worktrees.length - 1), Math.max(0, s + (isUp ? -1 : 1))),
        );
      }}
    >
      {loading ? (
        <text fg={theme.dim()} flexShrink={0}>
          Loading worktrees...
        </text>
      ) : (
        <>
          <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
            {`Active Worktrees (${worktrees.length})${
              worktrees.length > wtViewport ? ` · showing ${wtWin.start + 1}-${wtWin.end}` : ""
            }:`}
          </text>
          {visibleWorktrees.map((wt) => {
            const role = wt.isMain ? " (main)" : "";
            const br = wt.branch ? `[${wt.branch}]` : "[detached]";
            const locked = wt.locked ? " [locked]" : "";
            const lineCols = wt.isMain ? maxCols : Math.max(12, maxCols - 12);
            return (
              <box key={wt.path} flexDirection="row" gap={1} flexShrink={0}>
                <text
                  fg={wt.isMain ? theme.accent() : theme.normal()}
                  wrapMode="none"
                  flexShrink={0}
                >
                  {clampBoxLine(`  ${wt.path} ${br}${role}${locked}`, lineCols)}
                </text>
                {!wt.isMain ? (
                  <text
                    fg={theme.error()}
                    wrapMode="none"
                    flexShrink={0}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      void store.removeWorktree(key, wt.path).then((res) => {
                        setActionMsg(res.message);
                      });
                    }}
                  >
                    {"[ Remove ]"}
                  </text>
                ) : null}
              </box>
            );
          })}
          {error !== null ? (
            <text fg={theme.error()} wrapMode="none" flexShrink={0}>
              {clampBoxLine(error, maxCols)}
            </text>
          ) : null}
          {actionMsg !== null ? (
            <text fg={theme.info()} wrapMode="none" flexShrink={0}>
              {clampBoxLine(actionMsg, maxCols)}
            </text>
          ) : null}

          <box flexDirection="column" marginTop={compact ? 0 : 1} gap={0} flexShrink={0}>
            <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
              Add New Worktree:
            </text>
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              Branch name:
            </text>
            <input value={branch} onInput={setBranch} placeholder="e.g. feature-x" width="100%" />
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              Custom Path (optional, empty defaults to ../repo+branch):
            </text>
            <input
              value={targetPath}
              onInput={setTargetPath}
              placeholder="optional path"
              width="100%"
            />
            <box flexDirection="row" gap={2} flexShrink={0}>
              <text
                fg={newBranch ? theme.success() : theme.dim()}
                wrapMode="none"
                flexShrink={0}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setNewBranch(!newBranch);
                }}
              >
                {newBranch ? "[x] Create new branch (-b)" : "[ ] Create new branch (-b)"}
              </text>
            </box>
            <box
              flexDirection="row"
              flexWrap="wrap"
              gap={2}
              marginTop={compact ? 0 : 1}
              flexShrink={0}
            >
              <text
                fg={accentColor}
                flexShrink={0}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (!branch.trim()) return;
                  void store
                    .createWorktree(key, branch.trim(), targetPath.trim() || undefined, newBranch)
                    .then((res) => {
                      setActionMsg(res.message);
                      if (res.ok) {
                        setBranch("");
                        setTargetPath("");
                      }
                    });
                }}
              >
                {"[ Add Worktree ]"}
              </text>
              <text
                fg={theme.dim()}
                flexShrink={0}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  store.closeModal();
                }}
              >
                {"[ Close ]"}
              </text>
            </box>
          </box>
        </>
      )}
    </ModalShell>
  );
}

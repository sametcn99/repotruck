import { useState, useSyncExternalStore } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store, StoreSnapshot } from "./store.ts";
import { theme } from "./theme.ts";

export function WorktreeModal({ store }: { store: Store }) {
  const snapshot: StoreSnapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const modal = snapshot.modal;
  const key = modal !== null && modal.type === "worktree" ? modal.key : "";
  const worktrees = modal !== null && modal.type === "worktree" ? modal.worktrees : [];
  const loading = modal !== null && modal.type === "worktree" ? modal.loading : false;
  const error = modal !== null && modal.type === "worktree" ? modal.error : null;

  const [branch, setBranch] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [newBranch, setNewBranch] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const accentColor = theme.accent();

  return (
    <ModalShell
      store={store}
      title={`Worktrees - ${key}`}
      hint="Escape cancels"
      borderColor={accentColor}
    >
      {loading ? (
        <text fg={theme.dim()}>Loading worktrees...</text>
      ) : (
        <>
          <text fg={theme.normal()}>{`Active Worktrees (${worktrees.length}):`}</text>
          {worktrees.map((wt) => {
            const role = wt.isMain ? " (main)" : "";
            const br = wt.branch ? `[${wt.branch}]` : "[detached]";
            const locked = wt.locked ? " [locked]" : "";
            return (
              <box key={wt.path} flexDirection="row" gap={1}>
                <text fg={wt.isMain ? theme.accent() : theme.normal()}>
                  {`  ${wt.path} ${br}${role}${locked}`}
                </text>
                {!wt.isMain ? (
                  <text
                    fg={theme.error()}
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
          {error !== null ? <text fg={theme.error()}>{error}</text> : null}
          {actionMsg !== null ? <text fg={theme.info()}>{actionMsg}</text> : null}

          <box flexDirection="column" marginTop={1} gap={1}>
            <text fg={theme.normal()}>Add New Worktree:</text>
            <text fg={theme.dim()}>Branch name:</text>
            <input value={branch} onInput={setBranch} placeholder="e.g. feature-x" width="100%" />
            <text fg={theme.dim()}>Custom Path (optional, empty defaults to ../repo+branch):</text>
            <input
              value={targetPath}
              onInput={setTargetPath}
              placeholder="optional path"
              width="100%"
            />
            <box flexDirection="row" gap={2}>
              <text
                fg={newBranch ? theme.success() : theme.dim()}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setNewBranch(!newBranch);
                }}
              >
                {newBranch ? "[x] Create new branch (-b)" : "[ ] Create new branch (-b)"}
              </text>
            </box>
            <box flexDirection="row" gap={2} marginTop={1}>
              <text
                fg={accentColor}
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

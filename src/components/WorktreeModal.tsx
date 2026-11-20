import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useRef, useState, useSyncExternalStore } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store, StoreSnapshot } from "./store.ts";
import { theme } from "./theme.ts";
import { clampBoxLine, visibleSlice } from "./windowing.ts";

const FIELDS = ["list", "branch", "path", "newBranch", "add"] as const;

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
  const [cursor, setCursor] = useState(0);
  const [focus, setFocus] = useState<(typeof FIELDS)[number]>("branch");
  const actionPending = useRef(false);

  const accentColor = theme.accent();
  const compact = height < 22;
  const maxCols = Math.max(16, width - (compact || width < 68 ? 2 : 4));
  // Reserve rows for chrome, title, inputs, and buttons so they remain reachable on short terminals
  const showList = !compact || focus === "list";
  const showForm = !compact || focus !== "list";
  const wtViewport = Math.max(1, height - (compact ? 15 : 22));
  const activeIndex = Math.min(cursor, Math.max(0, worktrees.length - 1));
  const wtWin = visibleSlice(activeIndex, worktrees.length, wtViewport);
  const visibleWorktrees = worktrees.slice(wtWin.start, wtWin.end);
  const moveCursor = (delta: number) =>
    setCursor(Math.max(0, Math.min(worktrees.length - 1, activeIndex + delta)));

  const runAction = async (
    action: () => Promise<{ ok: boolean; message: string }>,
    afterSuccess?: () => void,
  ) => {
    if (actionPending.current) return;
    actionPending.current = true;
    try {
      const result = await action();
      setActionMsg(result.message);
      if (result.ok) afterSuccess?.();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    } finally {
      actionPending.current = false;
    }
  };

  const addWorktree = () => {
    if (!branch.trim()) {
      setFocus("branch");
      return;
    }
    void runAction(
      () => store.createWorktree(key, branch.trim(), targetPath.trim() || undefined, newBranch),
      () => {
        setBranch("");
        setTargetPath("");
        setFocus("branch");
      },
    );
  };

  const removeWorktree = (target: (typeof worktrees)[number] | undefined) => {
    if (target === undefined || target.isMain) return;
    void runAction(() => store.removeWorktree(key, target.path));
  };

  useKeyboard((event) => {
    if (loading || store.getSnapshot().modal?.type !== "worktree") return;
    if (event.name === "tab") {
      event.stopPropagation();
      const fields = worktrees.length > 0 ? FIELDS : FIELDS.slice(1);
      const index = fields.indexOf(focus);
      const direction = event.shift ? -1 : 1;
      setFocus(fields[(index + direction + fields.length) % fields.length]!);
    } else if (focus === "list") {
      if (event.name === "up" || event.sequence === "k") moveCursor(-1);
      else if (event.name === "down" || event.sequence === "j") moveCursor(1);
      else if (event.name === "home") setCursor(0);
      else if (event.name === "end") setCursor(Math.max(0, worktrees.length - 1));
      else if (event.name === "delete" && !event.repeated) removeWorktree(worktrees[activeIndex]);
    } else if (event.name === "return" || event.name === "space") {
      if (focus === "newBranch") setNewBranch((current) => !current);
      else if (focus === "add") addWorktree();
    }
  });

  return (
    <ModalShell
      store={store}
      title={`Worktrees - ${key}`}
      hint={
        focus === "list"
          ? "↑↓ select · Del remove · Tab form · Esc close"
          : "Tab next · Shift+Tab previous · Esc close"
      }
      borderColor={accentColor}
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        if (worktrees.length > 0) {
          setFocus("list");
          moveCursor(isUp ? -1 : 1);
        }
      }}
    >
      {loading ? (
        <text fg={theme.dim()} flexShrink={0}>
          Loading worktrees...
        </text>
      ) : (
        <>
          {compact && worktrees.length > 0 ? (
            <text
              fg={theme.accent()}
              wrapMode="none"
              flexShrink={0}
              onMouseDown={(event) => {
                event.stopPropagation();
                setFocus(focus === "list" ? "branch" : "list");
              }}
            >
              {focus === "list" ? "[Tab] Add worktree" : "[Shift+Tab from Branch] Worktree list"}
            </text>
          ) : null}
          {showList ? (
            <>
              <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
                {`Active Worktrees (${worktrees.length})${
                  worktrees.length > wtViewport ? ` · showing ${wtWin.start + 1}-${wtWin.end}` : ""
                }:`}
              </text>
              {visibleWorktrees.map((wt, offset) => {
                const index = wtWin.start + offset;
                const selected = focus === "list" && index === activeIndex;
                const role = wt.isMain ? " (main)" : "";
                const br = wt.branch ? `[${wt.branch}]` : "[detached]";
                const locked = wt.locked ? " [locked]" : "";
                const lineCols = wt.isMain ? maxCols : Math.max(12, maxCols - 12);
                return (
                  <box key={wt.path} flexDirection="row" gap={1} flexShrink={0}>
                    <text
                      fg={selected ? theme.cursorFg() : wt.isMain ? theme.accent() : theme.normal()}
                      bg={selected ? theme.cursorBg() : undefined}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        setFocus("list");
                        setCursor(index);
                      }}
                      wrapMode="none"
                      flexShrink={0}
                    >
                      {clampBoxLine(
                        `${selected ? "> " : "  "}${wt.path} ${br}${role}${locked}`,
                        lineCols,
                      )}
                    </text>
                    {!wt.isMain ? (
                      <text
                        fg={theme.error()}
                        wrapMode="none"
                        flexShrink={0}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setFocus("list");
                          setCursor(index);
                          removeWorktree(wt);
                        }}
                      >
                        {"[Del] Remove"}
                      </text>
                    ) : null}
                  </box>
                );
              })}
            </>
          ) : null}
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

          {showForm ? (
            <box flexDirection="column" marginTop={compact ? 0 : 1} gap={0} flexShrink={0}>
              {!compact ? (
                <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
                  Add New Worktree:
                </text>
              ) : null}
              <box flexDirection={compact ? "row" : "column"} flexShrink={0} gap={compact ? 1 : 0}>
                <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
                  Branch:
                </text>
                <input
                  focused={focus === "branch"}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    setFocus("branch");
                  }}
                  value={branch}
                  onInput={setBranch}
                  onSubmit={() => setFocus("path")}
                  placeholder="e.g. feature-x"
                  width={compact ? Math.max(10, maxCols - 15) : "100%"}
                />
              </box>
              <box flexDirection={compact ? "row" : "column"} flexShrink={0} gap={compact ? 1 : 0}>
                <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
                  {compact ? "Path:" : "Custom path (optional, defaults to ../repo+branch):"}
                </text>
                <input
                  focused={focus === "path"}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    setFocus("path");
                  }}
                  value={targetPath}
                  onInput={setTargetPath}
                  onSubmit={() => setFocus("newBranch")}
                  placeholder="optional path"
                  width={compact ? Math.max(10, maxCols - 15) : "100%"}
                />
              </box>
              <box flexDirection="row" gap={2} flexShrink={0}>
                <text
                  fg={
                    focus === "newBranch"
                      ? theme.cursorFg()
                      : newBranch
                        ? theme.success()
                        : theme.dim()
                  }
                  bg={focus === "newBranch" ? theme.cursorBg() : undefined}
                  wrapMode="none"
                  flexShrink={0}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setFocus("newBranch");
                    setNewBranch((current) => !current);
                  }}
                >
                  {`[${newBranch ? "x" : " "}] Create new branch (-b) · Space`}
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
                  fg={focus === "add" ? theme.cursorFg() : accentColor}
                  bg={focus === "add" ? theme.cursorBg() : undefined}
                  flexShrink={0}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    addWorktree();
                  }}
                >
                  {"[Enter] Add Worktree"}
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
          ) : null}
        </>
      )}
    </ModalShell>
  );
}

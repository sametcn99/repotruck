import { spawn } from "node:child_process";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { visibleSlice } from "../windowing.ts";

/**
 * `repotruck sync resolve` as a page: repositories that ended a sync in a
 * conflict/rebase state, the resolution guide, and continue/abort actions
 * executed with git in the repository directory.
 */
export function ConflictResolverView({
  store,
  height: heightProp,
}: {
  store: Store;
  width?: number;
  height?: number;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height: termHeight } = useTerminalDimensions();
  const height = heightProp ?? Math.max(12, termHeight - 4);
  const [output, setOutput] = useState<string[]>([]);
  const [scrollIdx, setScrollIdx] = useState(0);

  useEffect(() => {
    setOutput((current) =>
      current.length === 0
        ? [
            "run a sync with divergence=rebase to see conflicts here; FAILED rows below also list candidates",
          ]
        : current,
    );
  }, []);

  const failed = snapshot.statuses.filter((entry) => entry.phase === "FAILED").slice(-12);
  const failedCap = Math.max(1, Math.min(6, Math.floor((height - 10) / 2)));
  const outputCap = Math.max(1, height - 10 - failedCap);
  const failedWin = visibleSlice(
    Math.min(scrollIdx, Math.max(0, failed.length - 1)),
    failed.length,
    failedCap,
  );
  const visibleFailed = failed.slice(failedWin.start, failedWin.end);

  useKeyboard((key) => {
    if (key.name === "g") void gitAll(store, "continue", setOutput);
    else if (key.name === "a") void gitAll(store, "abort", setOutput);
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(Math.max(0, failed.length - 1), s + 1));
    }
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(Math.max(0, failed.length - 1), Math.max(0, s + (isUp ? -1 : 1))),
        );
      }}
    >
      <text fg={theme.dim()} wrapMode="none">
        {" Conflicts — sync resolve"}
      </text>
      <box border borderColor={theme.border()} flexDirection="column" padding={0} overflow="hidden">
        <text fg={theme.normal()} wrapMode="none">
          {` recent failures (${failed.length}):`}
        </text>
        {failed.length === 0 ? (
          <text fg={theme.dim()} wrapMode="none">
            {"  none — last sync was clean"}
          </text>
        ) : (
          visibleFailed.map((entry) => (
            <text key={`${entry.id}`} fg={theme.error()} wrapMode="none">
              {` ✗ ${entry.key} — ${entry.message ?? "failed"}`}
            </text>
          ))
        )}
      </box>
      <box flexDirection="row" flexWrap="wrap" gap={2}>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void gitAll(store, "continue", setOutput);
          }}
        >
          {"[g] git rebase --continue"}
        </text>
        <text
          fg={theme.error()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void gitAll(store, "abort", setOutput);
          }}
        >
          {"[a] git rebase --abort"}
        </text>
      </box>
      <box
        border
        borderColor={theme.border()}
        flexDirection="column"
        flexGrow={1}
        padding={0}
        overflow="hidden"
      >
        <text fg={theme.accent()} wrapMode="none">
          {" Resolution output & workflow"}
        </text>
        {(() => {
          const seen = new Map<string, number>();
          return output.slice(0, outputCap).map((line) => {
            const count = (seen.get(line) ?? 0) + 1;
            seen.set(line, count);
            return (
              <text key={`${line}#${count}`} fg={theme.dim()} wrapMode="none">
                {` ${line}`}
              </text>
            );
          });
        })()}
        <text fg={theme.dim()} wrapMode="none">
          {" 1. inspect conflicting files in the repo directory or open via cockpit [o]"}
        </text>
        <text fg={theme.dim()} wrapMode="none">
          {" 2. stage resolved files (git add <file>), then press [g] to continue rebase"}
        </text>
        <text fg={theme.dim()} wrapMode="none">
          {" 3. or press [a] to abort the rebase and restore the pre-sync branch state"}
        </text>
      </box>
      <text fg={theme.dim()} wrapMode="none">
        {"actions run in each failed repo's directory · Esc cockpit"}
      </text>
    </box>
  );
}

async function gitAll(
  store: Store,
  action: "continue" | "abort",
  setOutput: (lines: string[]) => void,
): Promise<void> {
  const snapshot = store.getSnapshot();
  const failed = snapshot.statuses.filter((entry) => entry.phase === "FAILED").slice(-12);
  const lines: string[] = [];
  for (const entry of failed) {
    const health = snapshot.localHealth.get(entry.key);
    if (health?.relativePath == null) {
      lines.push(`${entry.key}: no local path — skipped`);
      continue;
    }
    const dir = `${store.root}/${health.relativePath}`;
    lines.push(`${entry.key}: git rebase --${action} …`);
    try {
      const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = spawn("git", [`rebase`, `--${action}`], { cwd: dir });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("close", (code) => resolve({ code, stderr }));
      });
      lines.push(
        `${entry.key}: ${result.code === 0 ? "ok" : `exit ${result.code}${result.stderr ? ` — ${result.stderr.split("\n")[0]}` : ""}`}`,
      );
    } catch (error) {
      lines.push(`${entry.key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (lines.length === 0) lines.push("no failed repositories to resolve");
  setOutput(lines);
  store.pushStatus(
    "DONE",
    "[resolve]",
    `sync resolve --action ${action} applied to ${failed.length} repo(s)`,
  );
}

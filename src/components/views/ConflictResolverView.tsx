import { spawn } from "node:child_process";
import { useKeyboard } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";

/**
 * `repotruck sync resolve` as a page: repositories that ended a sync in a
 * conflict/rebase state, the resolution guide, and continue/abort actions
 * executed with git in the repository directory.
 */
export function ConflictResolverView({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [output, setOutput] = useState<string[]>([]);

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

  useKeyboard((key) => {
    if (key.name === "g") void gitAll(store, "continue", setOutput);
    else if (key.name === "a") void gitAll(store, "abort", setOutput);
  });

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <text fg={theme.dim()}>{" Conflicts — sync resolve"}</text>
      <text fg={theme.normal()}>{" recent failures:"}</text>
      {failed.length === 0 ? (
        <text fg={theme.dim()}>{"  none — last sync was clean"}</text>
      ) : (
        failed.map((entry) => (
          <text key={`${entry.id}`} fg={theme.error()}>
            {` ✗ ${entry.key} — ${entry.message ?? "failed"}`}
          </text>
        ))
      )}
      <box flexDirection="row" gap={2}>
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
      <box flexDirection="column" flexGrow={1}>
        {output.map((line, index) => (
          <text key={`${index}-${line.slice(0, 12)}`} fg={theme.dim()}>
            {` ${line}`}
          </text>
        ))}
      </box>
      <text fg={theme.dim()}>{"actions run in each failed repo's directory · Esc cockpit"}</text>
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

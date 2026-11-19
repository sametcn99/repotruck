import { useKeyboard } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { RepoStatusLine } from "../../services/lifecycle.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyJson } from "../ui/JsonCopy.ts";
import { type TableRow, TableView } from "../ui/TableView.tsx";

type StatusFilter = "all" | "dirty" | "unpushed" | "unpulled" | "pinned";

const FILTERS: readonly StatusFilter[] = ["all", "dirty", "unpushed", "unpulled", "pinned"];

/**
 * `repotruck status -D` as a page: every repository × git health, filter
 * chips, expandable per-repo detail, optional remote PR/CI columns and
 * copy-as-JSON for the whole table.
 */
export function StatusMatrixView({
  store,
  width,
  height,
}: {
  store: Store;
  width: number;
  height: number;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [cursor, setCursor] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const data = snapshot.statusMatrix;

  useEffect(() => {
    if (data === null) void store.refreshStatusMatrix();
  }, [data, store]);

  useKeyboard((key) => {
    const rows = filteredRows(data?.repos ?? [], filter, snapshot.localHealth);
    if (key.name === "up") {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.name === "down") {
      setCursor((c) => Math.min(Math.max(0, rows.length - 1), c + 1));
    } else if (key.name === "return" || key.name === "space") {
      const row = rows[cursor];
      if (row !== undefined) {
        setExpandedKey((current) => (current === row.key ? null : row.key));
      }
    } else if (key.name === "f") {
      setFilter((current) => FILTERS[(FILTERS.indexOf(current) + 1) % FILTERS.length]!);
      setCursor(0);
    } else if (key.name === "u") {
      void store.refreshStatusMatrix(!(data?.remote ?? false));
    } else if (key.name === "r") {
      void store.refreshStatusMatrix();
    } else if (key.name === "J" || key.sequence === "J") {
      const result = copyJson("status", {
        command: "status",
        ok: true,
        root: snapshot.root,
        lastSync: data?.lastSync ?? null,
        repos: rows,
      });
      store.pushStatus(result.ok ? "DONE" : "FAILED", "[status]", result.message);
    }
  });

  const remote = data?.remote ?? false;
  const rows = filteredRows(data?.repos ?? [], filter, snapshot.localHealth);
  const attention = (data?.repos ?? []).filter(
    (r) => r.dirty === true || (r.ahead ?? 0) > 0 || r.missing === true,
  ).length;

  const columns = [
    { key: "repo", label: "repository" },
    { key: "state", label: "state" },
    { key: "ab", label: "ahead/behind" },
    { key: "wt", label: "wt" },
    ...(remote
      ? [
          { key: "pr", label: "PR" },
          { key: "ci", label: "CI" },
        ]
      : []),
    { key: "disk", label: "disk" },
  ];

  const tableRows: TableRow<RepoStatusLine>[] = rows.map((line) => ({
    row: line,
    cells: statusCells(line, remote),
    detail: statusDetail(line),
  }));

  return (
    <box flexDirection="column" flexGrow={1} width="100%" padding={0}>
      <box flexDirection="row" gap={1} flexWrap="wrap">
        {FILTERS.map((f) => (
          <text
            key={f}
            fg={f === filter ? theme.accent() : theme.dim()}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              setFilter(f);
              setCursor(0);
            }}
          >
            {`[${f === filter ? "x" : " "}] ${f}`}
          </text>
        ))}
        <text fg={theme.dim()}>{"·"}</text>
        <text
          fg={remote ? theme.accent() : theme.dim()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            void store.refreshStatusMatrix(!remote);
          }}
        >
          {`[u] remote: ${remote ? "on" : "off"}`}
        </text>
        <text
          fg={theme.dim()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            void store.refreshStatusMatrix();
          }}
        >
          {"[r] refresh"}
        </text>
        <text
          fg={theme.dim()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            const result = copyJson("status", {
              command: "status",
              ok: true,
              root: snapshot.root,
              repos: rows,
            });
            store.pushStatus(result.ok ? "DONE" : "FAILED", "[status]", result.message);
          }}
        >
          {"[J] copy JSON"}
        </text>
      </box>
      <text fg={attention > 0 ? theme.warning() : theme.success()}>
        {data?.loading
          ? "loading repository status…"
          : `${rows.length} repos · ${attention} need attention · last sync: ${data?.lastSync ?? "never"}`}
      </text>
      <box flexGrow={1}>
        <TableView
          columns={columns}
          rows={tableRows}
          cursor={cursor}
          onCursor={setCursor}
          expandedId={expandedKey}
          onToggleExpand={setExpandedKey}
          viewportRows={Math.max(4, height - 12)}
          width={width}
          emptyLabel={data?.loading ? "loading…" : "no repositories match the filter"}
        />
      </box>
      <text fg={theme.dim()}>
        {
          "↑↓ move · Enter expand (-D detail) · f filter · u remote PR+CI · r refresh · J JSON · Esc cockpit"
        }
      </text>
    </box>
  );
}

function filteredRows(
  repos: readonly RepoStatusLine[],
  filter: StatusFilter,
  localHealth: ReadonlyMap<string, { pinned: boolean }>,
): RepoStatusLine[] {
  return repos.filter((line) => {
    switch (filter) {
      case "dirty":
        return line.dirty === true;
      case "unpushed":
        return (line.ahead ?? 0) > 0;
      case "unpulled":
        return (line.behind ?? 0) > 0;
      case "pinned":
        return localHealth.get(line.key)?.pinned === true;
      default:
        return true;
    }
  });
}

function statusCells(line: RepoStatusLine, remote: boolean): string[] {
  const state = line.missing === true ? "missing" : line.dirty === true ? "dirty" : "clean";
  const ab =
    (line.ahead ?? 0) > 0 || (line.behind ?? 0) > 0
      ? `↑${line.ahead ?? 0} ↓${line.behind ?? 0}`
      : "—";
  const cells = [line.key, state, ab, line.worktree === true ? "⑂" : "—"];
  if (remote) {
    const pr = line.remote ? `#${line.remote.openPrs}` : "—";
    const ci = line.remote
      ? line.remote.ciState === "success"
        ? "✓"
        : line.remote.ciState === "failure"
          ? "✗"
          : "·"
      : "—";
    cells.push(pr, ci);
  }
  cells.push(line.missing === true ? "no" : "yes");
  return cells;
}

function statusDetail(line: RepoStatusLine): string[] | undefined {
  const details = line.details;
  if (details === undefined)
    return line.missing === true
      ? ["clone missing — untrack, re-clone or restore from trash"]
      : undefined;
  const out: string[] = [];
  if (details.branch !== "")
    out.push(`branch: ${details.branch} → ${details.upstream ?? "no upstream"}`);
  for (const commit of details.outgoingCommits.slice(0, 5)) {
    out.push(`↑ ${commit.hash.slice(0, 7)} ${commit.subject}`);
  }
  for (const file of details.modifiedFiles.slice(0, 5)) {
    out.push(`* ${file.path} +${file.added ?? 0} −${file.removed ?? 0}`);
  }
  for (const file of details.untrackedFiles.slice(0, 4)) {
    out.push(`? ${file} (untracked)`);
  }
  return out.length > 0 ? out : undefined;
}

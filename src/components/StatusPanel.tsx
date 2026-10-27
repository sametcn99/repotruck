import { useTerminalDimensions } from "@opentui/react";
import { useSyncExternalStore } from "react";
import { formatDiffBar } from "../services/gitState.ts";
import { formatDiskSize } from "../services/stats.ts";
import { type RightPaneTab, STATUS_VIEW_ROWS, type Store, type StoreSnapshot } from "./store.ts";
import { theme } from "./theme.ts";
import { repoViewportRows } from "./windowing.ts";

const TABS: readonly { id: RightPaneTab; label: string; shortLabel: string }[] = [
  { id: "activity", label: "[1]Activity", shortLabel: "[1]Act" },
  { id: "inspector", label: "[2]Inspector", shortLabel: "[2]Insp" },
  { id: "health", label: "[3]Health", shortLabel: "[3]Hlth" },
];

export function clampPanelLine(raw: string, maxCols: number): string {
  const clean = raw.replace(/[\r\n\t]+/g, " ");
  if (maxCols <= 1) return clean.slice(0, Math.max(0, maxCols));
  if (clean.length <= maxCols) return clean;
  return `${clean.slice(0, maxCols - 1)}\u2026`;
}

function PanelLine({
  text,
  fg,
  maxCols,
  onMouseDown,
}: {
  text: string;
  fg: string | undefined;
  maxCols: number;
  onMouseDown?: (e: { stopPropagation: () => void }) => void;
}) {
  return (
    <text fg={fg} wrapMode="none" flexShrink={0} onMouseDown={onMouseDown}>
      {clampPanelLine(text, maxCols)}
    </text>
  );
}

function renderActivityBody(snapshot: StoreSnapshot, maxCols: number, bodyRows: number) {
  const dimFg = theme.dim();
  const counts = { CLONING: 0, PULLING: 0, DONE: 0, FAILED: 0 };
  for (const status of snapshot.statuses) {
    counts[status.phase] += 1;
  }
  const headerRows = snapshot.running ? 2 : 1;
  const viewCap = Math.max(1, Math.min(STATUS_VIEW_ROWS, bodyRows - headerRows));
  const total = snapshot.statuses.length;
  const maxScroll = Math.max(0, total - viewCap);
  const scroll = Math.min(snapshot.statusScroll, maxScroll);
  const end = total - scroll;
  const start = Math.max(0, end - viewCap);
  const visible = snapshot.statuses.slice(start, end);
  const lastSync = snapshot.lastSync !== null ? snapshot.lastSync.slice(0, 10) : "never";
  const scrollHint = scroll > 0 ? ` \u00b7 line ${start + 1}-${Math.min(end, total)}/${total}` : "";

  const finished = counts.DONE + counts.FAILED;
  const activeTotal = counts.CLONING + counts.PULLING + finished;
  const pct = activeTotal > 0 ? Math.min(100, Math.round((finished / activeTotal) * 100)) : 0;
  const filled = Math.round((pct / 100) * 12);
  const progressBar = `${"\u2588".repeat(filled)}${"\u2591".repeat(12 - filled)} ${pct}%`;

  return (
    <>
      {snapshot.running && bodyRows >= 2 ? (
        <PanelLine text={`Progress: [${progressBar}]`} fg={theme.accent()} maxCols={maxCols} />
      ) : null}
      <PanelLine
        text={`${counts.CLONING} cloning \u00b7 ${counts.PULLING} pulling \u00b7 ${counts.DONE} done \u00b7 ${counts.FAILED} failed \u00b7 last sync: ${lastSync}${scrollHint}`}
        fg={dimFg}
        maxCols={maxCols}
      />
      {bodyRows > headerRows
        ? visible.map((status) => (
            <PanelLine
              key={status.id}
              text={`[${status.phase}] ${status.key}${status.message !== undefined ? ` \u2014 ${status.message}` : ""}`}
              fg={theme.phaseColor(status.phase)}
              maxCols={maxCols}
            />
          ))
        : null}
      {bodyRows > headerRows && visible.length === 0 ? (
        <PanelLine text="no activity yet" fg={dimFg} maxCols={maxCols} />
      ) : null}
    </>
  );
}

function renderInspectorBody(snapshot: StoreSnapshot, maxCols: number, bodyRows: number) {
  const dimFg = theme.dim();
  const insp = snapshot.inspector;
  if (insp === null) {
    return (
      <PanelLine text="highlight a repository to inspect Git state" fg={dimFg} maxCols={maxCols} />
    );
  }
  if (insp.loading) {
    return <PanelLine text={`inspecting ${insp.key}\u2026`} fg={dimFg} maxCols={maxCols} />;
  }
  const tags: string[] = [];
  if (insp.pinned) tags.push("\u2605 pinned");
  if (insp.alias !== null) tags.push(`@${insp.alias}`);
  if (insp.worktree) tags.push("worktree");
  if (insp.missing) tags.push("missing");

  const lines: Array<{ id: string; text: string; fg: string | undefined }> = [];
  if (!insp.tracked) {
    lines.push({ id: "key", text: insp.key, fg: theme.normal() });
    lines.push({
      id: "hint",
      text: "not cloned locally \u2014 press Space + Enter or c to clone",
      fg: dimFg,
    });
  } else if (insp.missing) {
    lines.push({ id: "key", text: `${insp.key} [MISSING]`, fg: theme.error() });
    lines.push({ id: "path", text: `expected at: ${insp.relativePath ?? "?"}`, fg: dimFg });
  } else {
    lines.push({
      id: "key",
      text: `${insp.key}${tags.length > 0 ? ` (${tags.join(" \u00b7 ")})` : ""}`,
      fg: theme.accent(),
    });
    lines.push({ id: "path", text: `path: ${insp.relativePath ?? "?"}`, fg: dimFg });
    const details = insp.details;
    if (details !== null) {
      const maxChanged = Math.max(
        1,
        ...(details.modifiedFiles.map((f) => (f.added ?? 0) + (f.removed ?? 0)) ?? [1]),
      );
      lines.push({
        id: "branch",
        text: `branch: ${details.branch || "HEAD"}${details.upstream ? ` -> ${details.upstream}` : ""} \u00b7 \u2191${details.ahead} \u2193${details.behind} \u00b7 ${details.isClean ? "clean" : "dirty"}`,
        fg: details.isClean ? theme.success() : theme.warning(),
      });
      for (const f of details.modifiedFiles.slice(0, 6)) {
        lines.push({
          id: `m:${f.path}`,
          text: `  M ${f.path} ${formatDiffBar(f.added, f.removed, maxChanged, 8)}`,
          fg: theme.warning(),
        });
      }
      for (const u of details.untrackedFiles.slice(0, 4)) {
        lines.push({ id: `u:${u}`, text: `  ? ${u}`, fg: dimFg });
      }
      for (const c of details.outgoingCommits.slice(0, 4)) {
        lines.push({
          id: `c:${c.hash}`,
          text: `  \u2191 ${c.hash} ${c.subject}`,
          fg: theme.info(),
        });
      }
    } else {
      lines.push({ id: "err", text: "unable to read git status", fg: dimFg });
    }
  }

  return (
    <>
      {lines.slice(0, Math.max(1, bodyRows)).map((row) => (
        <PanelLine key={row.id} text={row.text} fg={row.fg} maxCols={maxCols} />
      ))}
    </>
  );
}

function renderHealthBody(
  snapshot: StoreSnapshot,
  store: Store,
  maxCols: number,
  bodyRows: number,
) {
  const dimFg = theme.dim();
  const health = snapshot.healthData;
  if (health === null || (health.loading && health.stats === null)) {
    return <PanelLine text={"scanning workspace health\u2026"} fg={dimFg} maxCols={maxCols} />;
  }
  const stats = health.stats;
  const summaryLines: Array<{ id: string; text: string; fg: string | undefined }> = [];
  if (stats !== null && bodyRows >= 5) {
    summaryLines.push({
      id: "disk",
      text: `disk: ${stats.disk.repoCount} repos \u00b7 ${formatDiskSize(stats.disk.totalSizeBytes)}`,
      fg: theme.normal(),
    });
    summaryLines.push({
      id: "stale",
      text: `stale (>=180d): ${stats.stale.totalStale} \u00b7 trash: ${health.trashCount} (${formatDiskSize(health.trashBytes)})`,
      fg: dimFg,
    });
    if (bodyRows >= 7) {
      summaryLines.push({
        id: "langs",
        text: `top langs: ${
          stats.languages
            .slice(0, 3)
            .map((l) => `${l.language}(${l.count})`)
            .join(", ") || "none"
        }`,
        fg: dimFg,
      });
    }
  }

  const checkBudget = Math.max(1, bodyRows - summaryLines.length - 1);
  const totalChecks = health.checks.length;
  const maxScroll = Math.max(0, totalChecks - checkBudget);
  const scroll = Math.min(snapshot.statusScroll, maxScroll);
  const start = scroll;
  const end = Math.min(totalChecks, start + checkBudget);
  const visibleChecks = health.checks.slice(start, end);
  const scrollSuffix =
    totalChecks > checkBudget ? ` \u00b7 ${start + 1}-${end}/${totalChecks}` : "";

  return (
    <>
      {summaryLines.map((line) => (
        <PanelLine key={line.id} text={line.text} fg={line.fg} maxCols={maxCols} />
      ))}
      {visibleChecks.map((chk, idx) => {
        const fg =
          chk.status === "ok"
            ? theme.success()
            : chk.status === "warn"
              ? theme.warning()
              : theme.error();
        return (
          <PanelLine
            key={`${chk.check}:${chk.workspaceRoot ?? idx}`}
            text={`[${chk.status}] ${chk.check}: ${chk.detail}`}
            fg={fg}
            maxCols={maxCols}
          />
        );
      })}
      {bodyRows >= 2 ? (
        <PanelLine
          text={`[F] Run Doctor Auto-Fix${scrollSuffix}`}
          fg={theme.accent()}
          maxCols={maxCols}
          onMouseDown={(e) => {
            e.stopPropagation();
            void store.runHealthDoctorFix();
          }}
        />
      ) : null}
    </>
  );
}

export function StatusPanel({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height } = useTerminalDimensions();
  const dimFg = theme.dim();
  const maxCols = Math.max(8, width - 2);
  const bodyRows = Math.max(1, repoViewportRows(height, snapshot.updateToast !== null));
  const compactTabs = maxCols < 34;

  return (
    <box
      title="Status"
      border
      borderColor={snapshot.focus === "status" ? theme.focusBorder() : theme.border()}
      width={width}
      overflow="hidden"
      flexDirection="column"
      onMouseDown={() => {
        store.setFocus("status");
      }}
      onMouseScroll={(e) => {
        e.stopPropagation();
        store.setFocus("status");
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        const delta = snapshot.rightPaneTab === "health" ? (isUp ? -1 : 1) : isUp ? 3 : -3;
        store.moveStatusScroll(delta);
      }}
    >
      <box flexDirection="row" gap={1} height={1} flexShrink={0}>
        {TABS.map((tab) => {
          const active = snapshot.rightPaneTab === tab.id;
          const label = compactTabs ? tab.shortLabel : tab.label;
          return (
            <text
              key={tab.id}
              wrapMode="none"
              flexShrink={0}
              fg={active ? theme.cursorFg() : dimFg}
              bg={active ? theme.cursorBg() : undefined}
              onMouseDown={(e) => {
                e.stopPropagation();
                store.setRightPaneTab(tab.id);
              }}
            >
              {active ? ` ${label} ` : label}
            </text>
          );
        })}
      </box>
      {snapshot.rightPaneTab === "activity"
        ? renderActivityBody(snapshot, maxCols, bodyRows)
        : snapshot.rightPaneTab === "inspector"
          ? renderInspectorBody(snapshot, maxCols, bodyRows)
          : renderHealthBody(snapshot, store, maxCols, bodyRows)}
    </box>
  );
}

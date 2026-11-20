import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatDiskSize } from "../../services/stats.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyJson } from "../ui/JsonCopy.ts";
import { clampBoxLine, visibleSlice } from "../windowing.ts";

/**
 * `repotruck stats --health` as a page: health scorecard with grades and
 * recommendations, language/category/disk breakdowns, stale repositories
 * and the doctor checks.
 */
export function StatsView({
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
  const page = snapshot.statsPage;
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (page === null) void store.refreshStatsPage();
  }, [page, store]);

  const stats = page?.stats ?? null;
  const health = page?.health ?? null;
  const checks = page?.checks ?? [];
  const inner = Math.max(20, width - 2);
  const stacked = width < 76;
  const colMaxCols = stacked ? width : Math.max(16, Math.floor((width - 1) / 2));
  const barLen = inner < 50 ? 6 : 12;
  const bar = (ratio: number): string => {
    const filled = Math.round(Math.max(0, Math.min(1, ratio)) * barLen);
    return `${"█".repeat(filled)}${"░".repeat(barLen - filled)}`;
  };
  // Top scorecards (4 rows) + grade line (1 row) + footer line (1 row) = 6 rows.
  const bodyRows = Math.max(4, height - 6);
  const langCap = Math.max(2, Math.min(10, bodyRows - 4));
  const recCount = health?.recommendations.length ?? 0;
  const recReserved =
    recCount > 0 ? Math.min(recCount + 1, Math.max(2, Math.floor(bodyRows / 2))) : 0;
  const checkCap = Math.max(2, bodyRows - 1 - recReserved);
  const maxCursor = Math.max(0, checks.length - 1);
  const clampedCursor = Math.min(cursor, maxCursor);
  const checkWin = visibleSlice(clampedCursor, checks.length, checkCap);
  const visibleChecks = checks.slice(checkWin.start, checkWin.end);
  const focused =
    !snapshot.navFocused &&
    snapshot.dialog === null &&
    snapshot.modal === null &&
    snapshot.contextMenu === null;

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
      void store.refreshStatsPage();
    } else if (key.name === "up" || key.sequence === "k") {
      setCursor((c) => Math.max(0, Math.min(c, maxCursor) - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setCursor((c) => Math.min(maxCursor, Math.min(c, maxCursor) + 1));
    } else if (key.name === "home" || key.sequence === "g") {
      setCursor(0);
    } else if (
      key.name === "end" ||
      key.sequence === "G" ||
      (key.shift === true && key.name === "g")
    ) {
      setCursor(maxCursor);
    } else if (key.name === "pageup") {
      setCursor((c) => Math.max(0, Math.min(c, maxCursor) - Math.max(1, checkCap)));
    } else if (key.name === "pagedown") {
      setCursor((c) => Math.min(maxCursor, Math.min(c, maxCursor) + Math.max(1, checkCap)));
    } else if (key.name === "J" || key.sequence === "J") {
      const result = copyJson("stats", {
        command: "stats",
        ok: true,
        stats: page?.stats ?? null,
        health: page?.health ?? null,
      });
      store.pushStatus(result.ok ? "DONE" : "FAILED", "[stats]", result.message);
    }
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) =>
          Math.min(maxCursor, Math.max(0, Math.min(c, maxCursor) + (isUp ? -1 : 1))),
        );
      }}
    >
      <box flexDirection="row" gap={1} flexWrap="wrap" flexShrink={0}>
        {health !== null
          ? Object.entries(health.breakdown).map(([dimension, entry]) => (
              <box
                key={dimension}
                border
                borderColor={theme.border()}
                flexDirection="column"
                padding={0}
                flexShrink={0}
              >
                <text fg={theme.accent()} wrapMode="none" flexShrink={0}>{` ${dimension} `}</text>
                <text
                  wrapMode="none"
                  flexShrink={0}
                  fg={
                    entry.score / entry.max >= 0.8
                      ? theme.success()
                      : entry.score / entry.max >= 0.5
                        ? theme.warning()
                        : theme.error()
                  }
                >
                  {` ${entry.score}/${entry.max} ${bar(entry.score / entry.max)} `}
                </text>
              </box>
            ))
          : null}
      </box>
      <text
        wrapMode="none"
        flexShrink={0}
        fg={
          health !== null
            ? health.grade.startsWith("A")
              ? theme.success()
              : theme.warning()
            : theme.dim()
        }
      >
        {clampBoxLine(
          page?.loading
            ? "computing workspace stats…"
            : health !== null
              ? `grade: ${health.grade} · ${health.summary}`
              : "no stats",
          width,
        )}
      </text>
      {stats !== null ? (
        <box
          flexDirection={stacked ? "column" : "row"}
          flexGrow={1}
          gap={stacked ? 0 : 1}
          width="100%"
          overflow="hidden"
        >
          <box
            flexDirection="column"
            width={stacked ? "100%" : undefined}
            flexGrow={stacked ? 0 : 1}
            flexBasis={stacked ? undefined : 0}
            overflow="hidden"
          >
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {"languages"}
            </text>
            {stats.languages.slice(0, langCap).map((lang) => (
              <text key={lang.language} fg={theme.normal()} wrapMode="none" flexShrink={0}>
                {clampBoxLine(
                  ` ${lang.language.slice(0, 12).padEnd(12)} ${bar(lang.count / (stats.languages[0]?.count ?? 1))} ${lang.count}`,
                  colMaxCols,
                )}
              </text>
            ))}
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {clampBoxLine(
                `categories: source ${stats.categories.source} · forks ${stats.categories.forks} · archived ${stats.categories.archived} · custom ${stats.categories.custom}`,
                colMaxCols,
              )}
            </text>
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {clampBoxLine(
                `disk: ${stats.disk.repoCount} repos · ${formatDiskSize(stats.disk.totalSizeBytes)}`,
                colMaxCols,
              )}
            </text>
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {clampBoxLine(`stale ≥180d: ${stats.stale.totalStale}`, colMaxCols)}
            </text>
            {stats.stale.topStalest
              .slice(
                0,
                Math.max(1, Math.min(5, bodyRows - 4 - Math.min(stats.languages.length, langCap))),
              )
              .map((stale) => (
                <text key={stale.key} fg={theme.normal()} wrapMode="none" flexShrink={0}>
                  {clampBoxLine(` ${stale.key} · ${stale.days}d`, colMaxCols)}
                </text>
              ))}
          </box>
          <box
            flexDirection="column"
            flexGrow={1}
            flexBasis={stacked ? undefined : 0}
            overflow="hidden"
          >
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {"doctor checks"}
            </text>
            {visibleChecks.map((check, offset) => {
              const idx = checkWin.start + offset;
              const isCursor = focused && idx === clampedCursor;
              const baseFg =
                check.status === "ok"
                  ? theme.success()
                  : check.status === "warn"
                    ? theme.warning()
                    : theme.error();
              return (
                <text
                  key={check.check}
                  wrapMode="none"
                  flexShrink={0}
                  fg={isCursor ? theme.cursorFg() : baseFg}
                  bg={isCursor ? theme.cursorBg() : undefined}
                  onMouseDown={() => setCursor(idx)}
                >
                  {clampBoxLine(
                    `${isCursor ? ">" : " "}${check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "✗"} ${check.check}`,
                    colMaxCols,
                  )}
                </text>
              );
            })}
            {health !== null && health.recommendations.length > 0 ? (
              <box flexDirection="column" flexShrink={0}>
                <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
                  {"recommendations"}
                </text>
                {health.recommendations
                  .slice(0, Math.max(1, recReserved - 1))
                  .map((recommendation) => (
                    <text key={recommendation} fg={theme.normal()} wrapMode="none" flexShrink={0}>
                      {clampBoxLine(` - ${recommendation}`, colMaxCols)}
                    </text>
                  ))}
              </box>
            ) : null}
          </box>
        </box>
      ) : null}
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine("↑↓/jk scroll · r refresh · J copy JSON · Esc cockpit", width)}
      </text>
    </box>
  );
}

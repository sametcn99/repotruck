import { useKeyboard } from "@opentui/react";
import { useEffect, useSyncExternalStore } from "react";
import { formatDiskSize } from "../../services/stats.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyJson } from "../ui/JsonCopy.ts";

/**
 * `repotruck stats --health` as a page: health scorecard with grades and
 * recommendations, language/category/disk breakdowns, stale repositories
 * and the doctor checks.
 */
export function StatsView({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const page = snapshot.statsPage;

  useEffect(() => {
    if (page === null) void store.refreshStatsPage();
  }, [page, store]);

  useKeyboard((key) => {
    if (key.name === "r") void store.refreshStatsPage();
    else if (key.name === "J" || key.sequence === "J") {
      const result = copyJson("stats", {
        command: "stats",
        ok: true,
        stats: page?.stats ?? null,
        health: page?.health ?? null,
      });
      store.pushStatus(result.ok ? "DONE" : "FAILED", "[stats]", result.message);
    }
  });

  const stats = page?.stats ?? null;
  const health = page?.health ?? null;
  const inner = Math.max(24, width - 4);
  const bar = (ratio: number): string => {
    const filled = Math.round(Math.max(0, Math.min(1, ratio)) * 12);
    return `${"█".repeat(filled)}${"░".repeat(12 - filled)}`;
  };

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" gap={2} flexWrap="wrap">
        {health !== null
          ? Object.entries(health.breakdown).map(([dimension, entry]) => (
              <box
                key={dimension}
                border
                borderColor={theme.border()}
                flexDirection="column"
                padding={0}
              >
                <text fg={theme.accent()}>{` ${dimension}`}</text>
                <text
                  fg={
                    entry.score / entry.max >= 0.8
                      ? theme.success()
                      : entry.score / entry.max >= 0.5
                        ? theme.warning()
                        : theme.error()
                  }
                >
                  {` ${entry.score}/${entry.max} ${bar(entry.score / entry.max)}`}
                </text>
              </box>
            ))
          : null}
      </box>
      <text
        fg={
          health !== null
            ? health.grade.startsWith("A")
              ? theme.success()
              : theme.warning()
            : theme.dim()
        }
      >
        {page?.loading
          ? "computing workspace stats…"
          : health !== null
            ? `grade: ${health.grade} · ${health.summary}`
            : "no stats"}
      </text>
      {stats !== null ? (
        <box flexDirection="row" flexGrow={1} gap={1}>
          <box flexDirection="column" width={Math.floor(inner / 2)}>
            <text fg={theme.dim()}>{"languages"}</text>
            {stats.languages.slice(0, 8).map((lang) => (
              <text key={lang.language} fg={theme.normal()}>
                {` ${lang.language.padEnd(12)} ${bar(lang.count / (stats.languages[0]?.count ?? 1))} ${lang.count}`}
              </text>
            ))}
            <text
              fg={theme.dim()}
            >{`categories: source ${stats.categories.source} · forks ${stats.categories.forks} · archived ${stats.categories.archived} · custom ${stats.categories.custom}`}</text>
            <text fg={theme.dim()}>
              {`disk: ${stats.disk.repoCount} repos · ${formatDiskSize(stats.disk.totalSizeBytes)}`}
            </text>
            <text fg={theme.dim()}>{`stale ≥180d: ${stats.stale.totalStale}`}</text>
            {stats.stale.topStalest.slice(0, 5).map((stale) => (
              <text key={stale.key} fg={theme.normal()}>
                {` ${stale.key} · ${stale.days}d`}
              </text>
            ))}
          </box>
          <box flexDirection="column" flexGrow={1}>
            <text fg={theme.dim()}>{"doctor checks"}</text>
            {(page?.checks ?? []).map((check) => (
              <text
                key={check.check}
                fg={
                  check.status === "ok"
                    ? theme.success()
                    : check.status === "warn"
                      ? theme.warning()
                      : theme.error()
                }
              >
                {` ${check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "✗"} ${check.check}`}
              </text>
            ))}
            {health !== null && health.recommendations.length > 0 ? (
              <box flexDirection="column">
                <text fg={theme.dim()}>{"recommendations"}</text>
                {health.recommendations.slice(0, 6).map((recommendation) => (
                  <text key={recommendation} fg={theme.normal()}>
                    {` - ${recommendation}`}
                  </text>
                ))}
              </box>
            ) : null}
          </box>
        </box>
      ) : null}
      <text fg={theme.dim()}>{"r refresh · J copy JSON · Esc cockpit"}</text>
    </box>
  );
}

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatDiskSize } from "../../services/stats.ts";
import type { Store, StoreSnapshot } from "../store.ts";
import { theme } from "../theme.ts";
import { copyJson } from "../ui/JsonCopy.ts";
import { clampBoxLine, scrollSlice } from "../windowing.ts";

type StatsPage = NonNullable<StoreSnapshot["statsPage"]>;
type Section = "breakdown" | "checks";
type StatLine = { label: string; color?: string | undefined };

function breakdownLines(stats: StatsPage["stats"], health: StatsPage["health"]): StatLine[] {
  if (stats === null) return [];
  return [
    ...Object.entries(health?.breakdown ?? {}).map(([name, entry]) => ({
      label: `${name}: ${entry.score}/${entry.max}`,
    })),
    { label: "Languages", color: theme.accent() },
    ...stats.languages.map((lang) => ({ label: ` ${lang.language}: ${lang.count}` })),
    { label: "Categories", color: theme.accent() },
    ...Object.entries(stats.categories).map(([name, count]) => ({ label: ` ${name}: ${count}` })),
    { label: `Disk: ${stats.disk.repoCount} repos · ${formatDiskSize(stats.disk.totalSizeBytes)}` },
    { label: `Stale ≥180d: ${stats.stale.totalStale}` },
    ...stats.stale.topStalest.map((repo) => ({ label: ` ${repo.key} · ${repo.days}d` })),
  ];
}

function checkLines(checks: StatsPage["checks"], health: StatsPage["health"]): StatLine[] {
  const lines = checks.map((check) => ({
    label: check.formatted,
    color:
      check.status === "ok"
        ? theme.success()
        : check.status === "warn"
          ? theme.warning()
          : theme.error(),
  }));
  if (health !== null && health.recommendations.length > 0) {
    lines.push({ label: "Recommendations", color: theme.accent() });
    lines.push(
      ...health.recommendations.map((label) => ({ label: ` · ${label}`, color: theme.normal() })),
    );
  }
  return lines;
}

/** Workspace health and repository statistics, with independently scrollable sections. */
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
  const page = snapshot.statsPage;
  const [section, setSection] = useState<Section>("breakdown");
  const [offsets, setOffsets] = useState({ breakdown: 0, checks: 0 });

  useEffect(() => {
    if (page === null) void store.refreshStatsPage();
  }, [page, store]);

  const health = page?.health ?? null;
  const compact = width < 76;
  const bodyRows = Math.max(1, (heightProp ?? termHeight - 11) - 5);
  const sections = {
    breakdown: breakdownLines(page?.stats ?? null, health),
    checks: checkLines(page?.checks ?? [], health),
  };
  const focused = !snapshot.navFocused && snapshot.modal === null && snapshot.dialog === null;

  const scroll = (name: Section, delta: number) => {
    const max = Math.max(0, sections[name].length - bodyRows);
    setOffsets((current) => ({
      ...current,
      [name]: Math.max(0, Math.min(max, Math.min(current[name], max) + delta)),
    }));
  };
  const copy = () => {
    const result = copyJson("stats", { command: "stats", ok: true, stats: page?.stats, health });
    store.pushStatus(result.ok ? "DONE" : "FAILED", "[stats]", result.message);
  };

  useKeyboard((key) => {
    const current = store.getSnapshot();
    if (current.navFocused || current.modal !== null || current.dialog !== null) return;
    if (key.name === "tab") setSection(section === "breakdown" ? "checks" : "breakdown");
    else if (key.name === "left") setSection("breakdown");
    else if (key.name === "right") setSection("checks");
    else if (key.name === "up" || key.sequence === "k") scroll(section, -1);
    else if (key.name === "down" || key.sequence === "j") scroll(section, 1);
    else if (key.name === "pageup") scroll(section, -bodyRows);
    else if (key.name === "pagedown") scroll(section, bodyRows);
    else if (key.name === "home") scroll(section, -sections[section].length);
    else if (key.name === "end") scroll(section, sections[section].length);
    else if (key.name === "r") void store.refreshStatsPage();
    else if (key.sequence === "J" || (key.shift && key.name === "j")) copy();
  });

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          page?.loading
            ? "Computing workspace stats…"
            : health !== null
              ? `grade: ${health.grade} · ${health.summary}`
              : "No stats",
          width,
        )}
      </text>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine("Tab section · ↑↓ scroll · [r] Refresh · [J] JSON", width)}
      </text>
      <box flexDirection="row" flexGrow={1} gap={1} width="100%" overflow="hidden">
        {(["breakdown", "checks"] as const).map((name) => {
          if (compact && name !== section) return null;
          const rows = sections[name];
          const win = scrollSlice(offsets[name], rows.length, bodyRows);
          const title = name === "breakdown" ? "Breakdown" : "Doctor checks";
          return (
            <box
              key={name}
              border
              borderColor={focused && section === name ? theme.focusBorder() : theme.border()}
              flexDirection="column"
              flexGrow={1}
              flexBasis={0}
              overflow="hidden"
              onMouseDown={() => setSection(name)}
              onMouseScroll={(event) => {
                event.stopPropagation();
                setSection(name);
                scroll(name, event.scroll?.direction === "up" || event.button === 4 ? -1 : 1);
              }}
            >
              <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
                {rows.length > 0
                  ? ` ${title} · ${win.start + 1}–${win.end}/${rows.length}`
                  : ` ${title}`}
              </text>
              {rows.slice(win.start, win.end).map(({ label, color }, offset) => (
                <text
                  // biome-ignore lint/suspicious/noArrayIndexKey: section content consists of immutable text rows
                  key={win.start + offset}
                  fg={color ?? theme.normal()}
                  wrapMode="none"
                  flexShrink={0}
                >
                  {clampBoxLine(label, (compact ? width : Math.floor((width - 1) / 2)) - 2)}
                </text>
              ))}
            </box>
          );
        })}
      </box>
    </box>
  );
}

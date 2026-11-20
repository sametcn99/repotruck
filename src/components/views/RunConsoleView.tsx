import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyJson } from "../ui/JsonCopy.ts";
import { visibleSlice } from "../windowing.ts";

/**
 * `repotruck run` as a page: shell command with quoted-argument tokenizing,
 * scope selector (selection / pinned / profile / all), concurrency and
 * per-repo results with expandable output.
 */
export function RunConsoleView({
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
  const state = snapshot.runConsole;
  const [editing, setEditing] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scrollIdx, setScrollIdx] = useState(0);

  useEffect(() => {
    if (state === null) store.updateRunConsole({});
  }, [state, store]);

  const scope = state?.scope ?? "selection";
  const running = state?.running ?? false;
  const results = state?.results ?? [];
  const skipped = state?.skipped ?? [];
  const failed = results.filter((r) => !r.ok).length;
  const totalItems = results.length + skipped.length;

  useKeyboard((key) => {
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "return") setEditing(true);
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(Math.max(0, totalItems - 1), s + 1));
    } else if (key.name === "e" && state?.running !== true) {
      void store.runConsoleStart();
    } else if (key.name === "s") {
      store.updateRunConsole({
        scope:
          state?.scope === "selection"
            ? "pinned"
            : state?.scope === "pinned"
              ? "profile"
              : state?.scope === "profile"
                ? "all"
                : "selection",
      });
    } else if (key.name === "J" || key.sequence === "J") {
      const result = copyJson("run", {
        command: "run",
        ok: true,
        results: state?.results ?? [],
        skipped: state?.skipped ?? [],
      });
      store.pushStatus(result.ok ? "DONE" : "FAILED", "[run]", result.message);
    }
  });

  const scopeLabel =
    scope === "selection"
      ? `selection (${snapshot.selected.size})`
      : scope === "pinned"
        ? `pinned (${snapshot.pinnedCount})`
        : scope === "profile"
          ? `profile: ${state?.profile || "—"}`
          : "all tracked";

  const cliParts = ["repotruck run"];
  if (scope === "pinned") cliParts.push("--pinned");
  if (scope === "profile" && state?.profile) cliParts.push(`--profile ${state.profile}`);
  if ((state?.concurrency ?? 3) !== 3) cliParts.push(`-c ${state?.concurrency}`);
  cliParts.push(`-- ${state?.command || "<command>"}`);

  const viewportRows = Math.max(2, height - 12);
  const win = visibleSlice(
    Math.min(scrollIdx, Math.max(0, results.length - 1)),
    results.length,
    viewportRows,
  );
  const visibleResults = results.slice(win.start, win.end);
  const remainingRows = Math.max(0, viewportRows - visibleResults.length);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(Math.max(0, totalItems - 1), Math.max(0, s + (isUp ? -2 : 2))),
        );
      }}
    >
      <box flexDirection="row" flexWrap="wrap" gap={1}>
        <text fg={theme.dim()}>$</text>
        {editing ? (
          <input
            focused
            value={state?.command ?? ""}
            onInput={(value) => store.updateRunConsole({ command: value })}
            onSubmit={() => {
              setEditing(false);
              void store.runConsoleStart();
            }}
            width={Math.max(14, Math.min(54, width - 16))}
          />
        ) : (
          <text
            fg={theme.accent()}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              setEditing(true);
            }}
          >
            {state?.command || "(enter a command)"}
          </text>
        )}
        <text
          fg={theme.normal()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            if (!running) void store.runConsoleStart();
          }}
        >
          {running ? "running…" : "[e] Run"}
        </text>
      </box>
      <box flexDirection="row" gap={1} flexWrap="wrap">
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.updateRunConsole({
              scope:
                scope === "selection"
                  ? "pinned"
                  : scope === "pinned"
                    ? "profile"
                    : scope === "profile"
                      ? "all"
                      : "selection",
            });
          }}
        >
          {`[s] scope: ${scopeLabel}`}
        </text>
        <text
          fg={theme.normal()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.updateRunConsole({ concurrency: nextConc(state?.concurrency ?? 3) });
          }}
        >
          {`-c ${state?.concurrency ?? 3}`}
        </text>
        {scope === "profile" ? (
          <input
            value={state?.profile ?? ""}
            onInput={(value) => store.updateRunConsole({ profile: value })}
            width={16}
            placeholder="profile"
          />
        ) : null}
        <text
          fg={theme.dim()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            const result = copyJson("run", { command: "run", ok: true, results, skipped });
            store.pushStatus(result.ok ? "DONE" : "FAILED", "[run]", result.message);
          }}
        >
          {"[J] copy JSON"}
        </text>
      </box>
      <box border borderColor={theme.border()} overflow="hidden">
        <text fg={theme.accent()} wrapMode="none">{` ${cliParts.join(" ")}`}</text>
      </box>
      <box
        border
        borderColor={theme.border()}
        flexDirection="column"
        flexGrow={1}
        padding={0}
        overflow="hidden"
      >
        <text fg={failed > 0 ? theme.error() : theme.dim()} wrapMode="none">
          {running
            ? " running across repositories…"
            : ` ${results.length} results · ${failed} failed · ${skipped.length} skipped`}
        </text>
        {visibleResults.map((result) => (
          <box key={result.key} flexDirection="column">
            <text
              fg={result.ok ? theme.normal() : theme.error()}
              wrapMode="none"
              onMouseDown={(event) => {
                event.stopPropagation?.();
                setExpanded((current) => (current === result.key ? null : result.key));
              }}
            >
              {` ${result.ok ? "✓" : "✗"} ${result.key} · exit ${result.exitCode ?? "—"} · ${result.durationMs}ms`}
            </text>
            {expanded === result.key ? (
              <text fg={theme.dim()} wrapMode="none">
                {`   ${(result.stderr || result.stdout || result.message || "(no output)").split("\n")[0]}`}
              </text>
            ) : null}
          </box>
        ))}
        {skipped.slice(0, remainingRows).map((entry) => (
          <text key={entry.key} fg={theme.dim()} wrapMode="none">
            {` · ${entry.key} — ${entry.message}`}
          </text>
        ))}
      </box>
      <text fg={theme.dim()} wrapMode="none">
        {"Enter edit command · e run · s scope · J JSON · click result for output · Esc cockpit"}
      </text>
    </box>
  );
}

const CONCS = [1, 2, 3, 5, 8];
function nextConc(current: number): number {
  return CONCS[(CONCS.indexOf(current) + 1) % CONCS.length]!;
}

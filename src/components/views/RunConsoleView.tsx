import { useKeyboard } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyJson } from "../ui/JsonCopy.ts";

/**
 * `repotruck run` as a page: shell command with quoted-argument tokenizing,
 * scope selector (selection / pinned / profile / all), concurrency and
 * per-repo results with expandable output.
 */
export function RunConsoleView({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const state = snapshot.runConsole;
  const [editing, setEditing] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (state === null) store.updateRunConsole({});
  }, [state, store]);

  useKeyboard((key) => {
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "return") setEditing(true);
    else if (key.name === "e" && state?.running !== true) {
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

  const scope = state?.scope ?? "selection";
  const running = state?.running ?? false;
  const results = state?.results ?? [];
  const skipped = state?.skipped ?? [];
  const failed = results.filter((r) => !r.ok).length;
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

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" gap={1}>
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
            width={Math.max(30, width - 60)}
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
      <box border borderColor={theme.border()}>
        <text fg={theme.accent()}>{` ${cliParts.join(" ")}`}</text>
      </box>
      <text fg={failed > 0 ? theme.error() : theme.dim()}>
        {running
          ? "running across repositories…"
          : `${results.length} results · ${failed} failed · ${skipped.length} skipped`}
      </text>
      <box flexDirection="column" flexGrow={1}>
        {results.map((result) => (
          <box key={result.key} flexDirection="column">
            <text
              fg={result.ok ? theme.normal() : theme.error()}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                setExpanded((current) => (current === result.key ? null : result.key));
              }}
            >
              {`${result.ok ? "✓" : "✗"} ${result.key} · exit ${result.exitCode ?? "—"} · ${result.durationMs}ms`}
            </text>
            {expanded === result.key ? (
              <text fg={theme.dim()}>
                {`   ${(result.stderr || result.stdout || result.message || "(no output)").split("\n")[0]}`}
              </text>
            ) : null}
          </box>
        ))}
        {skipped.map((entry) => (
          <text key={entry.key} fg={theme.dim()}>
            {`· ${entry.key} — ${entry.message}`}
          </text>
        ))}
      </box>
      <text fg={theme.dim()}>
        {"Enter edit command · e run · s scope · J JSON · click result for output · Esc cockpit"}
      </text>
    </box>
  );
}

const CONCS = [1, 2, 3, 5, 8];
function nextConc(current: number): number {
  return CONCS[(CONCS.indexOf(current) + 1) % CONCS.length]!;
}

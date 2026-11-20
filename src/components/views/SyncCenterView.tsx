import { useKeyboard } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { syncCenterCliLine } from "../store/StoreCore.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { clampBoxLine } from "../windowing.ts";

/**
 * `repotruck sync` with every flag: scope, limit, concurrency, depth,
 * blobless, stash, divergence, include/exclude globs and watch — plus the
 * live CLI line and the cockpit's preview/start flow one key away.
 */
export function SyncCenterView({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const state = snapshot.syncCenter;
  const [editing, setEditing] = useState<null | "include" | "exclude">(null);

  useEffect(() => {
    if (state === null) store.updateSyncCenter({});
  }, [state, store]);

  useKeyboard((key) => {
    if (editing !== null) {
      if (key.name === "escape") setEditing(null);
      return;
    }
    if (key.name === "e") void store.startSyncCenter();
    else if (key.name === "x") store.stopSyncCenter();
    else if (key.name === "s")
      store.updateSyncCenter({ scope: nextScope(state?.scope ?? "selection", snapshot.orgs) });
    else if (key.name === "d")
      store.updateSyncCenter({ divergence: nextDivergence(state?.divergence ?? "fail") });
    else if (key.name === "b") store.updateSyncCenter({ blobless: !(state?.blobless ?? false) });
    else if (key.name === "t") store.updateSyncCenter({ stash: !(state?.stash ?? false) });
    else if (key.name === "c")
      store.updateSyncCenter({ concurrency: nextOf([1, 2, 3, 5, 8], state?.concurrency ?? 3) });
    else if (key.name === "p")
      store.updateSyncCenter({ depth: nextOf([0, 1, 5, 10], state?.depth ?? 0) });
    else if (key.name === "l")
      store.updateSyncCenter({ limit: nextOf([0, 10, 20, 50, 100], state?.limit ?? 0) });
    else if (key.name === "i") setEditing("include");
    else if (key.name === "x2") setEditing("exclude");
  });

  if (state === null) return null;
  const running = state.running || snapshot.running;
  const inner = Math.max(20, width - 4);
  const boxInnerCols = Math.max(12, width - 3);

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" gap={1} flexWrap="wrap" flexShrink={0}>
        <text fg={theme.accent()} flexShrink={0}>{`[s] scope: ${state.scope}`}</text>
        <text
          fg={theme.normal()}
          flexShrink={0}
        >{`[l] limit: ${state.limit === 0 ? "off" : state.limit}`}</text>
        <text fg={theme.normal()} flexShrink={0}>{`[c] -c ${state.concurrency}`}</text>
        <text
          fg={theme.normal()}
          flexShrink={0}
        >{`[p] depth: ${state.depth === 0 ? "off" : state.depth}`}</text>
        <text
          fg={state.blobless ? theme.accent() : theme.normal()}
          flexShrink={0}
        >{`[b] blobless: ${state.blobless ? "on" : "off"}`}</text>
        <text
          fg={state.stash ? theme.accent() : theme.normal()}
          flexShrink={0}
        >{`[t] stash: ${state.stash ? "on" : "off"}`}</text>
        <text fg={theme.normal()} flexShrink={0}>{`[d] divergence: ${state.divergence}`}</text>
      </box>
      <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
        <text
          fg={theme.normal()}
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            setEditing("include");
          }}
        >
          {`[i] include: ${state.include || "—"}`}
        </text>
        <text
          fg={theme.normal()}
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            setEditing("exclude");
          }}
        >
          {`[E] exclude: ${state.exclude || "—"}`}
        </text>
      </box>
      {editing !== null ? (
        <input
          focused
          value={editing === "include" ? state.include : state.exclude}
          onInput={(value) =>
            store.updateSyncCenter(editing === "include" ? { include: value } : { exclude: value })
          }
          onSubmit={() => setEditing(null)}
          width={Math.max(14, Math.min(50, inner - 10))}
        />
      ) : null}
      {state.divergence === "reset" ? (
        <text fg={theme.error()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(
            " divergence=reset discards local commits — double-check before running",
            width,
          )}
        </text>
      ) : null}
      <box border borderColor={theme.border()} overflow="hidden" flexShrink={0} width="100%">
        <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(` $ ${syncCenterCliLine(state)}`, boxInnerCols)}
        </text>
      </box>
      <box flexDirection="row" flexWrap="wrap" gap={2} flexShrink={0}>
        <text
          fg={running ? theme.dim() : theme.accent()}
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            if (!running) void store.startSyncCenter();
          }}
        >
          {running ? "running…" : "[e] Start Sync"}
        </text>
        {running ? (
          <text
            fg={theme.error()}
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation();
              store.stopSyncCenter();
            }}
          >
            {"[x] Stop"}
          </text>
        ) : null}
        <text
          fg={theme.dim()}
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            store.setView("cockpit");
            void store.openStartPreview();
          }}
        >
          {"[preview via cockpit Enter]"}
        </text>
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          "progress streams to the Activity panel · failures surface in Conflicts (v x) · Esc cockpit",
          width,
        )}
      </text>
    </box>
  );
}

function nextScope(current: string, orgs: readonly string[]): string {
  const options = ["selection", "user", ...orgs.map((org) => `org:${org}`), "all", "pinned"];
  return options[(options.indexOf(current) + 1) % options.length]!;
}
function nextDivergence(current: string): "fail" | "rebase" | "reset" | "skip" {
  const options = ["fail", "rebase", "reset", "skip"] as const;
  return options[(options.indexOf(current as "fail") + 1) % options.length]!;
}
function nextOf(options: readonly number[], current: number): number {
  return options[(options.indexOf(current) + 1) % options.length]!;
}

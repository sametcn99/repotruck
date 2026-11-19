import { useKeyboard } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";

/**
 * `repotruck discover` as a page: query with a qualifier strip, results
 * with tracked markers, per-row and bulk clone (depth/blobless options).
 */
export function DiscoverView({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const state = snapshot.discoverPage;
  const [editing, setEditing] = useState(true);

  useEffect(() => {
    if (state === null) store.updateDiscoverPage({});
  }, [state, store]);

  useKeyboard((key) => {
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "return") setEditing(true);
    else if (key.name === "s") void store.discoverSearch();
    else if (key.name === "a") {
      const page = store.getSnapshot().discoverPage;
      if (page !== null) {
        store.updateDiscoverPage({
          selected:
            page.selected.size === page.results.length
              ? new Set<string>()
              : new Set(page.results.map((repo) => `${repo.owner}/${repo.name}`)),
        });
      }
    } else if (key.name === "c") void store.discoverCloneSelected();
    else if (key.name === "l") {
      const limits = [10, 20, 50, 100, 200];
      const currentIdx = limits.indexOf(state?.limit ?? 20);
      store.updateDiscoverPage({ limit: limits[(currentIdx + 1) % limits.length]! });
    } else if (key.name === "b")
      store.updateDiscoverPage({ blobless: !(state?.blobless ?? false) });
  });

  if (state === null) return null;
  const tracked = new Set(snapshot.repos.map((repo) => `${repo.owner}/${repo.name}`.toLowerCase()));

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" gap={1}>
        <text fg={theme.dim()}>{"query:"}</text>
        {editing ? (
          <input
            focused
            value={state.query}
            onInput={(value) => store.updateDiscoverPage({ query: value })}
            onSubmit={() => {
              setEditing(false);
              void store.discoverSearch();
            }}
            width={Math.max(30, width - 60)}
          />
        ) : (
          <text
            fg={theme.accent()}
            onMouseDown={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
          >
            {state.query || "(Enter to edit — qualifiers like language:ts stars:>100 work)"}
          </text>
        )}
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.discoverSearch();
          }}
        >
          {"[s] search"}
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={theme.normal()}>{`[l] limit: ${state.limit}`}</text>
        <text
          fg={state.blobless ? theme.accent() : theme.normal()}
        >{`[b] blobless: ${state.blobless ? "on" : "off"}`}</text>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            const page = store.getSnapshot().discoverPage;
            if (page !== null) {
              store.updateDiscoverPage({
                selected:
                  page.selected.size === page.results.length
                    ? new Set<string>()
                    : new Set(page.results.map((repo) => `${repo.owner}/${repo.name}`)),
              });
            }
          }}
        >
          {"[a] select all"}
        </text>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.discoverCloneSelected();
          }}
        >
          {`[c] clone selected (${state.selected.size})`}
        </text>
      </box>
      <text fg={theme.dim()}>
        {state.loading ? "searching…" : `${state.results.length} results`}
      </text>
      <box flexDirection="column" flexGrow={1}>
        {state.results.map((repo) => {
          const key = `${repo.owner}/${repo.name}`;
          const isSelected = state.selected.has(key);
          const isTracked = tracked.has(key.toLowerCase());
          return (
            <text
              key={key}
              fg={isSelected ? theme.accent() : theme.normal()}
              onMouseDown={(event) => {
                event.stopPropagation();
                const next = new Set(state.selected);
                if (isSelected) next.delete(key);
                else next.add(key);
                store.updateDiscoverPage({ selected: next });
              }}
            >
              {` ${isSelected ? "[x]" : "[ ]"} ${key}${isTracked ? " · tracked" : ""} · ${repo.language ?? "—"} · ★${repo.stars ?? 0}${repo.description !== null ? ` · ${String(repo.description).slice(0, 40)}` : ""}`}
            </text>
          );
        })}
      </box>
      <text
        fg={theme.dim()}
        onMouseDown={(event) => {
          event.stopPropagation();
          copyText("discover CLI", `repotruck discover ${state.query} --clone`);
        }}
      >
        {"click rows to select · clone summary lands in Activity · Esc cockpit"}
      </text>
    </box>
  );
}

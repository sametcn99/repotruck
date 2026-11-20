import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";
import { clampBoxLine, scrollSlice } from "../windowing.ts";

/**
 * `repotruck discover` as a page: query with a qualifier strip, results
 * with tracked markers, per-row and bulk clone (depth/blobless options).
 */
export function DiscoverView({
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
  const height = heightProp ?? Math.max(8, termHeight - 11);
  const state = snapshot.discoverPage;
  const [editing, setEditing] = useState(true);
  const [scrollIdx, setScrollIdx] = useState(0);

  useEffect(() => {
    if (state === null) store.updateDiscoverPage({});
  }, [state, store]);

  const totalResults = state?.results.length ?? 0;
  // 2 top control rows + 2 box borders + 1 box header + 1 footer hint = 6 non-data rows.
  const viewportRows = Math.max(1, height - 6);
  const maxScroll = Math.max(0, totalResults - viewportRows);

  useKeyboard((key) => {
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "return") setEditing(true);
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, Math.min(s, maxScroll) - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(maxScroll, s + 1));
    } else if (key.name === "s") void store.discoverSearch();
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
  const inner = Math.max(20, width - 4);
  const boxInnerCols = Math.max(10, width - 3);
  const win = scrollSlice(scrollIdx, state.results.length, viewportRows);
  const visibleResults = state.results.slice(win.start, win.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(maxScroll, Math.max(0, Math.min(s, maxScroll) + (isUp ? -2 : 2))),
        );
      }}
    >
      <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {"query:"}
        </text>
        {editing ? (
          <input
            focused
            value={state.query}
            onInput={(value) => store.updateDiscoverPage({ query: value })}
            onSubmit={() => {
              setEditing(false);
              void store.discoverSearch();
            }}
            width={Math.max(14, Math.min(48, inner - 20))}
          />
        ) : (
          <text
            fg={theme.accent()}
            wrapMode="none"
            flexShrink={0}
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
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.discoverSearch();
          }}
        >
          {"[s] search"}
        </text>
      </box>
      <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
        <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
          {`[l] limit: ${state.limit}`}
        </text>
        <text fg={state.blobless ? theme.accent() : theme.normal()} wrapMode="none" flexShrink={0}>
          {`[b] blobless: ${state.blobless ? "on" : "off"}`}
        </text>
        <text
          fg={theme.accent()}
          wrapMode="none"
          flexShrink={0}
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
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.discoverCloneSelected();
          }}
        >
          {`[c] clone selected (${state.selected.size})`}
        </text>
      </box>
      <box
        border
        borderColor={theme.border()}
        flexDirection="column"
        flexGrow={1}
        width="100%"
        padding={0}
        overflow="hidden"
      >
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(
            state.loading
              ? " searching…"
              : ` ${state.results.length} results · ${state.selected.size} selected${
                  state.results.length > viewportRows
                    ? ` (showing ${win.start + 1}-${win.end}/${state.results.length})`
                    : ""
                }`,
            boxInnerCols,
          )}
        </text>
        {visibleResults.map((repo) => {
          const key = `${repo.owner}/${repo.name}`;
          const isSelected = state.selected.has(key);
          const isTracked = tracked.has(key.toLowerCase());
          const keyPad = boxInnerCols < 56 ? 18 : 28;
          const langPad = boxInnerCols < 56 ? 6 : 10;
          const rawLine = ` ${isSelected ? "[x]" : "[ ]"} ${key.padEnd(keyPad)}${isTracked ? " · tracked" : ""} · ${(repo.language ?? "—").padEnd(langPad)} · ★${String(repo.stars ?? 0).padStart(5)}${repo.description !== null ? ` · ${String(repo.description)}` : ""}`;
          return (
            <text
              key={key}
              fg={isSelected ? theme.accent() : theme.normal()}
              wrapMode="none"
              flexShrink={0}
              onMouseDown={(event) => {
                event.stopPropagation();
                const next = new Set(state.selected);
                if (isSelected) next.delete(key);
                else next.add(key);
                store.updateDiscoverPage({ selected: next });
              }}
            >
              {clampBoxLine(rawLine, boxInnerCols)}
            </text>
          );
        })}
      </box>
      <text
        fg={theme.dim()}
        wrapMode="none"
        flexShrink={0}
        onMouseDown={(event) => {
          event.stopPropagation();
          copyText("discover CLI", `repotruck discover ${state.query} --clone`);
        }}
      >
        {clampBoxLine(
          "click rows to select · clone summary lands in Activity · Esc cockpit",
          width,
        )}
      </text>
    </box>
  );
}

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";
import { clampBoxLine, visibleSlice } from "../windowing.ts";

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
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (state === null) store.updateDiscoverPage({});
  }, [state, store]);

  const totalResults = state?.results.length ?? 0;
  // 2 top control rows + 2 box borders + 1 box header + 1 footer hint = 6 non-data rows.
  const viewportRows = Math.max(1, height - 6);
  const maxCursor = Math.max(0, totalResults - 1);
  const clampedCursor = Math.min(cursor, maxCursor);
  const inputFocused =
    editing &&
    !snapshot.navFocused &&
    snapshot.dialog === null &&
    snapshot.modal === null &&
    snapshot.contextMenu === null;
  const listFocused =
    !editing &&
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
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "return") {
      setEditing(true);
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
      setCursor((c) => Math.max(0, Math.min(c, maxCursor) - Math.max(1, viewportRows)));
    } else if (key.name === "pagedown") {
      setCursor((c) => Math.min(maxCursor, Math.min(c, maxCursor) + Math.max(1, viewportRows)));
    } else if (key.name === "space") {
      const page = snap.discoverPage;
      const target = page?.results[clampedCursor];
      if (page !== null && target !== undefined) {
        const repoKey = `${target.owner}/${target.name}`;
        const next = new Set(page.selected);
        if (next.has(repoKey)) next.delete(repoKey);
        else next.add(repoKey);
        store.updateDiscoverPage({ selected: next });
      }
    } else if (key.name === "s") {
      void store.discoverSearch();
    } else if (key.name === "a") {
      const page = snap.discoverPage;
      if (page !== null) {
        store.updateDiscoverPage({
          selected:
            page.selected.size === page.results.length
              ? new Set<string>()
              : new Set(page.results.map((repo) => `${repo.owner}/${repo.name}`)),
        });
      }
    } else if (key.name === "c") {
      void store.discoverCloneSelected();
    } else if (key.name === "l") {
      const limits = [10, 20, 50, 100, 200];
      const currentIdx = limits.indexOf(state?.limit ?? 20);
      store.updateDiscoverPage({ limit: limits[(currentIdx + 1) % limits.length]! });
    } else if (key.name === "b") {
      store.updateDiscoverPage({ blobless: !(state?.blobless ?? false) });
    }
  });

  if (state === null) return null;
  const tracked = new Set(snapshot.repos.map((repo) => `${repo.owner}/${repo.name}`.toLowerCase()));
  const inner = Math.max(20, width - 4);
  const boxInnerCols = Math.max(10, width - 3);
  const win = visibleSlice(clampedCursor, state.results.length, viewportRows);
  const visibleResults = state.results.slice(win.start, win.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) =>
          Math.min(maxCursor, Math.max(0, Math.min(c, maxCursor) + (isUp ? -2 : 2))),
        );
      }}
    >
      <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {"query:"}
        </text>
        {editing ? (
          <input
            focused={inputFocused}
            value={state.query}
            onInput={(value) => store.updateDiscoverPage({ query: value })}
            onSubmit={() => {
              setEditing(false);
              setCursor(0);
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
            setEditing(false);
            setCursor(0);
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
        borderColor={listFocused ? theme.focusBorder() : theme.border()}
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
        {visibleResults.map((repo, offset) => {
          const idx = win.start + offset;
          const isCursor = listFocused && idx === clampedCursor;
          const key = `${repo.owner}/${repo.name}`;
          const isSelected = state.selected.has(key);
          const isTracked = tracked.has(key.toLowerCase());
          const keyPad = boxInnerCols < 56 ? 18 : 28;
          const langPad = boxInnerCols < 56 ? 6 : 10;
          const marker = isCursor ? ">" : " ";
          const rawLine = `${marker}${isSelected ? "[x]" : "[ ]"} ${key.padEnd(keyPad)}${isTracked ? " · tracked" : ""} · ${(repo.language ?? "—").padEnd(langPad)} · ★${String(repo.stars ?? 0).padStart(5)}${repo.description !== null ? ` · ${String(repo.description)}` : ""}`;
          return (
            <text
              key={key}
              fg={isCursor ? theme.cursorFg() : isSelected ? theme.accent() : theme.normal()}
              bg={isCursor ? theme.cursorBg() : undefined}
              wrapMode="none"
              flexShrink={0}
              onMouseDown={(event) => {
                event.stopPropagation();
                setEditing(false);
                setCursor(idx);
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
          const result = copyText("discover CLI", `repotruck discover ${state.query} --clone`);
          store.pushStatus(result.ok ? "DONE" : "FAILED", "[discover]", result.message);
        }}
      >
        {clampBoxLine(
          "Enter edit · ↑↓/jk move · Space select · a all · c clone · s search · Esc cockpit",
          width,
        )}
      </text>
    </box>
  );
}

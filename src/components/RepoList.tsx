import { useTerminalDimensions } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import {
  repoKeyOf,
  repoRowLabel,
  repoViewportRows,
  sidebarWidth,
  statusWidth,
  visibleSlice,
} from "./windowing.ts";

function clampRepoLine(raw: string, maxCols: number): string {
  if (raw.length <= maxCols) return raw;
  return `${raw.slice(0, Math.max(1, maxCols - 1))}\u2026`;
}

export function RepoList({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { width, height } = useTerminalDimensions();
  const isSearchOpen = snapshot.modal !== null && snapshot.modal.type === "search";
  const [searchTerm, setSearchTerm] = useState(
    snapshot.modal !== null && snapshot.modal.type === "search"
      ? snapshot.modal.initial
      : (snapshot.search ?? ""),
  );
  const focused = snapshot.focus === "list" && !isSearchOpen;
  const cursorFg = theme.cursorFg();
  const cursorBg = theme.cursorBg();
  const normalFg = theme.muted();
  const dimFg = theme.dim();
  const maxCols = Math.max(12, width - sidebarWidth(width) - statusWidth(width) - 2);

  const extraTopRows = isSearchOpen ? 2 : 0;
  const viewportRows = Math.max(
    1,
    repoViewportRows(height, snapshot.updateToast !== null) - extraTopRows,
  );
  const { start, end } = visibleSlice(snapshot.cursor, snapshot.filteredRepos.length, viewportRows);
  const slice = snapshot.filteredRepos.slice(start, end);
  const sortLabel =
    snapshot.sortKey !== "default" || snapshot.sortDescending
      ? ` \u00b7 sort: ${snapshot.sortKey}${snapshot.sortDescending ? " desc" : ""}`
      : "";
  const healthLabel =
    snapshot.healthFilter !== "all" ? ` \u00b7 health: ${snapshot.healthFilter}` : "";

  return (
    <box
      title="Repositories"
      border
      borderColor={focused || isSearchOpen ? theme.focusBorder() : theme.border()}
      overflow="hidden"
      flexDirection="column"
      flexGrow={1}
      onMouseDown={() => {
        store.setFocus("list");
      }}
      onMouseScroll={(e) => {
        e.stopPropagation();
        store.setFocus("list");
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        store.moveCursor(isUp ? -3 : 3);
      }}
    >
      {isSearchOpen ? (
        <box flexDirection="column" width="100%" flexShrink={0}>
          <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
            {clampRepoLine(
              "Search repositories (live filter \u00b7 Enter keeps \u00b7 Escape clears):",
              maxCols,
            )}
          </text>
          <input
            key="inline-repo-search"
            focused
            value={snapshot.search ?? searchTerm}
            onInput={(value) => {
              setSearchTerm(value);
              store.applySearch(value);
            }}
            onSubmit={() => {
              store.closeModal();
            }}
            width="100%"
          />
        </box>
      ) : null}
      {slice.map((repo, index) => {
        const absoluteIndex = start + index;
        const isCursor = focused && absoluteIndex === snapshot.cursor;
        const key = repoKeyOf(repo);
        const checked = snapshot.selected.has(key);
        const badges = snapshot.localHealth.get(key.toLowerCase());
        return (
          <text
            key={key}
            wrapMode="none"
            flexShrink={0}
            fg={isCursor ? cursorFg : badges?.missing ? theme.error() : normalFg}
            bg={isCursor ? cursorBg : undefined}
            onMouseDown={(e) => {
              e.stopPropagation();
              store.setFocus("list");
              if (e.button === 2) {
                store.setCursor(absoluteIndex);
                store.openDetailModal(key);
                return;
              }
              if (e.button === 0) {
                const relX = e.x > 6 ? e.x - sidebarWidth(width) : e.x;
                store.handleRepoRowClick(absoluteIndex, key, relX);
              }
            }}
          >
            {clampRepoLine(
              `${isCursor ? "> " : "  "}[${checked ? "x" : " "}] ${repoRowLabel(repo, badges)}`,
              maxCols,
            )}
          </text>
        );
      })}
      {snapshot.filteredRepos.length === 0 ? (
        <text fg={normalFg} wrapMode="none" flexShrink={0}>
          {clampRepoLine("no repositories match the current filters", maxCols)}
        </text>
      ) : null}
      <text
        fg={dimFg}
        wrapMode="none"
        flexShrink={0}
        onMouseDown={(e) => {
          e.stopPropagation();
          store.setFocus("list");
          store.cycleSort();
        }}
      >
        {clampRepoLine(
          `${snapshot.repos.length} repositories \u00b7 ${snapshot.selected.size} selected${
            snapshot.search !== null ? ` \u00b7 search: ${snapshot.search}` : ""
          }${healthLabel}${sortLabel}`,
          maxCols,
        )}
      </text>
    </box>
  );
}

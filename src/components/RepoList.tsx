import { useTerminalDimensions } from "@opentui/react";
import { useSyncExternalStore } from "react";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import {
  repoKeyOf,
  repoRowLabel,
  repoViewportRows,
  sidebarWidth,
  visibleSlice,
} from "./windowing.ts";

const CURSOR_BG = theme.cursorBg();
const NORMAL_FG = theme.muted();
const CURSOR_FG = theme.cursorFg();

export function RepoList({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { width, height } = useTerminalDimensions();
  const focused = snapshot.focus === "list";
  const viewportRows = repoViewportRows(height, snapshot.updateToast !== null);
  const { start, end } = visibleSlice(snapshot.cursor, snapshot.filteredRepos.length, viewportRows);
  const slice = snapshot.filteredRepos.slice(start, end);
  const sortLabel =
    snapshot.sortKey !== "default" || snapshot.sortDescending
      ? ` · sort: ${snapshot.sortKey}${snapshot.sortDescending ? " desc" : ""}`
      : "";
  return (
    <box
      title="Repositories"
      border
      borderColor={focused ? theme.focusBorder() : theme.border()}
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
      {slice.map((repo, index) => {
        const absoluteIndex = start + index;
        const isCursor = focused && absoluteIndex === snapshot.cursor;
        const checked = snapshot.selected.has(repoKeyOf(repo));
        return (
          <text
            key={repoKeyOf(repo)}
            fg={isCursor ? CURSOR_FG : NORMAL_FG}
            bg={isCursor ? CURSOR_BG : undefined}
            onMouseDown={(e) => {
              e.stopPropagation();
              store.setFocus("list");
              if (e.button === 2) {
                store.setCursor(absoluteIndex);
                store.openDetailModal(repoKeyOf(repo));
                return;
              }
              if (e.button === 0) {
                const relX = e.x > 6 ? e.x - sidebarWidth(width) : e.x;
                store.handleRepoRowClick(absoluteIndex, repoKeyOf(repo), relX);
              }
            }}
          >
            {`${isCursor ? "> " : "  "}[${checked ? "x" : " "}] ${repoRowLabel(repo)}`}
          </text>
        );
      })}
      {snapshot.filteredRepos.length === 0 ? (
        <text fg={NORMAL_FG}>no repositories match the current filters</text>
      ) : null}
      <text
        fg={theme.dim()}
        onMouseDown={(e) => {
          e.stopPropagation();
          store.setFocus("list");
          store.cycleSort();
        }}
      >
        {`${snapshot.repos.length} repositories · ${snapshot.selected.size} selected${
          snapshot.search !== null ? ` · search: ${snapshot.search}` : ""
        }${sortLabel}`}
      </text>
    </box>
  );
}

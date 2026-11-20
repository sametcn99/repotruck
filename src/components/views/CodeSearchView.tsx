import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyJson } from "../ui/JsonCopy.ts";
import { clampBoxLine, visibleSlice } from "../windowing.ts";

/**
 * `repotruck search-code` as a page: symbol / text / regex modes with kind,
 * language and limit controls; results grouped by repository. The omnibar
 * `@` quick search stays and pre-fills this page.
 */
export function CodeSearchView({
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
  const page = snapshot.codeSearchPage;
  const [editing, setEditing] = useState(true);
  const [cursor, setCursor] = useState(0);
  const inner = Math.max(20, width - 4);
  const boxInnerCols = Math.max(10, width - 3);

  useEffect(() => {
    if (page === null) store.updateCodeSearchForm({});
  }, [page, store]);

  const mode = page?.mode ?? "sym";
  const matches = page?.matches ?? [];
  const byRepo = new Map<string, NonNullable<(typeof matches)[number]>[]>();
  for (const match of matches) {
    const list = byRepo.get(match.repo) ?? [];
    list.push(match);
    byRepo.set(match.repo, list);
  }

  // Build flat render rows for windowing
  const flatRows: Array<{
    key: string;
    label: string;
    isHeader: boolean;
    fg: string | undefined;
    repo?: string;
  }> = [];
  for (const [repo, list] of byRepo.entries()) {
    flatRows.push({
      key: `hdr:${repo}`,
      label: `▸ ${repo} (${list.length})`,
      isHeader: true,
      fg: theme.accent(),
      repo,
    });
    const seen = new Map<string, number>();
    for (const match of list) {
      const base = `${match.repo}:${match.path}:${match.line}:${match.name}`;
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      flatRows.push({
        key: `${base}#${count}`,
        label: `  ${match.formatted}`,
        isHeader: false,
        fg: theme.normal(),
        repo: match.repo,
      });
    }
  }

  // 2 top control rows (or 3 if narrow wrap) + 2 box borders + 1 box header + 1 footer hint = 6 non-data rows.
  const viewportRows = Math.max(1, height - (width < 72 ? 7 : 6));
  const maxCursor = Math.max(0, flatRows.length - 1);
  const clampedCursor = Math.min(cursor, maxCursor);
  const win = visibleSlice(clampedCursor, flatRows.length, viewportRows);
  const visibleRows = flatRows.slice(win.start, win.end);
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
    if (key.name === "return" || key.sequence === "e") {
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
    } else if (key.name === "space" || key.name === "i") {
      const target = flatRows[clampedCursor];
      if (target?.repo !== undefined) store.openDetailModal(target.repo);
    } else if (key.name === "o") {
      store.updateCodeSearchForm({ offline: !(page?.offline ?? true) });
    } else if (key.name === "m") {
      store.updateCodeSearchForm({
        mode: page?.mode === "sym" ? "text" : page?.mode === "text" ? "re" : "sym",
      });
    } else if (key.name === "J" || key.sequence === "J") {
      const result = copyJson("search-code", {
        command: "search-code",
        ok: true,
        pattern: page?.pattern ?? "",
        matches: page?.matches ?? [],
      });
      store.pushStatus(result.ok ? "DONE" : "FAILED", "[search-code]", result.message);
    } else if (key.name === "r") {
      void store.rebuildCodeIndex();
    }
  });

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
      <box flexDirection="row" gap={1} flexWrap="wrap" flexShrink={0}>
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          pattern:
        </text>
        {editing ? (
          <input
            focused={inputFocused}
            value={page?.pattern ?? ""}
            onInput={(value) => store.updateCodeSearchForm({ pattern: value })}
            onSubmit={() => {
              setEditing(false);
              setCursor(0);
              void store.runCodeSearchPage();
            }}
            width={Math.max(12, Math.min(36, inner - 14))}
          />
        ) : (
          <text
            fg={theme.accent()}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              setEditing(true);
            }}
          >
            {page?.pattern || "(empty — Enter to edit)"}
          </text>
        )}
        <text
          fg={theme.accent()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.updateCodeSearchForm({
              mode: mode === "sym" ? "text" : mode === "text" ? "re" : "sym",
            });
          }}
        >
          {`[m] mode: ${mode === "sym" ? "symbol" : mode === "text" ? "text" : "regex"}`}
        </text>
        <text
          fg={theme.normal()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.updateCodeSearchForm({ offline: !(page?.offline ?? true) });
          }}
        >
          {`[o] offline: ${(page?.offline ?? true) ? "on" : "off"}`}
        </text>
        <text
          fg={theme.normal()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            setEditing(false);
            setCursor(0);
            void store.runCodeSearchPage();
          }}
        >
          {"[Enter] search"}
        </text>
        <text
          fg={theme.dim()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            void store.rebuildCodeIndex();
          }}
        >
          {"[r] rebuild index"}
        </text>
      </box>
      <box flexDirection="row" gap={1} flexWrap="wrap" flexShrink={0}>
        <text
          fg={theme.normal()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.updateCodeSearchForm({ kind: nextKind(page?.kind ?? "") });
          }}
        >
          {`kind: ${page?.kind || "any"}`}
        </text>
        <text
          fg={theme.normal()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.updateCodeSearchForm({ lang: nextLang(page?.lang ?? "") });
          }}
        >
          {`lang: ${page?.lang || "any"}`}
        </text>
        <text
          fg={theme.normal()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.updateCodeSearchForm({ limit: nextLimit(page?.limit ?? 50) });
          }}
        >
          {`limit: ${page?.limit ?? 50}`}
        </text>
        <text
          fg={theme.dim()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            const result = copyJson("search-code", {
              command: "search-code",
              ok: true,
              matches: page?.matches ?? [],
            });
            store.pushStatus(result.ok ? "DONE" : "FAILED", "[search-code]", result.message);
          }}
        >
          {"[J] copy JSON"}
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
            page?.loading
              ? " searching…"
              : ` ${matches.length} matches · ${byRepo.size} repos${
                  flatRows.length > viewportRows
                    ? ` (showing ${win.start + 1}-${win.end}/${flatRows.length})`
                    : ""
                }`,
            boxInnerCols,
          )}
        </text>
        {visibleRows.map((row, offset) => {
          const idx = win.start + offset;
          const isCursor = listFocused && idx === clampedCursor;
          const prefix = isCursor ? "> " : "  ";
          return (
            <text
              key={row.key}
              fg={isCursor ? theme.cursorFg() : row.fg}
              bg={isCursor ? theme.cursorBg() : undefined}
              wrapMode="none"
              flexShrink={0}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                setEditing(false);
                setCursor(idx);
                if (row.repo !== undefined && !row.isHeader) {
                  store.openDetailModal(row.repo);
                }
              }}
            >
              {clampBoxLine(`${prefix}${row.label}`, boxInnerCols)}
            </text>
          );
        })}
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          "Enter edit pattern · ↑↓/jk move · Space detail · m mode · o offline · r rebuild · J JSON · Esc cockpit",
          width,
        )}
      </text>
    </box>
  );
}

const KINDS = ["", "function", "class", "interface", "type", "enum", "method", "const"];
const LANGS = ["", "ts", "tsx", "js", "py", "go", "rs"];
const LIMITS = [10, 25, 50, 100, 200];

function nextKind(current: string): string {
  return KINDS[(KINDS.indexOf(current) + 1) % KINDS.length]!;
}
function nextLang(current: string): string {
  return LANGS[(LANGS.indexOf(current) + 1) % LANGS.length]!;
}
function nextLimit(current: number): number {
  return LIMITS[(LIMITS.indexOf(current) + 1) % LIMITS.length]!;
}

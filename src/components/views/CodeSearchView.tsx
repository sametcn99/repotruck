import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyJson } from "../ui/JsonCopy.ts";
import { visibleSlice } from "../windowing.ts";

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
  const height = heightProp ?? Math.max(12, termHeight - 4);
  const page = snapshot.codeSearchPage;
  const [editing, setEditing] = useState(true);
  const [scrollIdx, setScrollIdx] = useState(0);
  const inner = Math.max(20, width - 4);

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
    text: string;
    fg: string | undefined;
    repo?: string;
  }> = [];
  for (const [repo, list] of byRepo.entries()) {
    flatRows.push({
      key: `hdr:${repo}`,
      text: ` ▸ ${repo} (${list.length})`,
      fg: theme.accent(),
    });
    const seen = new Map<string, number>();
    for (const match of list) {
      const base = `${match.repo}:${match.path}:${match.line}:${match.name}`;
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      flatRows.push({
        key: `${base}#${count}`,
        text: `   ${match.formatted}`,
        fg: theme.normal(),
        repo: match.repo,
      });
    }
  }

  const viewportRows = Math.max(2, height - 10);
  const boundedScroll = Math.min(Math.max(0, scrollIdx), Math.max(0, flatRows.length - 1));
  const win = visibleSlice(boundedScroll, flatRows.length, viewportRows);
  const visibleRows = flatRows.slice(win.start, win.end);

  useKeyboard((key) => {
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "return") setEditing(true);
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(Math.max(0, flatRows.length - 1), s + 1));
    } else if (key.name === "m")
      store.updateCodeSearchForm({
        mode: page?.mode === "sym" ? "text" : page?.mode === "text" ? "re" : "sym",
      });
    else if (key.name === "J" || key.sequence === "J") {
      const result = copyJson("search-code", {
        command: "search-code",
        ok: true,
        pattern: page?.pattern ?? "",
        matches: page?.matches ?? [],
      });
      store.pushStatus(result.ok ? "DONE" : "FAILED", "[search-code]", result.message);
    } else if (key.name === "r") void store.rebuildCodeIndex();
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(Math.max(0, flatRows.length - 1), Math.max(0, s + (isUp ? -2 : 2))),
        );
      }}
    >
      <box flexDirection="row" gap={1} flexWrap="wrap">
        <text fg={theme.dim()}>pattern:</text>
        {editing ? (
          <input
            focused
            value={page?.pattern ?? ""}
            onInput={(value) => store.updateCodeSearchForm({ pattern: value })}
            onSubmit={() => {
              setEditing(false);
              void store.runCodeSearchPage();
            }}
            width={Math.max(12, Math.min(40, inner - 14))}
          />
        ) : (
          <text
            fg={theme.accent()}
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
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.updateCodeSearchForm({ offline: !(page?.offline ?? true) });
          }}
        >
          {`[o] offline: ${(page?.offline ?? true) ? "on" : "off"}`}
        </text>
        <text
          fg={theme.normal()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.runCodeSearchPage();
          }}
        >
          {"[Enter] search"}
        </text>
        <text
          fg={theme.dim()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.rebuildCodeIndex();
          }}
        >
          {"[r] rebuild index"}
        </text>
      </box>
      <box flexDirection="row" gap={1} flexWrap="wrap">
        <text
          fg={theme.normal()}
          onMouseDown={(event) => {
            event.stopPropagation();
            store.updateCodeSearchForm({ kind: nextKind(page?.kind ?? "") });
          }}
        >
          {`kind: ${page?.kind || "any"}`}
        </text>
        <text
          fg={theme.normal()}
          onMouseDown={(event) => {
            event.stopPropagation();
            store.updateCodeSearchForm({ lang: nextLang(page?.lang ?? "") });
          }}
        >
          {`lang: ${page?.lang || "any"}`}
        </text>
        <text
          fg={theme.normal()}
          onMouseDown={(event) => {
            event.stopPropagation();
            store.updateCodeSearchForm({ limit: nextLimit(page?.limit ?? 50) });
          }}
        >
          {`limit: ${page?.limit ?? 50}`}
        </text>
        <text
          fg={theme.dim()}
          onMouseDown={(event) => {
            event.stopPropagation();
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
        borderColor={theme.border()}
        flexDirection="column"
        flexGrow={1}
        padding={0}
        overflow="hidden"
      >
        <text fg={theme.dim()} wrapMode="none">
          {page?.loading
            ? " searching…"
            : ` ${matches.length} matches · ${byRepo.size} repos${
                flatRows.length > viewportRows
                  ? ` (showing ${win.start + 1}-${win.end}/${flatRows.length})`
                  : ""
              }`}
        </text>
        {visibleRows.map((row) => (
          <text
            key={row.key}
            fg={row.fg}
            wrapMode="none"
            onMouseDown={
              row.repo !== undefined
                ? (event) => {
                    event.stopPropagation?.();
                    store.openDetailModal(row.repo!);
                  }
                : undefined
            }
          >
            {row.text}
          </text>
        ))}
      </box>
      <text fg={theme.dim()} wrapMode="none">
        {
          "Enter edit pattern · m mode · J JSON · r rebuild · click a match for repo details · Esc cockpit"
        }
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

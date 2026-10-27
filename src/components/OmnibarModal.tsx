import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { ModalShell, SelectList } from "./ModalShell.tsx";
import { buildCommandPaletteItems, OMNIBAR_MODES, type OmnibarMode, type Store } from "./store.ts";
import { theme } from "./theme.ts";
import { visibleSlice } from "./windowing.ts";

// Header (3) + Footer (3) + Modal border/padding (4) + title (1) + tabs (1) + input (1) + status (1) + hint (1).
const OMNIBAR_RESERVED_ROWS = 15;

const MODE_LABELS: Record<OmnibarMode, string> = {
  commands: "[:] Commands",
  symbols: "[@] Code Search",
  github: "[#] GitHub Discover",
  runner: "[!] Run Command",
};

const PLACEHOLDERS: Record<OmnibarMode, string> = {
  commands: "Browse with Up/Down/PgUp/PgDn/Wheel, or type to filter commands\u2026",
  symbols: "Symbol name, or prefix with text: for full-text search\u2026",
  github: "Search GitHub (e.g. bun tui, language:typescript stars:>100)\u2026",
  runner: "Shell command to run in selected/all tracked repos (e.g. git fetch --all)",
};

interface ResultRow {
  key: string;
  label: string;
  activate: () => void;
}

export function OmnibarModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height } = useTerminalDimensions();
  const modal = snapshot.modal;
  const mode: OmnibarMode = modal?.type === "omnibar" ? modal.mode : "commands";
  const query = modal?.type === "omnibar" ? modal.query : "";
  const [cursor, setCursor] = useState(0);
  const dimFg = theme.dim();
  const accentFg = theme.accent();

  const rows: ResultRow[] = [];
  if (mode === "commands") {
    for (const cmd of buildCommandPaletteItems(query, snapshot)) {
      const catPrefix = cmd.category ? `[${cmd.category}] ` : "";
      const right = [cmd.detail, cmd.shortcut ? `[${cmd.shortcut}]` : undefined]
        .filter((x): x is string => Boolean(x))
        .join(" \u00b7 ");
      rows.push({
        key: cmd.id,
        label:
          right.length > 0
            ? `${catPrefix}${cmd.label}  \u2014  ${right}`
            : `${catPrefix}${cmd.label}`,
        activate: () => store.executeOmnibarCommand(cmd.id),
      });
    }
  } else if (mode === "symbols") {
    for (const match of snapshot.omnibarSymbols) {
      rows.push({
        key: `${match.repo}:${match.path}:${match.line}:${match.name}`,
        label: match.formatted,
        activate: () => store.openDetailModal(match.repo),
      });
    }
  } else if (mode === "github") {
    for (const repo of snapshot.omnibarGithubRepos) {
      const key = `${repo.owner}/${repo.name}`;
      const meta = [
        repo.language ?? undefined,
        typeof repo.stars === "number" ? `\u2605 ${repo.stars}` : undefined,
        repo.description ? repo.description.slice(0, 50) : undefined,
      ]
        .filter((x): x is string => Boolean(x))
        .join(" \u00b7 ");
      rows.push({
        key,
        label: meta.length > 0 ? `${key} (${meta})` : key,
        activate: () => void store.submitClone(key),
      });
    }
  }

  const total = rows.length;
  const boundedCursor = Math.min(Math.max(cursor, 0), Math.max(0, total - 1));
  const viewportRows = Math.max(3, height - OMNIBAR_RESERVED_ROWS);
  const window = visibleSlice(boundedCursor, total, viewportRows);
  const visibleRows = rows.slice(window.start, window.end);

  useKeyboard((key) => {
    if (key.name === "tab") {
      setCursor(0);
      store.cycleOmnibarTab();
      return;
    }
    if (total === 0) return;
    const ctrl = (key as { ctrl?: boolean }).ctrl === true;
    if (key.name === "up" || (ctrl && key.name === "p")) {
      setCursor((boundedCursor - 1 + total) % total);
    } else if (key.name === "down" || (ctrl && key.name === "n")) {
      setCursor((boundedCursor + 1) % total);
    } else if (key.name === "pageup") {
      setCursor(Math.max(0, boundedCursor - viewportRows));
    } else if (key.name === "pagedown") {
      setCursor(Math.min(total - 1, boundedCursor + viewportRows));
    } else if (key.name === "home" && (query.length === 0 || ctrl)) {
      setCursor(0);
    } else if (key.name === "end" && (query.length === 0 || ctrl)) {
      setCursor(total - 1);
    }
  });

  if (modal?.type !== "omnibar") return null;

  const targetScope =
    snapshot.selected.size > 0
      ? `${snapshot.selected.size} selected repositories`
      : "all tracked repositories";

  return (
    <ModalShell
      store={store}
      title="Omnibar"
      hint={
        "Tab switches mode \u00b7 Up/Down/PgUp/PgDn/Wheel browse \u00b7 Enter executes \u00b7 Escape closes"
      }
      borderColor={accentFg}
      gap={0}
      onMouseScroll={(e) => {
        if (total === 0) return;
        e.stopPropagation();
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((prev) => {
          const cur = Math.min(Math.max(prev, 0), total - 1);
          return Math.min(total - 1, Math.max(0, cur + (isUp ? -3 : 3)));
        });
      }}
    >
      <box flexDirection="row" gap={2} flexShrink={0}>
        {OMNIBAR_MODES.map((m) => (
          <text
            key={m}
            wrapMode="none"
            flexShrink={0}
            fg={m === mode ? theme.cursorFg() : dimFg}
            bg={m === mode ? theme.cursorBg() : undefined}
            onMouseDown={(e) => {
              e.stopPropagation();
              setCursor(0);
              store.openOmnibar(m, "");
            }}
          >
            {` ${MODE_LABELS[m]} `}
          </text>
        ))}
      </box>
      <input
        key={`omnibar-${mode}`}
        focused
        placeholder={PLACEHOLDERS[mode]}
        value={query}
        onInput={(val) => {
          setCursor(0);
          void store.updateOmnibarQuery(val);
        }}
        onSubmit={(submitted) => {
          const text = typeof submitted === "string" ? submitted : query;
          if (mode === "runner") {
            void store.submitOmnibarRunner(text);
            return;
          }
          rows[boundedCursor]?.activate();
        }}
        width="100%"
      />
      {snapshot.omnibarLoading ? (
        <text fg={dimFg} wrapMode="none" flexShrink={0}>
          {"searching\u2026"}
        </text>
      ) : null}
      {mode === "runner" ? (
        <text fg={dimFg} wrapMode="none" flexShrink={0}>
          {`Target scope: ${targetScope} \u00b7 Output streams to Activity log`}
        </text>
      ) : total === 0 && !snapshot.omnibarLoading ? (
        <text fg={dimFg} wrapMode="none" flexShrink={0}>
          {query.trim().length === 0 ? "Type to search\u2026" : "No matching results"}
        </text>
      ) : (
        <>
          <text fg={dimFg} wrapMode="none" flexShrink={0}>
            {`${boundedCursor + 1}/${total} ${mode === "commands" ? "commands" : "results"} (showing ${window.start + 1}\u2013${window.end})`}
          </text>
          <SelectList
            items={visibleRows}
            cursor={boundedCursor - window.start}
            keyOf={(r) => r.key}
            labelOf={(r) => r.label}
            onSelect={(_r, idx) => setCursor(window.start + idx)}
            onActivate={(r) => r.activate()}
          />
        </>
      )}
    </ModalShell>
  );
}

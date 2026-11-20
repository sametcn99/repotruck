import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import {
  buildRegistrySummaryLine,
  buildViewHelpRows,
  KEYBINDING_ROWS,
} from "../commands/helpData.ts";
import { PAGE_SHORTCUTS } from "../commands/pageHelp.ts";
import { ModalShell } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { VIEW_BY_ID } from "./views/viewRegistry.ts";
import { FOOTER_ROWS, HEADER_ROWS, visibleSlice } from "./windowing.ts";

// Border, optional padding, title and hint.
const HELP_VIEW_RESERVED_ROWS = 6 + HEADER_ROWS + FOOTER_ROWS;

function formatHelpRows(key: string, action: string, width: number): string[] {
  if (action === "") return [key];
  const column = Math.max(16, key.length + 1);
  const available = Math.max(8, width - column);
  const lines: string[] = [];
  let line = "";
  for (const word of action.split(" ")) {
    if (line !== "" && line.length + word.length + 1 > available) {
      lines.push(line);
      line = "";
    }
    line += line === "" ? word : ` ${word}`;
  }
  lines.push(line);
  return lines.map((text, index) => `${(index === 0 ? key : "").padEnd(column)}${text}`);
}

export function HelpModal({ store }: { store: Store }) {
  const { height, width } = useTerminalDimensions();
  const [cursor, setCursor] = useState(0);
  const { view } = store.getSnapshot();
  const viewTitle = VIEW_BY_ID.get(view)?.title ?? "Cockpit";
  const local = view === "cockpit" ? [] : PAGE_SHORTCUTS[view];
  const maxCols = Math.max(24, width - 6);
  const rows = [
    ...(local.length > 0 ? [[`— ${viewTitle} —`, ""] as const, ...local] : []),
    ["— Navigation —", ""] as const,
    ...KEYBINDING_ROWS,
    ...buildViewHelpRows(),
    ["— Parity —", buildRegistrySummaryLine()] as const,
  ].flatMap(([key, action]) =>
    formatHelpRows(key, action, maxCols - 2).map((text) => ({ text, heading: action === "" })),
  );
  const total = rows.length;
  const bounded = Math.min(Math.max(cursor, 0), Math.max(0, total - 1));
  const viewportRows = Math.max(1, height - HELP_VIEW_RESERVED_ROWS);
  const window = visibleSlice(bounded, total, viewportRows);
  const shown = rows.slice(window.start, window.end);
  const keyFg = theme.focusBorder();

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "return") {
      store.closeModal();
      return;
    }
    if (key.name === "up" || key.sequence === "k") {
      setCursor(Math.max(0, bounded - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setCursor(Math.min(total - 1, bounded + 1));
    } else if (key.name === "home" || key.sequence === "g") {
      setCursor(0);
    } else if (key.name === "end" || key.sequence === "G") {
      setCursor(total - 1);
    } else if (key.name === "pageup") {
      setCursor(Math.max(0, bounded - viewportRows));
    } else if (key.name === "pagedown") {
      setCursor(Math.min(total - 1, bounded + viewportRows));
    }
  });

  return (
    <ModalShell
      store={store}
      title="Keyboard shortcuts"
      hint={`↑↓ / PgUp / PgDn browse · ${window.start + 1}–${window.end}/${total} · Esc close`}
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) => Math.min(total - 1, Math.max(0, c + (isUp ? -3 : 3))));
      }}
    >
      {shown.map(({ text, heading }, index) => {
        const absIndex = window.start + index;
        const isCursor = absIndex === bounded;
        const fg = isCursor ? theme.cursorFg() : heading ? keyFg : theme.normal();
        return (
          <text
            key={absIndex}
            fg={fg}
            bg={isCursor ? theme.cursorBg() : undefined}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(e) => {
              if (e.button === 0) {
                e.stopPropagation();
                setCursor(absIndex);
              }
            }}
          >
            {`${isCursor ? "> " : "  "}${text}`}
          </text>
        );
      })}
    </ModalShell>
  );
}

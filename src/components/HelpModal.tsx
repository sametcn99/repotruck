import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState } from "react";
import {
  buildRegistrySummaryLine,
  buildViewHelpRows,
  KEYBINDING_ROWS,
} from "../commands/helpData.ts";
import { ModalShell } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { visibleSlice } from "./windowing.ts";

// Border (2) + padding (2) + title (1) + status (1) + close (2) + hint (1) +
// dashboard chrome (header 3 + footer 3). Single-element rows avoid @opentui's
// multi-box row-merge artifact across consecutive shortcut rows.
const HELP_VIEW_RESERVED_ROWS = 15;

const HELP_ROWS: readonly (readonly [string, string])[] = [
  ...KEYBINDING_ROWS,
  ...buildViewHelpRows(),
  ["— Parity —", buildRegistrySummaryLine()],
];

function formatHelpRow(key: string, action: string, isCursor: boolean, maxCols: number): string {
  const prefix = isCursor ? "> " : "  ";
  const body = action.length > 0 ? `${key.padEnd(16)}${action}` : key;
  const line = `${prefix}${body}`;
  if (line.length <= maxCols) return line;
  return `${line.slice(0, Math.max(1, maxCols - 1))}\u2026`;
}

export function HelpModal({ store }: { store: Store }) {
  const { height, width } = useTerminalDimensions();
  const [cursor, setCursor] = useState(0);
  const total = HELP_ROWS.length;
  const bounded = Math.min(Math.max(cursor, 0), Math.max(0, total - 1));
  const viewportRows = Math.max(1, height - HELP_VIEW_RESERVED_ROWS);
  const window = visibleSlice(bounded, total, viewportRows);
  const shown = HELP_ROWS.slice(window.start, window.end);
  const maxCols = Math.max(24, width - 6);
  const keyFg = theme.focusBorder();
  const dimFg = theme.dim();

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
      hint={`Up/Down or j/k scroll (${window.start + 1}\u2013${window.end} of ${total}) \u00b7 Escape closes`}
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) => Math.min(total - 1, Math.max(0, c + (isUp ? -3 : 3))));
      }}
    >
      {shown.map(([key, action], index) => {
        const absIndex = window.start + index;
        const isCursor = absIndex === bounded;
        const isSection = action.length === 0 || key.startsWith("—");
        const fg = isCursor ? theme.cursorFg() : isSection ? keyFg : theme.normal();
        return (
          <text
            key={key}
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
            {formatHelpRow(key, action, isCursor, maxCols)}
          </text>
        );
      })}
      <box flexDirection="row" gap={2} marginTop={1} flexShrink={0}>
        <text
          fg={dimFg}
          onMouseDown={(e) => {
            e.stopPropagation();
            store.closeModal();
          }}
        >
          {"[ Close ]"}
        </text>
      </box>
    </ModalShell>
  );
}

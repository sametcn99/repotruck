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

// Border (2) + padding (2) + hint (1) + breathing room (2) + dashboard
// chrome (header 3 + footer 3). Without the chrome rows the windowed slice
// overflows its box and the layout engine squeezes rows onto fractional
// heights — visibly interleaving consecutive shortcut rows.
const HELP_VIEW_RESERVED_ROWS = 13;

const HELP_ROWS: readonly (readonly [string, string])[] = [
  ...KEYBINDING_ROWS,
  ...buildViewHelpRows(),
  ["— Parity —", buildRegistrySummaryLine()],
];

export function HelpModal({ store }: { store: Store }) {
  const { height, width } = useTerminalDimensions();
  const [cursor, setCursor] = useState(0);
  const total = HELP_ROWS.length;
  const bounded = Math.min(Math.max(cursor, 0), Math.max(0, total - 1));
  const viewportRows = Math.max(1, height - HELP_VIEW_RESERVED_ROWS);
  const window = visibleSlice(bounded, total, viewportRows);
  const shown = HELP_ROWS.slice(window.start, window.end);
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
      hint="Up/Down or j/k scroll · Escape closes"
      gap={0}
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) => Math.min(total - 1, Math.max(0, c + (isUp ? -3 : 3))));
      }}
    >
      {shown.map(([key, action], index) => (
        <box key={key} flexDirection="row">
          <text
            fg={keyFg}
            onMouseDown={(e) => {
              if (e.button === 0) {
                e.stopPropagation();
                setCursor(window.start + index);
              }
            }}
          >
            {key.padEnd(15)}
          </text>
          <text>{action}</text>
        </box>
      ))}
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={theme.dim()}
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

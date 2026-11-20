import type { MouseEvent } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { type ReactNode, useRef, useSyncExternalStore } from "react";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { clampBoxLine } from "./windowing.ts";

/**
 * Shared scaffolding for every modal: a bordered, padded, growing box with a
 * title, the store's modalError line and a dim hint line ("Escape cancels").
 * Pass `borderColor` for accent-colored modals (defaults to the focus border).
 */
export function ModalShell({
  store,
  title,
  hint,
  borderColor,
  gap,
  children,
  onClose,
  onMouseScroll,
  status,
}: {
  store: Store;
  title: string;
  hint: string | null;
  borderColor?: string;
  gap?: number;
  children: ReactNode;
  onClose?: () => void;
  onMouseScroll?: (event: MouseEvent) => void;
  status?: string | null;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { width, height } = useTerminalDimensions();
  const handleClose = onClose ?? (() => store.closeModal());
  const compact = height < 22 || width < 64;
  const inner = Math.max(1, width - (compact ? 2 : 4));
  const closeLabel = "[× Close]";
  return (
    <box
      title={title}
      border
      borderColor={borderColor ?? theme.focusBorder()}
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
      padding={compact ? 0 : 1}
      gap={gap}
      onMouseDown={(e) => {
        if (e.button === 2) {
          e.stopPropagation();
          handleClose();
        }
      }}
      onMouseScroll={onMouseScroll}
    >
      <box flexDirection="row" justifyContent="space-between" width="100%" flexShrink={0}>
        <text fg={borderColor ?? theme.focusBorder()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(title, inner - closeLabel.length - 1)}
        </text>
        <text
          fg={theme.dim()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(e) => {
            e.stopPropagation();
            handleClose();
          }}
        >
          {closeLabel}
        </text>
      </box>
      {hint !== null ? (
        <text fg={theme.dim()} wrapMode="word" flexShrink={0} width="100%">
          {hint}
        </text>
      ) : null}
      {snapshot.modalError !== null || status ? (
        <text
          fg={snapshot.modalError !== null ? theme.error() : theme.success()}
          wrapMode="word"
          flexShrink={0}
          width="100%"
        >
          {snapshot.modalError ?? status}
        </text>
      ) : null}
      {children}
    </box>
  );
}

function clampModalRow(text: string, maxCols: number): string {
  const clean = text.replace(/[\r\n\t]+/g, " ");
  if (clean.length <= maxCols) return clean;
  return `${clean.slice(0, Math.max(1, maxCols - 1))}\u2026`;
}

/**
 * Cursor list rendering primitive: prefixes the cursor row with "> ", applies
 * the cursor colors, and lets callers override per-row foreground colors.
 */
export function SelectList<T>({
  items,
  cursor,
  keyOf,
  labelOf,
  fgOf,
  onSelect,
  onActivate,
}: {
  items: readonly T[];
  cursor: number;
  keyOf: (item: T, index: number) => string;
  labelOf: (item: T) => string;
  fgOf?: (item: T, isCursor: boolean) => string | undefined;
  onSelect?: (item: T, index: number) => void;
  onActivate?: (item: T, index: number) => void;
}) {
  const { width } = useTerminalDimensions();
  const maxCols = Math.max(12, width - 6);
  const lastClickRef = useRef<{ index: number; time: number } | null>(null);
  const cursorFg = theme.cursorFg();
  const cursorBg = theme.cursorBg();
  const normalFg = theme.normal();

  const handleClick = (item: T, index: number) => {
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && last.index === index && now - last.time < 400) {
      lastClickRef.current = null;
      onActivate?.(item, index);
      return;
    }
    lastClickRef.current = { index, time: now };
    onSelect?.(item, index);
  };

  return (
    <>
      {items.map((item, index) => {
        const isCursor = index === cursor;
        const fg = fgOf !== undefined ? fgOf(item, isCursor) : isCursor ? cursorFg : normalFg;
        return (
          <text
            key={keyOf(item, index)}
            fg={fg}
            bg={isCursor ? cursorBg : undefined}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(e) => {
              if (e.button === 0) {
                e.stopPropagation();
                handleClick(item, index);
              }
            }}
          >
            {clampModalRow(`${isCursor ? "> " : "  "}${labelOf(item)}`, maxCols)}
          </text>
        );
      })}
    </>
  );
}

import type { MouseEvent } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";
import { type ReactNode, useRef, useSyncExternalStore } from "react";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

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
}: {
  store: Store;
  title: string;
  hint: string | null;
  borderColor?: string;
  gap?: number;
  children: ReactNode;
  onClose?: () => void;
  onMouseScroll?: (event: MouseEvent) => void;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const handleClose = onClose ?? (() => store.closeModal());
  return (
    <box
      title={title}
      border
      borderColor={borderColor ?? theme.focusBorder()}
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
      padding={1}
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
          {title}
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
          {"[\u00d7 Close]"}
        </text>
      </box>
      {children}
      {snapshot.modalError !== null ? (
        <text fg={theme.error()} wrapMode="none" flexShrink={0}>
          {snapshot.modalError}
        </text>
      ) : null}
      {hint !== null ? (
        <text
          fg={theme.dim()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(e) => {
            e.stopPropagation();
            handleClose();
          }}
        >
          {hint}
        </text>
      ) : null}
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

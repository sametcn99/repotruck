import { useTerminalDimensions } from "@opentui/react";
import { type ReactNode, useSyncExternalStore } from "react";
import type { ViewId } from "../store/types.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { VIEW_BY_ID } from "../views/viewRegistry.ts";

function clampText(raw: string, maxCols: number): string {
  if (raw.length <= maxCols) return raw;
  return `${raw.slice(0, Math.max(1, maxCols - 1))}…`;
}

/**
 * Shared bordered page shell for non-cockpit views. Provides the same
 * visual framing as the Cockpit panels (Scope, Repositories, Status),
 * a top summary/breadcrumb strip with a quick `[Esc] Cockpit` return button,
 * and consistent padding so nested cards never collide with row-03 borders.
 */
export function PageShell({
  view,
  store,
  children,
}: {
  view: ViewId;
  store: Store;
  children: ReactNode;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { width: pageWidth, height } = useTerminalDimensions();
  const compact = height < 22 || pageWidth < 68;
  const spec = VIEW_BY_ID.get(view);
  const title = spec !== undefined ? `${spec.title} (v ${spec.go})` : view;
  const summary = spec?.summary ?? "";
  const backLabel = "[Esc] Cockpit";
  const innerCols = Math.max(20, pageWidth - (compact ? 2 : 4));
  const breadcrumbMax = Math.max(12, innerCols - backLabel.length - 2);
  const breadcrumb = clampText(`${spec?.group ?? "View"} · ${summary}`, breadcrumbMax);
  const focused = !snapshot.navFocused;

  return (
    <box
      title={title}
      border
      borderColor={focused ? theme.focusBorder() : theme.border()}
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
      padding={compact ? 0 : 1}
      gap={0}
      onMouseDown={() => {
        if (snapshot.navFocused) store.setNavFocused(false);
      }}
    >
      <box flexDirection="row" justifyContent="space-between" width="100%" flexShrink={0}>
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {breadcrumb}
        </text>
        <text
          fg={theme.dim()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.setView("cockpit");
          }}
        >
          {backLabel}
        </text>
      </box>
      {children}
    </box>
  );
}

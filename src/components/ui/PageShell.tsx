import type { ReactNode } from "react";
import type { ViewId } from "../store/types.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { VIEW_BY_ID } from "../views/viewRegistry.ts";

/**
 * Shared bordered page shell for non-cockpit views. Provides the same
 * visual framing as the Cockpit panels (NavRail, Scope, Repositories, Status),
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
  const spec = VIEW_BY_ID.get(view);
  const title = spec !== undefined ? `${spec.title} (v ${spec.go})` : view;
  const summary = spec?.summary ?? "";

  return (
    <box
      title={title}
      border
      borderColor={theme.focusBorder()}
      flexDirection="column"
      flexGrow={1}
      overflow="hidden"
      padding={1}
      gap={0}
    >
      <box flexDirection="row" justifyContent="space-between" width="100%" flexShrink={0}>
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {`${spec?.group ?? "View"} · ${summary}`}
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
          {"[← Esc Cockpit]"}
        </text>
      </box>
      {children}
    </box>
  );
}

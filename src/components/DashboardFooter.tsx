import type { Store, StoreSnapshot } from "./store.ts";
import { theme } from "./theme.ts";
import { clampBoxLine, FOOTER_ROWS } from "./windowing.ts";

type FooterItem = { label: string; activate?: () => void };

export function fitFooterItems(width: number, items: readonly FooterItem[]): FooterItem[] {
  const result: FooterItem[] = [];
  let remaining = width - 3;
  for (const item of items) {
    const gap = result.length === 0 ? 0 : 2;
    const available = remaining - gap;
    if (available <= 0) break;
    if (item.activate !== undefined && item.label.length > available) continue;
    const label = clampBoxLine(item.label, available);
    result.push({ ...item, label });
    remaining -= label.length + gap;
  }
  return result;
}

export function DashboardFooter({
  store,
  snapshot,
  width,
  runningSummary,
  onQuit,
}: {
  store: Store;
  snapshot: StoreSnapshot;
  width: number;
  runningSummary: string | null;
  onQuit: () => void;
}) {
  const help = { label: "[F1] Help", activate: store.openHelpModal };
  const quit = { label: "[q] Quit", activate: onQuit };
  let items: FooterItem[];
  if (snapshot.dialog !== null) {
    items = [
      { label: "[Enter] Confirm", activate: () => store.resolveDialog(true) },
      { label: "[Esc] Cancel", activate: () => store.resolveDialog(false) },
    ];
  } else if (snapshot.contextMenu !== null) {
    items = [{ label: "↑↓ Move · Enter Choose · Esc Close" }];
  } else if (snapshot.modal !== null) {
    items = [
      {
        label: "[Esc] Close",
        activate:
          snapshot.modal.type === "deviceFlow"
            ? store.cancelDeviceFlow
            : () => {
                if (snapshot.modal?.type === "search") store.clearSearch();
                store.closeModal();
              },
      },
    ];
  } else if (snapshot.phase !== "ready") {
    items = [quit];
  } else if (runningSummary !== null) {
    items = [help, quit, { label: runningSummary }];
  } else if (snapshot.view === "cockpit") {
    const context: FooterItem[] =
      snapshot.focus === "list"
        ? [
            { label: "[Space] Select", activate: store.toggleCurrent },
            { label: "[Enter] Sync preview", activate: () => void store.openStartPreview() },
            { label: "[/] Filter repos", activate: store.openSearchModal },
          ]
        : snapshot.focus === "sidebar"
          ? [{ label: "↑↓ Move · Enter Toggle" }]
          : [{ label: "↑↓ Scroll · 1/2/3 Tabs" }];
    items = [
      help,
      { label: "[Tab] Focus", activate: () => store.cycleFocus() },
      ...context,
      { label: "[:] Commands", activate: () => store.openOmnibar("commands") },
      quit,
    ];
  } else {
    items = [
      help,
      { label: "[ Prev", activate: () => store.cycleView(-1) },
      { label: "] Next", activate: () => store.cycleView(1) },
      { label: "[:] Commands", activate: () => store.openOmnibar("commands") },
      quit,
    ];
  }

  return (
    <box
      border
      borderColor={theme.border()}
      height={FOOTER_ROWS}
      flexShrink={0}
      flexDirection="row"
      gap={2}
      paddingLeft={1}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {fitFooterItems(width, items).map(({ label, activate }) => (
        <text
          key={label}
          fg={theme.dim()}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.button === 0) activate?.();
          }}
        >
          {label}
        </text>
      ))}
    </box>
  );
}

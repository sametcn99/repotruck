import { seedDetailFromHealth } from "./store/repoDetail.ts";

export { detailLocalFor } from "./store/repoDetail.ts";

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useSyncExternalStore } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import { clampBoxLine } from "./windowing.ts";

export function DetailModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { width, height } = useTerminalDimensions();
  const modal = snapshot.modal;
  const key = modal !== null && modal.type === "detail" ? modal.key : "";
  const repo = snapshot.repos.find(
    (item) => `${item.owner}/${item.name}`.toLowerCase() === key.toLowerCase(),
  );
  const seeded = seedDetailFromHealth(snapshot.localHealth?.get(key.toLowerCase()));
  const local = snapshot.detailData?.key === key ? (snapshot.detailData.local ?? seeded) : seeded;
  const dimFg = theme.dim();
  const compact = height < 22 || width < 68;
  const maxCols = Math.max(16, width - (compact ? 2 : 4));

  useEffect(() => {
    void store.refreshDetailLocal(key);
  }, [store, key]);

  useKeyboard((keyEvent) => {
    if (keyEvent.name === "escape" || keyEvent.name === "return") {
      store.closeModal();
    }
  });

  if (repo === undefined) {
    return (
      <ModalShell store={store} title="Repository details" hint="Escape closes">
        <text fg={theme.error()} wrapMode="none" flexShrink={0}>
          {clampBoxLine(`repository not in the current list: ${key}`, maxCols)}
        </text>
      </ModalShell>
    );
  }

  const flags: string[] = [];
  if (repo.isPrivate) flags.push("[Private]");
  if (repo.isFork) flags.push("[Fork]");
  if (repo.isArchived) flags.push("[Archived]");

  return (
    <ModalShell store={store} title="Repository details" hint="Escape closes" gap={0}>
      <text wrapMode="none" flexShrink={0}>
        {clampBoxLine(`${key}${flags.length > 0 ? ` ${flags.join(" ")}` : ""}`, maxCols)}
      </text>
      <text fg={dimFg} wrapMode="none" flexShrink={0}>
        {clampBoxLine(`description: ${repo.description ?? "no description"}`, maxCols)}
      </text>
      <text fg={dimFg} wrapMode="none" flexShrink={0}>
        {clampBoxLine(`language: ${repo.language ?? "null"}`, maxCols)}
      </text>
      {typeof repo.stars === "number" ? (
        <text fg={dimFg} wrapMode="none" flexShrink={0}>
          {`stars: ${repo.stars}`}
        </text>
      ) : null}
      <text fg={dimFg} wrapMode="none" flexShrink={0}>
        {clampBoxLine(`updated: ${repo.updatedAt ?? "unknown"}`, maxCols)}
      </text>
      <text fg={dimFg} wrapMode="none" flexShrink={0}>
        {clampBoxLine(`url: ${repo.httpsUrl}`, maxCols)}
      </text>
      <text fg={dimFg} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          local === null
            ? "local: checking\u2026"
            : local.tracked
              ? `tracked at ${local.relativePath}${local.alias !== null ? ` \u00b7 alias: ${local.alias}` : ""} \u00b7 ${local.disk}`
              : "not tracked by repotruck",
          maxCols,
        )}
      </text>
      <box flexDirection="row" gap={2} marginTop={1} flexShrink={0}>
        <text
          fg={dimFg}
          flexShrink={0}
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

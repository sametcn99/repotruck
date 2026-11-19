import { useKeyboard } from "@opentui/react";
import { useEffect, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";

/**
 * `repotruck changelog` as a page: since/until/author/repo filter form,
 * markdown preview and copy-to-clipboard.
 */
export function ChangelogView({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const page = snapshot.changelogPage;

  useEffect(() => {
    if (page === null) void store.generateChangelog({});
  }, [page, store]);

  useKeyboard((key) => {
    if (key.name === "g") void store.generateChangelog({ since: "14 days ago" });
    else if (key.name === "m") void store.generateChangelog({ since: "30 days ago" });
  });

  const lines = page?.markdown.split("\n") ?? [];
  const preview = lines.slice(0, 24);

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" gap={2}>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.generateChangelog({ since: "7 days ago" });
          }}
        >
          {"[7d]"}
        </text>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.generateChangelog({ since: "14 days ago" });
          }}
        >
          {"[14d]"}
        </text>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.generateChangelog({ since: "30 days ago" });
          }}
        >
          {"[30d]"}
        </text>
      </box>
      <box flexDirection="column" flexGrow={1}>
        {preview.length === 0 ? (
          <text fg={theme.dim()}>{"no commits in range (or not a git workspace yet)"}</text>
        ) : (
          preview.map((line, index) => (
            <text
              key={`${index}-${line.slice(0, 10)}`}
              fg={line.startsWith("#") ? theme.accent() : theme.normal()}
            >
              {` ${line}`}
            </text>
          ))
        )}
      </box>
      {lines.length > 24 ? (
        <text fg={theme.dim()}>{`… ${lines.length - 24} more lines (full markdown via copy)`}</text>
      ) : null}
      <text fg={theme.dim()}>{"g 14d · m 30d · Esc cockpit"}</text>
    </box>
  );
}

/**
 * `repotruck scan` (+ adopt) and `prune` as a page.
 */
export function ScanAdoptView({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const page = snapshot.scanPage;

  useKeyboard((key) => {
    if (key.name === "s") void store.scanAndAdopt(false);
    else if (key.name === "a") void store.scanAndAdopt(true);
    else if (key.name === "p") store.pruneWorkspaceConfirm();
  });

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" gap={2}>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.scanAndAdopt(false);
          }}
        >
          {"[s] scan"}
        </text>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            store.confirmDialog(
              {
                title: "Adopt unregistered repos",
                message: "Move unregistered repositories into the preset layout? (scan --move)",
                confirmLabel: "Adopt",
              },
              () => {
                void store.scanAndAdopt(true);
              },
            );
          }}
        >
          {"[a] adopt (--move)"}
        </text>
        <text
          fg={theme.error()}
          onMouseDown={(event) => {
            event.stopPropagation();
            store.pruneWorkspaceConfirm();
          }}
        >
          {"[p] prune untrack deleted"}
        </text>
      </box>
      <text fg={theme.dim()}>{"unregistered repositories:"}</text>
      <box flexDirection="column" flexGrow={1}>
        {(page?.unregistered ?? []).length === 0 ? (
          <text fg={theme.dim()}>{"  (none discovered yet — run a scan)"}</text>
        ) : (
          (page?.unregistered ?? []).map((line) => (
            <text key={line} fg={theme.normal()}>
              {` • ${line}`}
            </text>
          ))
        )}
      </box>
      <text fg={theme.dim()}>
        {"adopt is confirm-guarded · prune keeps unclear answers · Esc cockpit"}
      </text>
    </box>
  );
}

/**
 * `repotruck worktree scan` as a page: every linked worktree with its
 * parent repository; per-repo management stays in the W modal.
 */
export function WorktreesView({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const page = snapshot.worktreePage;

  useKeyboard((key) => {
    if (key.name === "s") void store.scanWorkspaceWorktrees();
  });

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <text
        fg={theme.accent()}
        onMouseDown={(event) => {
          event.stopPropagation();
          void store.scanWorkspaceWorktrees();
        }}
      >
        {"[s] scan workspace worktrees"}
      </text>
      <box flexDirection="column" flexGrow={1}>
        {(page?.rows ?? []).length === 0 ? (
          <text fg={theme.dim()}>{"  no scan yet — run [s] (worktree scan)"}</text>
        ) : (
          (page?.rows ?? []).map((row) => (
            <text key={row} fg={theme.normal()}>
              {` ⑂ ${row}`}
            </text>
          ))
        )}
      </box>
      <text fg={theme.dim()}>
        {"per-repo create/remove lives in the W modal (force option in its confirm) · Esc cockpit"}
      </text>
    </box>
  );
}

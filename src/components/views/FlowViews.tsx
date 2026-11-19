import { useKeyboard } from "@opentui/react";
import { useEffect, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { renderMarkdownLines } from "../ui/MarkdownPane.tsx";

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

  const styledLines = page !== null ? renderMarkdownLines(page.markdown, width) : [];
  const preview = styledLines.slice(0, 28);

  return (
    <box flexDirection="column" flexGrow={1} width="100%" gap={1}>
      <box flexDirection="row" gap={2}>
        <text fg={theme.dim()}>{"range:"}</text>
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
          {"[g · 14d]"}
        </text>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.generateChangelog({ since: "30 days ago" });
          }}
        >
          {"[m · 30d]"}
        </text>
      </box>
      <box border borderColor={theme.border()} flexDirection="column" flexGrow={1} padding={0}>
        {preview.length === 0 ? (
          <text fg={theme.dim()}>{" no commits in range (or not a git workspace yet)"}</text>
        ) : (
          preview.map((line, index) => (
            <text
              key={`${index}-${line.text.slice(0, 12)}`}
              fg={line.fg ?? theme.normal()}
              wrapMode="none"
            >
              {` ${line.text}`}
            </text>
          ))
        )}
      </box>
      {styledLines.length > 28 ? (
        <text fg={theme.dim()}>
          {`… ${styledLines.length - 28} more lines (full markdown via copy)`}
        </text>
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
  const unregistered = page?.unregistered ?? [];

  useKeyboard((key) => {
    if (key.name === "s") void store.scanAndAdopt(false);
    else if (key.name === "a") void store.scanAndAdopt(true);
    else if (key.name === "p") store.pruneWorkspaceConfirm();
  });

  return (
    <box flexDirection="column" flexGrow={1} width="100%" gap={1}>
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
      <box border borderColor={theme.border()} flexDirection="column" flexGrow={1} padding={0}>
        <text fg={theme.dim()}>
          {` unregistered repositories (${unregistered.length} discovered):`}
        </text>
        {unregistered.length === 0 ? (
          <text fg={theme.dim()}>{"  (none discovered yet — run a scan)"}</text>
        ) : (
          unregistered.map((line) => (
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
  const rows = page?.rows ?? [];

  useEffect(() => {
    if (page === null) void store.scanWorkspaceWorktrees();
  }, [page, store]);

  useKeyboard((key) => {
    if (key.name === "s") void store.scanWorkspaceWorktrees();
  });

  return (
    <box flexDirection="column" flexGrow={1} width="100%" gap={1}>
      <box flexDirection="row" gap={2}>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation();
            void store.scanWorkspaceWorktrees();
          }}
        >
          {"[s] scan workspace worktrees"}
        </text>
        <text fg={theme.dim()}>{`${rows.length} linked worktree(s)`}</text>
      </box>
      <box border borderColor={theme.border()} flexDirection="column" flexGrow={1} padding={0}>
        <text fg={theme.dim()}>{" parent repo · branch · linked checkout path"}</text>
        {rows.length === 0 ? (
          <text fg={theme.dim()}>{"  no scan yet — run [s] (worktree scan)"}</text>
        ) : (
          rows.map((row) => (
            <text key={row} fg={theme.normal()} wrapMode="none">
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

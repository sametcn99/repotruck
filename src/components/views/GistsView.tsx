import { useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { firstErrorLine } from "../../services/cloner.ts";
import type { GistCreate, GistDetail, GistEdit } from "../../services/gistApi.ts";
import type { GistRow, GistSyncItem } from "../../services/gists.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { clampBoxLine, visibleSlice } from "../windowing.ts";
import { GistEditor } from "./GistEditor.tsx";

type Mode =
  | { kind: "list" | "search" | "link" | "create" }
  | { kind: "open" | "delete"; id: string }
  | { kind: "edit" | "detail"; gist: GistDetail };

export function GistsView({
  store,
  width,
  height,
}: {
  store: Store;
  width: number;
  height: number;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [rows, setRows] = useState<GistRow[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [cursor, setCursor] = useState(0);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const mounted = useRef(false);
  const online = store.hasGistSession();
  const active =
    !snapshot.navFocused && !snapshot.modal && !snapshot.dialog && !snapshot.contextMenu;
  const needle = query.toLowerCase().trim();
  const filtered = rows.filter(
    ({ id, gist }) =>
      !needle ||
      [id, gist?.description, gist?.owner, ...(gist?.files ?? [])].some((value) =>
        value?.toLowerCase().includes(needle),
      ),
  );
  const rowIndex = Math.max(0, Math.min(cursor, filtered.length - 1));
  const row = filtered[rowIndex];
  const window = visibleSlice(rowIndex, filtered.length, Math.max(2, height - 5));

  const run = useCallback((work: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setNotice("");
    void work()
      .catch((error) => {
        if (mounted.current) setNotice(firstErrorLine(error));
      })
      .finally(() => {
        operation.current = false;
        if (mounted.current) setBusy(false);
      });
  }, []);

  const reload = useCallback(async () => {
    const service = store.gistService();
    try {
      const result = await service.list(!store.hasGistSession());
      if (mounted.current) setRows(result);
    } catch (error) {
      const local = await service.list(true);
      if (mounted.current) setRows(local);
      throw error;
    }
  }, [store]);

  useEffect(() => {
    mounted.current = true;
    run(reload);
    return () => {
      mounted.current = false;
    };
  }, [reload, run]);

  function close() {
    setMode({ kind: "list" });
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function report(results: readonly GistSyncItem[]) {
    const failed = results.filter((item) => item.error);
    const ahead = results.filter((item) => item.action === "ahead").length;
    const synced = results.length - failed.length - ahead;
    setNotice(
      `${synced} Gists synced${ahead ? ` · ${ahead} ahead` : ""}${failed.length ? ` · ${failed.length} failed · ${failed[0]?.error}` : ""}`,
    );
  }

  function sync(refs: readonly string[]) {
    if (!online) return setNotice("Sign in to GitHub.com to sync Gists");
    run(async () => {
      const result = await store.gistService().sync(refs);
      if (!mounted.current) return;
      if (!result.some((item) => item.error)) close();
      report(result);
      await reload();
    });
  }

  function inspect(id: string, edit: boolean) {
    run(async () => {
      const gist = await store.gistService().show(id);
      if (!mounted.current) return;
      const login = store.getSnapshot().userLogin;
      if (edit && (!login || login.toLowerCase() !== gist.owner?.toLowerCase())) {
        setNotice("Only the Gist owner can edit it");
        return;
      }
      setMode({ kind: edit ? "edit" : "detail", gist });
    });
  }

  function saveCreate(input: GistCreate) {
    run(async () => {
      const result = await store.gistService().create(input);
      if (!mounted.current) return;
      close();
      setNotice(
        result.local.error
          ? `Created ${result.gist.url} · clone failed: ${result.local.error}`
          : `Created and cloned ${result.gist.url}`,
      );
      await reload();
    });
  }

  function saveEdit(id: string, input: GistEdit) {
    run(async () => {
      const result = await store.gistService().edit(id, input);
      if (!mounted.current) return;
      close();
      setNotice(
        result.syncNeeded ? "Saved on GitHub · sync to update the local clone" : "Saved on GitHub",
      );
      await reload();
    });
  }

  function remove(id: string) {
    run(async () => {
      await store.gistService().delete(id, true);
      if (!mounted.current) return;
      close();
      setNotice("Deleted from GitHub · local files kept");
      await reload();
    });
  }

  function open(id: string, app: string) {
    run(async () => {
      await store.openGistInApp(id, app.trim());
      if (!mounted.current) return;
      close();
      setNotice(`Opened in ${app}`);
    });
  }

  useKeyboard((key) => {
    if (!active || mode.kind === "create" || mode.kind === "edit") return;
    if (key.name === "escape") {
      key.stopPropagation();
      if (!busy) {
        if (mode.kind === "list") store.setView("cockpit");
        else close();
      }
      return;
    }
    if (busy) return;
    if (
      mode.kind === "search" ||
      mode.kind === "open" ||
      mode.kind === "link" ||
      mode.kind === "delete"
    ) {
      if (key.name !== "return") return;
      key.stopPropagation();
      if (mode.kind === "search") close();
      if (mode.kind === "link") sync([input]);
      if (mode.kind === "open") open(mode.id, input);
      if (mode.kind === "delete") remove(mode.id);
      return;
    }
    if (mode.kind !== "list" || key.ctrl || key.meta) return;
    switch (key.name) {
      case "up":
      case "k":
        setCursor(Math.max(0, rowIndex - 1));
        break;
      case "down":
      case "j":
        setCursor(Math.min(filtered.length - 1, rowIndex + 1));
        break;
      case "pageup":
        setCursor(Math.max(0, rowIndex - (window.end - window.start)));
        break;
      case "pagedown":
        setCursor(Math.min(filtered.length - 1, rowIndex + window.end - window.start));
        break;
      case "space":
        if (row) toggle(row.id);
        break;
      case "r":
        run(reload);
        break;
      case "/":
        setMode({ kind: "search" });
        break;
      case "c":
        if (online) {
          setInput("");
          setMode({ kind: "link" });
        }
        break;
      case "n":
        if (online) setMode({ kind: "create" });
        break;
      case "s":
        sync(selected.size ? [...selected] : row ? [row.id] : []);
        break;
      case "a":
        sync([]);
        break;
      case "return":
        if (row) inspect(row.id, false);
        break;
      case "e":
        if (row && online) inspect(row.id, true);
        break;
      case "o":
        if (row) {
          setInput("vscode");
          setMode({ kind: "open", id: row.id });
        }
        break;
      case "p":
        if (row && online)
          run(async () => {
            const result = await store.gistService().push(row.id);
            if (mounted.current)
              setNotice(result.action === "pushed" ? "Pushed local commits" : "Already up to date");
          });
        break;
      case "d":
        if (row && online) setMode({ kind: "delete", id: row.id });
        break;
    }
  });

  let body: React.ReactNode;
  if (mode.kind === "create" || mode.kind === "edit") {
    const detail = mode.kind === "edit" ? mode.gist : undefined;
    body = (
      <GistEditor
        key={detail?.id ?? "create"}
        detail={detail}
        active={active}
        busy={busy}
        width={width}
        height={height}
        cancel={close}
        saveCreate={saveCreate}
        saveEdit={(input) => {
          if (detail) saveEdit(detail.id, input);
        }}
      />
    );
  } else if (mode.kind === "detail") {
    body = (
      <scrollbox flexGrow={1} focused={active} contentOptions={{ flexDirection: "column" }}>
        <text fg={theme.accent()}>{mode.gist.url}</text>
        <text>{mode.gist.description}</text>
        <text fg={theme.dim()}>{mode.gist.public ? "Public" : "Secret"}</text>
        {mode.gist.files.map((name) => (
          <box key={name} flexDirection="column">
            <text fg={theme.accent()}>{name}</text>
            <text>
              {mode.gist.contents[name] ??
                "Contents unavailable through the API. Use the Git clone."}
            </text>
          </box>
        ))}
      </scrollbox>
    );
  } else if (mode.kind === "delete") {
    const id = mode.id;
    body = (
      <box flexDirection="column">
        <text
          fg={theme.error()}
        >{`Delete Gist ${id} permanently from GitHub? Local files are kept.`}</text>
        <text
          onMouseDown={(event) => {
            event.stopPropagation();
            if (!busy) remove(id);
          }}
        >
          [Enter] Confirm · [Esc] Cancel
        </text>
      </box>
    );
  } else if (mode.kind === "link" || mode.kind === "open") {
    body = (
      <box flexDirection="column">
        <text>{mode.kind === "link" ? "Gist ID or URL" : "Editor or app name"}</text>
        <input focused={active && !busy} value={input} onInput={setInput} />
        <text fg={theme.dim()}>[Enter] Apply · [Esc] Cancel</text>
      </box>
    );
  } else {
    body = (
      <>
        {mode.kind === "search" ? (
          <input
            focused={active}
            value={query}
            placeholder="Search Gists"
            onInput={(value) => {
              setQuery(value);
              setCursor(0);
            }}
          />
        ) : (
          <text fg={theme.dim()} flexShrink={0}>
            {clampBoxLine(
              `${filtered.length} Gists · ${selected.size} selected${needle ? ` · filter: ${query}` : ""}`,
              width,
            )}
          </text>
        )}
        <box flexGrow={1} flexDirection="column" minHeight={0}>
          {filtered.slice(window.start, window.end).map((item, index) => {
            const absolute = window.start + index;
            const label = item.gist?.description || item.gist?.files[0] || item.id;
            const visibility = item.gist ? (item.gist.public ? "public" : "secret") : "tracked";
            return (
              <text
                key={item.id}
                flexShrink={0}
                fg={absolute === rowIndex ? theme.accent() : theme.normal()}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  setCursor(absolute);
                }}
              >
                {clampBoxLine(
                  `${absolute === rowIndex ? "›" : " "} ${selected.has(item.id) ? "●" : "○"} ${visibility}  ${item.local}  ${label.replace(/\s+/g, " ")}`,
                  width,
                )}
              </text>
            );
          })}
          {filtered.length === 0 && !busy && <text fg={theme.dim()}>No matching Gists</text>}
        </box>
        {online && (
          <text fg={theme.dim()} flexShrink={0} wrapMode="word">
            [/] Search · [Space] Select · [s] Sync · [a] Sync all · [c] Add URL · [n] Create
          </text>
        )}
        <text fg={theme.dim()} flexShrink={0} wrapMode="word">
          {online
            ? "[Enter] Details · [e] Edit · [o] Open · [p] Push · [d] Delete · [r] Refresh"
            : "[/] Search · [o] Open · [r] Refresh · Sign in to GitHub.com for remote actions"}
        </text>
      </>
    );
  }
  return (
    <box flexGrow={1} flexDirection="column" minHeight={0}>
      {body}
      {(notice || busy) && (
        <text fg={theme.accent()} flexShrink={0} wrapMode="word">
          {busy ? "Working…" : notice}
        </text>
      )}
    </box>
  );
}

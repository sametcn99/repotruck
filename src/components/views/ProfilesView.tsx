import { useKeyboard } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";

/**
 * `repotruck profile list/pin/unpin/save/delete` as a page: pinned repos
 * with bulk pin/unpin from the cockpit selection, named profiles with
 * save-from-selection / pinned and delete, plus scope handoffs to sync and
 * run.
 */
export function ProfilesView({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [nameValue, setNameValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, string[]>>({});

  useEffect(() => {
    void (async () => {
      try {
        const config = await import("../../services/workspace.ts").then((m) =>
          m.loadWorkspace(store.root),
        );
        setProfiles(config.profiles ?? {});
      } catch {
        setProfiles({});
      }
    })();
  }, [store, snapshot.pinnedCount]);

  useKeyboard((key) => {
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "n") setEditing(true);
    else if (key.name === "p") void store.togglePinSelection();
  });

  const pinned = [...snapshot.localHealth.entries()]
    .filter(([, health]) => health.pinned)
    .map(([key]) => key);
  const half = Math.max(30, Math.floor((width - 6) / 2));

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" flexGrow={1} gap={1}>
        <box border borderColor={theme.border()} flexDirection="column" width={half}>
          <text fg={theme.dim()}>{" Pinned (Active Focus)"}</text>
          {pinned.length === 0 ? (
            <text fg={theme.dim()}>{"  nothing pinned — P in the cockpit or [p] here"}</text>
          ) : (
            pinned.map((key) => (
              <text key={key} fg={theme.normal()}>
                {` ★ ${key}`}
              </text>
            ))
          )}
          <text
            fg={theme.accent()}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              void store.togglePinSelection();
            }}
          >
            {` [p] pin/unpin cockpit selection (${snapshot.selected.size})`}
          </text>
        </box>
        <box border borderColor={theme.border()} flexDirection="column" width={half}>
          <text fg={theme.dim()}>{" Named profiles"}</text>
          {Object.entries(profiles).length === 0 ? (
            <text fg={theme.dim()}>{"  no named profiles yet"}</text>
          ) : (
            Object.entries(profiles).map(([name, refs]) => (
              <box key={name} flexDirection="column">
                <text fg={theme.normal()}>{` ${name} · ${refs.length} repos`}</text>
                <text
                  fg={theme.dim()}
                >{`   ${refs.slice(0, 3).join(", ")}${refs.length > 3 ? " …" : ""}`}</text>
                <box flexDirection="row" gap={2}>
                  <text
                    fg={theme.accent()}
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      store.setView("sync");
                    }}
                  >
                    {"   [⇅ sync]"}
                  </text>
                  <text
                    fg={theme.accent()}
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      store.updateRunConsole({ scope: "profile", profile: name });
                      store.setView("run");
                    }}
                  >
                    {"[▶ run]"}
                  </text>
                  <text
                    fg={theme.error()}
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      store.confirmDialog(
                        {
                          title: `Delete profile ${name}?`,
                          message: `repotruck profile delete ${name}`,
                          confirmLabel: "Delete",
                          danger: true,
                        },
                        () => {
                          void store.profileDelete(name);
                          setProfiles((current) => {
                            const next = { ...current };
                            delete next[name];
                            return next;
                          });
                        },
                      );
                    }}
                  >
                    {"[delete]"}
                  </text>
                </box>
              </box>
            ))
          )}
          <box flexDirection="row" gap={1}>
            <text fg={theme.dim()}>{"name:"}</text>
            {editing ? (
              <input
                focused
                value={nameValue}
                onInput={setNameValue}
                onSubmit={() => {
                  setEditing(false);
                  if (nameValue.length > 0) void store.profileSaveFromSelection(nameValue);
                }}
                width={18}
              />
            ) : (
              <text
                fg={theme.accent()}
                onMouseDown={(event) => {
                  event.stopPropagation?.();
                  setEditing(true);
                }}
              >
                {nameValue || "[n] save profile"}
              </text>
            )}
            <text
              fg={theme.dim()}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                if (nameValue.length > 0) {
                  void store.profileSaveFromSelection(nameValue);
                  setEditing(false);
                }
              }}
            >
              {` from: selection (${snapshot.selected.size}) or pinned (${pinned.length})`}
            </text>
          </box>
        </box>
      </box>
      <text fg={theme.dim()}>
        {"profile save <name> · profiles feed the Sync and Run scope pickers · Esc cockpit"}
      </text>
    </box>
  );
}

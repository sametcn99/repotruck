import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { visibleSlice } from "../windowing.ts";

/**
 * `repotruck profile list/pin/unpin/save/delete` as a page: pinned repos
 * with bulk pin/unpin from the cockpit selection, named profiles with
 * save-from-selection / pinned and delete, plus scope handoffs to sync and
 * run.
 */
export function ProfilesView({
  store,
  width,
  height: heightProp,
}: {
  store: Store;
  width: number;
  height?: number;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height: termHeight } = useTerminalDimensions();
  const height = heightProp ?? Math.max(12, termHeight - 4);
  const [nameValue, setNameValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, string[]>>({});
  const [scrollIdx, setScrollIdx] = useState(0);

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
  }, [store]);

  const pinned = [...snapshot.localHealth.entries()]
    .filter(([, health]) => health.pinned)
    .map(([key]) => key);
  const profileEntries = Object.entries(profiles);
  const maxItems = Math.max(pinned.length, profileEntries.length);

  useKeyboard((key) => {
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "n") setEditing(true);
    else if (key.name === "p") void store.togglePinSelection();
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(Math.max(0, maxItems - 1), s + 1));
    }
  });

  const stacked = width < 78;
  const half = stacked ? width : Math.max(20, Math.floor((width - 2) / 2));
  const pinnedBudget = stacked
    ? Math.max(1, Math.floor((height - 10) / 3))
    : Math.max(2, height - 8);
  const profileBudget = stacked
    ? Math.max(1, Math.floor((height - 12) / 4))
    : Math.max(1, Math.floor((height - 9) / 3));
  const pinnedWin = visibleSlice(
    Math.min(scrollIdx, Math.max(0, pinned.length - 1)),
    pinned.length,
    pinnedBudget,
  );
  const visiblePinned = pinned.slice(pinnedWin.start, pinnedWin.end);
  const profileWin = visibleSlice(
    Math.min(scrollIdx, Math.max(0, profileEntries.length - 1)),
    profileEntries.length,
    profileBudget,
  );
  const visibleProfiles = profileEntries.slice(profileWin.start, profileWin.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) => Math.min(Math.max(0, maxItems - 1), Math.max(0, s + (isUp ? -1 : 1))));
      }}
    >
      <box
        flexDirection={stacked ? "column" : "row"}
        flexGrow={1}
        gap={stacked ? 0 : 1}
        width="100%"
      >
        <box
          border
          borderColor={theme.border()}
          flexDirection="column"
          width={stacked ? "100%" : half}
          overflow="hidden"
        >
          <text fg={theme.dim()} wrapMode="none">
            {" Pinned (Active Focus)"}
          </text>
          {pinned.length === 0 ? (
            <text fg={theme.dim()} wrapMode="none">
              {"  nothing pinned — P in the cockpit or [p] here"}
            </text>
          ) : (
            visiblePinned.map((key) => (
              <text key={key} fg={theme.normal()} wrapMode="none">
                {` ★ ${key}`}
              </text>
            ))
          )}
          <text
            fg={theme.accent()}
            wrapMode="none"
            onMouseDown={(event) => {
              event.stopPropagation?.();
              void store.togglePinSelection();
            }}
          >
            {` [p] pin/unpin cockpit selection (${snapshot.selected.size})`}
          </text>
        </box>
        <box
          border
          borderColor={theme.border()}
          flexDirection="column"
          width={stacked ? "100%" : half}
          overflow="hidden"
        >
          <text fg={theme.dim()} wrapMode="none">
            {" Named profiles"}
          </text>
          {profileEntries.length === 0 ? (
            <text fg={theme.dim()} wrapMode="none">
              {"  no named profiles yet"}
            </text>
          ) : (
            visibleProfiles.map(([name, refs]) => (
              <box key={name} flexDirection="column">
                <text fg={theme.normal()} wrapMode="none">{` ${name} · ${refs.length} repos`}</text>
                <text
                  fg={theme.dim()}
                  wrapMode="none"
                >{`   ${refs.slice(0, 3).join(", ")}${refs.length > 3 ? " …" : ""}`}</text>
                <box flexDirection="row" flexWrap="wrap" gap={2}>
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
          <box flexDirection="row" flexWrap="wrap" gap={1}>
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
              wrapMode="none"
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
      <text fg={theme.dim()} wrapMode="none">
        {"profile save <name> · profiles feed the Sync and Run scope pickers · Esc cockpit"}
      </text>
    </box>
  );
}

import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { clampBoxLine, scrollSlice } from "../windowing.ts";

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
  const height = heightProp ?? Math.max(8, termHeight - 11);
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

  const stacked = width < 78;
  const boxInnerCols = stacked
    ? Math.max(10, width - 3)
    : Math.max(10, Math.floor((width - 1) / 2) - 3);
  const pinnedBudget = stacked
    ? Math.max(1, Math.floor((height - 1) / 2) - 4)
    : Math.max(1, height - 5);
  const profileBudget = stacked
    ? Math.max(1, Math.floor((Math.floor((height - 1) / 2) - 4) / 3))
    : Math.max(1, Math.floor((height - 5) / 3));
  const maxScroll = Math.max(
    0,
    Math.max(pinned.length - pinnedBudget, profileEntries.length - profileBudget),
  );

  useKeyboard((key) => {
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "n") setEditing(true);
    else if (key.name === "p") void store.togglePinSelection();
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, Math.min(s, maxScroll) - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(maxScroll, s + 1));
    }
  });

  const pinnedWin = scrollSlice(scrollIdx, pinned.length, pinnedBudget);
  const visiblePinned = pinned.slice(pinnedWin.start, pinnedWin.end);
  const profileWin = scrollSlice(scrollIdx, profileEntries.length, profileBudget);
  const visibleProfiles = profileEntries.slice(profileWin.start, profileWin.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) =>
          Math.min(maxScroll, Math.max(0, Math.min(s, maxScroll) + (isUp ? -1 : 1))),
        );
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
          flexGrow={1}
          flexBasis={stacked ? undefined : 0}
          width={stacked ? "100%" : undefined}
          overflow="hidden"
        >
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {clampBoxLine(
              pinned.length > pinnedBudget
                ? ` Pinned (Active Focus · ${pinnedWin.start + 1}-${pinnedWin.end}/${pinned.length})`
                : " Pinned (Active Focus)",
              boxInnerCols,
            )}
          </text>
          {pinned.length === 0 ? (
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {clampBoxLine("  nothing pinned — P in the cockpit or [p] here", boxInnerCols)}
            </text>
          ) : (
            visiblePinned.map((key) => (
              <text key={key} fg={theme.normal()} wrapMode="none" flexShrink={0}>
                {clampBoxLine(` ★ ${key}`, boxInnerCols)}
              </text>
            ))
          )}
          <text
            fg={theme.accent()}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              void store.togglePinSelection();
            }}
          >
            {clampBoxLine(
              ` [p] pin/unpin cockpit selection (${snapshot.selected.size})`,
              boxInnerCols,
            )}
          </text>
        </box>
        <box
          border
          borderColor={theme.border()}
          flexDirection="column"
          flexGrow={1}
          flexBasis={stacked ? undefined : 0}
          width={stacked ? "100%" : undefined}
          overflow="hidden"
        >
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {clampBoxLine(
              profileEntries.length > profileBudget
                ? ` Named profiles (${profileWin.start + 1}-${profileWin.end}/${profileEntries.length})`
                : " Named profiles",
              boxInnerCols,
            )}
          </text>
          {profileEntries.length === 0 ? (
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {"  no named profiles yet"}
            </text>
          ) : (
            visibleProfiles.map(([name, refs]) => (
              <box key={name} flexDirection="column" flexShrink={0}>
                <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
                  {clampBoxLine(` ${name} · ${refs.length} repos`, boxInnerCols)}
                </text>
                <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
                  {clampBoxLine(
                    `   ${refs.slice(0, 3).join(", ")}${refs.length > 3 ? " …" : ""}`,
                    boxInnerCols,
                  )}
                </text>
                <box flexDirection="row" gap={2} flexShrink={0}>
                  <text
                    fg={theme.accent()}
                    wrapMode="none"
                    flexShrink={0}
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      store.setView("sync");
                    }}
                  >
                    {"   [⇅ sync]"}
                  </text>
                  <text
                    fg={theme.accent()}
                    wrapMode="none"
                    flexShrink={0}
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
                    wrapMode="none"
                    flexShrink={0}
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
          <box flexDirection="row" gap={1} flexShrink={0}>
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {" name:"}
            </text>
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
                wrapMode="none"
                flexShrink={0}
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
              flexShrink={0}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                if (nameValue.length > 0) {
                  void store.profileSaveFromSelection(nameValue);
                  setEditing(false);
                }
              }}
            >
              {clampBoxLine(
                `from: selection (${snapshot.selected.size}) or pinned (${pinned.length})`,
                Math.max(10, boxInnerCols - 24),
              )}
            </text>
          </box>
        </box>
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          "profile save <name> · profiles feed the Sync and Run scope pickers · Esc cockpit",
          width,
        )}
      </text>
    </box>
  );
}

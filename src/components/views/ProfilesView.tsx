import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { PaneTabs } from "../ui/PaneTabs.tsx";
import { clampBoxLine, visibleSlice } from "../windowing.ts";

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
  const profiles = snapshot.profiles;
  const [pane, setPane] = useState<"pinned" | "profiles">("pinned");
  const [pinnedCursor, setPinnedCursor] = useState(0);
  const [profileCursor, setProfileCursor] = useState(0);

  const pinned = [...snapshot.localHealth.entries()]
    .filter(([, health]) => health.pinned)
    .map(([key]) => key);
  const profileEntries = Object.entries(profiles);

  const stacked = width < 78;
  const compactPanes = stacked && height < 22;
  const boxInnerCols = stacked
    ? Math.max(10, width - 3)
    : Math.max(10, Math.floor((width - 1) / 2) - 3);
  const pinnedBudget = compactPanes
    ? Math.max(1, height - 6)
    : stacked
      ? Math.max(1, Math.floor((height - 1) / 2) - 4)
      : Math.max(1, height - 5);
  const profileBudget = compactPanes
    ? Math.max(1, Math.floor((height - 7) / 2))
    : stacked
      ? Math.max(1, Math.floor((Math.floor((height - 1) / 2) - 4) / 3))
      : Math.max(1, Math.floor((height - 5) / 3));

  const maxPinned = Math.max(0, pinned.length - 1);
  const clampedPinnedCursor = Math.min(pinnedCursor, maxPinned);
  const maxProfile = Math.max(0, profileEntries.length - 1);
  const clampedProfileCursor = Math.min(profileCursor, maxProfile);

  const inputFocused =
    editing &&
    !snapshot.navFocused &&
    snapshot.dialog === null &&
    snapshot.modal === null &&
    snapshot.contextMenu === null;
  const viewFocused =
    !editing &&
    !snapshot.navFocused &&
    snapshot.dialog === null &&
    snapshot.modal === null &&
    snapshot.contextMenu === null;

  const confirmDeleteProfile = (name: string) => {
    store.confirmDialog(
      {
        title: `Delete profile ${name}?`,
        message: `repotruck profile delete ${name}`,
        confirmLabel: "Delete",
        danger: true,
      },
      () => {
        void store.profileDelete(name);
      },
    );
  };

  useKeyboard((key) => {
    const snap = store.getSnapshot();
    if (
      snap.navFocused ||
      snap.dialog !== null ||
      snap.modal !== null ||
      snap.contextMenu !== null
    ) {
      return;
    }
    if (editing) {
      if (key.name === "escape") setEditing(false);
      return;
    }
    if (key.name === "tab") {
      setPane(pane === "pinned" ? "profiles" : "pinned");
    } else if (key.name === "n") {
      setPane("profiles");
      setEditing(true);
    } else if (key.name === "p") {
      void store.togglePinSelection();
    } else if (key.name === "left" || key.sequence === "h") {
      setPane("pinned");
    } else if (key.name === "right" || key.sequence === "l") {
      setPane("profiles");
    } else if (key.name === "up" || key.sequence === "k") {
      if (pane === "pinned") setPinnedCursor((c) => Math.max(0, Math.min(c, maxPinned) - 1));
      else setProfileCursor((c) => Math.max(0, Math.min(c, maxProfile) - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      if (pane === "pinned")
        setPinnedCursor((c) => Math.min(maxPinned, Math.min(c, maxPinned) + 1));
      else setProfileCursor((c) => Math.min(maxProfile, Math.min(c, maxProfile) + 1));
    } else if (key.name === "home" || key.sequence === "g") {
      if (pane === "pinned") setPinnedCursor(0);
      else setProfileCursor(0);
    } else if (
      key.name === "end" ||
      key.sequence === "G" ||
      (key.shift === true && key.name === "g")
    ) {
      if (pane === "pinned") setPinnedCursor(maxPinned);
      else setProfileCursor(maxProfile);
    } else if (
      pane === "pinned" &&
      (key.name === "return" || key.name === "space" || key.name === "o")
    ) {
      const target = pinned[clampedPinnedCursor];
      if (target !== undefined) store.openDetailModal(target);
    } else if (pane === "profiles") {
      const entry = profileEntries[clampedProfileCursor];
      if (entry === undefined) return;
      const [profileName] = entry;
      if (key.name === "s" || key.name === "return") {
        store.setView("sync");
      } else if (key.name === "r" || key.sequence === "R") {
        store.updateRunConsole({ scope: "profile", profile: profileName });
        store.setView("run");
      } else if (key.name === "d" || key.name === "x") {
        confirmDeleteProfile(profileName);
      }
    }
  });

  const pinnedWin = visibleSlice(clampedPinnedCursor, pinned.length, pinnedBudget);
  const visiblePinned = pinned.slice(pinnedWin.start, pinnedWin.end);
  const profileWin = visibleSlice(clampedProfileCursor, profileEntries.length, profileBudget);
  const visibleProfiles = profileEntries.slice(profileWin.start, profileWin.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        if (pane === "pinned") {
          setPinnedCursor((c) =>
            Math.min(maxPinned, Math.max(0, Math.min(c, maxPinned) + (isUp ? -1 : 1))),
          );
        } else {
          setProfileCursor((c) =>
            Math.min(maxProfile, Math.max(0, Math.min(c, maxProfile) + (isUp ? -1 : 1))),
          );
        }
      }}
    >
      {compactPanes ? (
        <PaneTabs
          panes={
            [
              ["pinned", "Pinned"],
              ["profiles", "Profiles"],
            ] as const
          }
          selected={pane}
          onSelect={setPane}
        />
      ) : null}
      <box
        flexDirection={stacked ? "column" : "row"}
        flexGrow={1}
        gap={stacked ? 0 : 1}
        width="100%"
      >
        <box
          visible={!compactPanes || pane === "pinned"}
          border
          borderColor={viewFocused && pane === "pinned" ? theme.focusBorder() : theme.border()}
          flexDirection="column"
          flexGrow={1}
          flexBasis={stacked ? undefined : 0}
          width={stacked ? "100%" : undefined}
          overflow="hidden"
          onMouseDown={() => setPane("pinned")}
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
            visiblePinned.map((key, offset) => {
              const idx = pinnedWin.start + offset;
              const isCursor = viewFocused && pane === "pinned" && idx === clampedPinnedCursor;
              return (
                <text
                  key={key}
                  fg={isCursor ? theme.cursorFg() : theme.normal()}
                  bg={isCursor ? theme.cursorBg() : undefined}
                  wrapMode="none"
                  flexShrink={0}
                  onMouseDown={(event) => {
                    event.stopPropagation?.();
                    setPane("pinned");
                    setPinnedCursor(idx);
                    store.openDetailModal(key);
                  }}
                >
                  {clampBoxLine(`${isCursor ? ">" : " "} ★ ${key}`, boxInnerCols)}
                </text>
              );
            })
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
          visible={!compactPanes || pane === "profiles"}
          border
          borderColor={viewFocused && pane === "profiles" ? theme.focusBorder() : theme.border()}
          flexDirection="column"
          flexGrow={1}
          flexBasis={stacked ? undefined : 0}
          width={stacked ? "100%" : undefined}
          overflow="hidden"
          onMouseDown={() => setPane("profiles")}
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
            visibleProfiles.map(([name, refs], offset) => {
              const idx = profileWin.start + offset;
              const isCursor = viewFocused && pane === "profiles" && idx === clampedProfileCursor;
              return (
                <box
                  key={name}
                  flexDirection="column"
                  flexShrink={0}
                  onMouseDown={() => {
                    setPane("profiles");
                    setProfileCursor(idx);
                  }}
                >
                  <text
                    fg={isCursor ? theme.cursorFg() : theme.normal()}
                    bg={isCursor ? theme.cursorBg() : undefined}
                    wrapMode="none"
                    flexShrink={0}
                  >
                    {clampBoxLine(
                      `${isCursor ? ">" : " "} ${name} · ${refs.length} repos`,
                      boxInnerCols,
                    )}
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
                        setPane("profiles");
                        setProfileCursor(idx);
                        store.setView("sync");
                      }}
                    >
                      {"   [⇅ s:sync]"}
                    </text>
                    <text
                      fg={theme.accent()}
                      wrapMode="none"
                      flexShrink={0}
                      onMouseDown={(event) => {
                        event.stopPropagation?.();
                        setPane("profiles");
                        setProfileCursor(idx);
                        store.updateRunConsole({ scope: "profile", profile: name });
                        store.setView("run");
                      }}
                    >
                      {"[▶ r:run]"}
                    </text>
                    <text
                      fg={theme.error()}
                      wrapMode="none"
                      flexShrink={0}
                      onMouseDown={(event) => {
                        event.stopPropagation?.();
                        setPane("profiles");
                        setProfileCursor(idx);
                        confirmDeleteProfile(name);
                      }}
                    >
                      {"[d:delete]"}
                    </text>
                  </box>
                </box>
              );
            })
          )}
          <box flexDirection="row" gap={1} flexShrink={0}>
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {" name:"}
            </text>
            {editing ? (
              <input
                focused={inputFocused}
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
          editing
            ? "Enter save profile · Esc actions · F1 help"
            : "←→ pane · ↑↓ move · Enter open/sync · r run · d delete · n save · p pin",
          width,
        )}
      </text>
    </box>
  );
}

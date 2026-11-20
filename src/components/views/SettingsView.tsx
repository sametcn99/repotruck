import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";
import { clampBoxLine, visibleSlice } from "../windowing.ts";

const SETTING_KEYS = [
  { key: "sync.concurrency", label: "sync concurrency", type: "int" },
  { key: "sync.depth", label: "sync clone depth", type: "int-or-off" },
  { key: "sync.blobless", label: "sync blobless", type: "bool" },
  { key: "sync.stash", label: "sync stash", type: "bool" },
  { key: "sync.divergence", label: "sync divergence", type: "enum:fail/rebase/reset/skip" },
  { key: "github.baseUrl", label: "github base url", type: "url" },
  { key: "defaultRoot", label: "default root", type: "path" },
  { key: "theme", label: "theme", type: "enum:default/light/contrast" },
] as const;

/**
 * `repotruck config …` + `auth status` + `update` + `completions` as a
 * page: settings rows with inline editing (get/set/unset parity), auth
 * method badge, self-update handoff and shell completion helpers.
 */
export function SettingsView({
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
  const page = snapshot.settingsPage;
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (page === null) void store.refreshSettingsPage();
  }, [page, store]);

  const settings = page?.settings ?? null;
  const inner = Math.max(24, width - 4);
  const stacked = width < 82;
  const rightColWidth = stacked ? width : Math.max(30, Math.floor(width * 0.36));
  const leftColWidth = stacked ? width : Math.max(24, width - rightColWidth - 1);
  const leftInnerCols = Math.max(10, leftColWidth - 3);
  // Left box has 2 borders + 1 header line inside (height - 1) outer rows = height - 4 setting rows.
  const settingCap = stacked ? Math.max(2, height - 10) : Math.max(2, height - 4);
  const maxCursor = SETTING_KEYS.length - 1;
  const clampedCursor = Math.min(cursor, maxCursor);
  const focused =
    !snapshot.navFocused &&
    snapshot.dialog === null &&
    snapshot.modal === null &&
    snapshot.contextMenu === null;

  const activateSetting = (entry: (typeof SETTING_KEYS)[number]) => {
    const raw = readSetting(settings, entry.key);
    if (entry.key === "sync.blobless" || entry.key === "sync.stash") {
      void store.setSetting(entry.key, !(raw.value === true));
      return;
    }
    if (entry.key === "sync.divergence") {
      const opts = ["fail", "rebase", "reset", "skip"] as const;
      const cur = typeof raw.value === "string" ? raw.value : "fail";
      const next = opts[(opts.indexOf(cur as "fail") + 1) % opts.length]!;
      void store.setSetting(entry.key, next);
      return;
    }
    if (entry.key === "sync.concurrency") {
      const opts = [1, 2, 3, 5, 8] as const;
      const cur = typeof raw.value === "number" ? raw.value : 3;
      const next = opts[(opts.indexOf(cur as 3) + 1) % opts.length]!;
      void store.setSetting(entry.key, next);
      return;
    }
    if (entry.key === "sync.depth") {
      const opts = [0, 1, 5, 10] as const;
      const cur = typeof raw.value === "number" ? raw.value : 0;
      const next = opts[(opts.indexOf(cur as 0) + 1) % opts.length]!;
      void store.setSetting(entry.key, next);
      return;
    }
    if (entry.key === "theme") {
      void store.cycleTheme().then(() => store.refreshSettingsPage());
      return;
    }
    store.confirmDialog(
      {
        title: `Edit ${entry.key}`,
        message: `editing ${entry.key} (${entry.type}) — CLI: config set ${entry.key} <value>`,
        confirmLabel: "OK",
      },
      () => {},
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
    if (key.name === "r") {
      void store.refreshSettingsPage();
    } else if (key.name === "l") {
      void store.startDeviceFlow();
    } else if (key.name === "up" || key.sequence === "k") {
      setCursor((c) => Math.max(0, Math.min(c, maxCursor) - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setCursor((c) => Math.min(maxCursor, Math.min(c, maxCursor) + 1));
    } else if (key.name === "home" || key.sequence === "g") {
      setCursor(0);
    } else if (
      key.name === "end" ||
      key.sequence === "G" ||
      (key.shift === true && key.name === "g")
    ) {
      setCursor(maxCursor);
    } else if (key.name === "return" || key.name === "space") {
      const entry = SETTING_KEYS[clampedCursor];
      if (entry !== undefined) activateSetting(entry);
    } else if (key.name === "u") {
      const entry = SETTING_KEYS[clampedCursor];
      if (entry !== undefined) {
        const raw = readSetting(settings, entry.key);
        if (!raw.isDefault) void store.unsetSetting(entry.key);
      }
    }
  });

  const win = visibleSlice(clampedCursor, SETTING_KEYS.length, settingCap);
  const visibleSettings = SETTING_KEYS.slice(win.start, win.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setCursor((c) =>
          Math.min(maxCursor, Math.max(0, Math.min(c, maxCursor) + (isUp ? -1 : 1))),
        );
      }}
    >
      <box
        flexDirection={stacked ? "column" : "row"}
        gap={stacked ? 0 : 1}
        flexGrow={1}
        width="100%"
      >
        <box
          border
          borderColor={focused ? theme.focusBorder() : theme.border()}
          flexDirection="column"
          flexGrow={1}
          width={stacked ? "100%" : leftColWidth}
          padding={0}
          overflow="hidden"
        >
          <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
            {clampBoxLine(" Configuration (config list)", leftInnerCols)}
          </text>
          {visibleSettings.map((entry, offset) => {
            const idx = win.start + offset;
            const isCursor = focused && idx === clampedCursor;
            const raw = readSetting(settings, entry.key);
            const isDefault = raw.isDefault;
            const padCols = Math.max(10, Math.min(18, leftInnerCols - 22));
            return (
              <box
                key={entry.key}
                flexDirection="row"
                gap={1}
                flexShrink={0}
                onMouseDown={() => setCursor(idx)}
              >
                <text
                  fg={isCursor ? theme.cursorFg() : theme.normal()}
                  bg={isCursor ? theme.cursorBg() : undefined}
                  wrapMode="none"
                  flexShrink={0}
                >
                  {`${isCursor ? ">" : " "}${entry.label.padEnd(padCols)}`}
                </text>
                <text fg={isDefault ? theme.dim() : theme.accent()} wrapMode="none" flexShrink={0}>
                  {clampBoxLine(
                    String(raw.value ?? "(default)"),
                    Math.max(8, leftInnerCols - padCols - 18),
                  )}
                </text>
                <text
                  fg={theme.dim()}
                  wrapMode="none"
                  flexShrink={0}
                  onMouseDown={(event) => {
                    event.stopPropagation?.();
                    setCursor(idx);
                    activateSetting(entry);
                  }}
                >
                  {" [edit]"}
                </text>
                {!isDefault ? (
                  <text
                    fg={theme.warning()}
                    wrapMode="none"
                    flexShrink={0}
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      setCursor(idx);
                      void store.unsetSetting(entry.key);
                    }}
                  >
                    {" [unset]"}
                  </text>
                ) : null}
                <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
                  {isDefault ? " default" : " settings"}
                </text>
              </box>
            );
          })}
        </box>
        <box flexDirection="column" width={stacked ? "100%" : rightColWidth} flexShrink={0}>
          <box
            border
            borderColor={theme.border()}
            flexDirection="column"
            overflow="hidden"
            flexShrink={0}
          >
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {" Auth & connection"}
            </text>
            <box flexDirection="row" gap={1} flexShrink={0}>
              <text
                fg={page?.authMethod ? theme.success() : theme.error()}
                wrapMode="none"
                flexShrink={0}
              >
                {` method: ${page?.authMethod ?? "none"}`}
              </text>
              <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
                {`· login: ${page?.userLogin ?? "—"}`}
              </text>
            </box>
            <box flexDirection="row" gap={1} flexShrink={0}>
              <text
                fg={theme.accent()}
                wrapMode="none"
                flexShrink={0}
                onMouseDown={(event) => {
                  event.stopPropagation?.();
                  void store.startDeviceFlow();
                }}
              >
                {" [l] login device flow"}
              </text>
              <text
                fg={theme.error()}
                wrapMode="none"
                flexShrink={0}
                onMouseDown={(event) => {
                  event.stopPropagation?.();
                  store.confirmDialog(
                    {
                      title: "Logout",
                      message: "Log out of cached GitHub credentials?",
                      confirmLabel: "Logout",
                      danger: true,
                    },
                    () => {
                      store.pushStatus(
                        "DONE",
                        "[auth]",
                        "repotruck auth logout — run it in a terminal (token files are shared)",
                      );
                    },
                  );
                }}
              >
                {"[logout]"}
              </text>
            </box>
          </box>
          <box
            border
            borderColor={theme.border()}
            flexDirection="column"
            overflow="hidden"
            flexShrink={0}
          >
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {" Update"}
            </text>
            <box flexDirection="row" gap={1} flexShrink={0}>
              <text fg={theme.normal()} wrapMode="none" flexShrink={0}>
                {snapshot.updateToast !== null
                  ? ` ${snapshot.updateToast.version} available`
                  : " up to date"}
              </text>
              <text
                fg={theme.accent()}
                wrapMode="none"
                flexShrink={0}
                onMouseDown={(event) => {
                  event.stopPropagation?.();
                  const result = copyText("update", "npm i -g repotruck@latest");
                  store.pushStatus(
                    result.ok ? "DONE" : "FAILED",
                    "[update]",
                    result.ok
                      ? "self-update command copied — the dashboard suspends during updates"
                      : result.message,
                  );
                }}
              >
                {"[self-update] copy command"}
              </text>
            </box>
          </box>
          <box
            border
            borderColor={theme.border()}
            flexDirection="column"
            flexGrow={stacked ? 0 : 1}
            overflow="hidden"
            flexShrink={0}
          >
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {" Shell completions"}
            </text>
            <box flexDirection="row" flexWrap="wrap" gap={0} flexShrink={0}>
              {["bash", "zsh", "fish", "powershell"].map((shell) => (
                <text
                  key={shell}
                  fg={theme.normal()}
                  wrapMode="none"
                  flexShrink={0}
                  onMouseDown={(event) => {
                    event.stopPropagation?.();
                    const result = copyText(
                      `completions ${shell}`,
                      `repotruck completions ${shell}`,
                    );
                    store.pushStatus(
                      result.ok ? "DONE" : "FAILED",
                      "[completions]",
                      result.ok ? `completions ${shell} script command copied` : result.message,
                    );
                  }}
                >
                  {` [${shell}]`}
                </text>
              ))}
            </box>
          </box>
        </box>
      </box>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          "↑↓/jk move · Enter/Space cycle/edit · u unset · l login · r refresh · Esc cockpit",
          inner,
        )}
      </text>
    </box>
  );
}

function readSetting(pageSettings: unknown, key: string): { value: unknown; isDefault: boolean } {
  if (pageSettings === null || pageSettings === undefined) return { value: null, isDefault: true };
  const settings = pageSettings as Record<string, unknown>;
  const sync = (settings as { sync?: Record<string, unknown> }).sync;
  if (key.startsWith("sync.") && sync !== undefined) {
    const value = sync[key.slice(5)];
    if (value !== undefined) return { value, isDefault: false };
  }
  const top = (settings as Record<string, unknown>)[key];
  if (top !== undefined) return { value: top, isDefault: false };
  return { value: null, isDefault: true };
}

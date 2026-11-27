import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { standaloneUpdateCommand, standaloneVersion } from "../../services/distribution.ts";
import { normalizeBaseUrl, validateRootInput } from "../../services/settings.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";
import { PaneTabs } from "../ui/PaneTabs.tsx";
import { clampBoxLine, visibleSlice } from "../windowing.ts";

const SHELLS = ["bash", "zsh", "fish", "powershell"] as const;
const UPDATE_COMMAND = standaloneVersion
  ? (standaloneUpdateCommand() ?? "repotruck update --check")
  : "npm i -g repotruck@latest";

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
  const [pane, setPane] = useState<"configuration" | "tools">("configuration");
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<{
    key: "defaultRoot" | "github.baseUrl";
    value: string;
  } | null>(null);

  const copyCommand = (name: string, command: string) => {
    const result = copyText(name, command);
    store.pushStatus(result.ok ? "DONE" : "FAILED", `[${name}]`, result.message);
  };
  const logout = () => {
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
  };

  useEffect(() => {
    if (page === null) void store.refreshSettingsPage();
  }, [page, store]);

  const settings = page?.settings ?? null;
  const inner = Math.max(24, width - 4);
  const stacked = width < 82;
  const compactPanes = stacked && height < 22;
  const rightColWidth = stacked ? width : Math.max(30, Math.floor(width * 0.36));
  const leftColWidth = stacked ? width : Math.max(24, width - rightColWidth - 1);
  const leftInnerCols = Math.max(10, leftColWidth - 3);
  // Left box has 2 borders + 1 header line inside (height - 1) outer rows = height - 4 setting rows.
  const settingCap = Math.max(
    1,
    height - (compactPanes ? 5 : stacked ? 15 : 4) - (editing === null ? 0 : 1),
  );
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
    if (entry.key === "defaultRoot" || entry.key === "github.baseUrl") {
      setEditing({ key: entry.key, value: typeof raw.value === "string" ? raw.value : "" });
    }
  };

  const saveTextSetting = () => {
    if (editing === null) return;
    try {
      let value: string;
      if (editing.key === "defaultRoot") {
        const validated = validateRootInput(editing.value);
        if (!validated.ok) throw new Error(validated.error);
        value = validated.root;
      } else {
        value = normalizeBaseUrl(editing.value.trim());
      }
      setEditing(null);
      void store.setSetting(editing.key, value);
    } catch (error) {
      store.pushStatus(
        "FAILED",
        "[config]",
        error instanceof Error ? error.message : String(error),
      );
    }
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
    if (editing !== null) {
      if (key.name === "escape") setEditing(null);
      return;
    }
    if (key.name === "tab" && compactPanes) {
      setPane(pane === "configuration" ? "tools" : "configuration");
      return;
    }
    const shell = SHELLS[Number(key.sequence) - 1];
    if (shell !== undefined) {
      copyCommand("completions", `repotruck completions ${shell}`);
    } else if (key.name === "y") {
      copyCommand("update", UPDATE_COMMAND);
    } else if (key.name === "x") {
      logout();
    } else if (key.name === "r") {
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
      {compactPanes ? (
        <PaneTabs
          panes={
            [
              ["configuration", "Configuration"],
              ["tools", "Tools"],
            ] as const
          }
          selected={pane}
          onSelect={setPane}
        />
      ) : null}
      <box
        flexDirection={stacked ? "column" : "row"}
        gap={stacked ? 0 : 1}
        flexGrow={1}
        width="100%"
      >
        <box
          visible={!compactPanes || pane === "configuration"}
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
                  {" [Enter] Edit"}
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
                    {" [u] Unset"}
                  </text>
                ) : null}
                <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
                  {isDefault ? " default" : " settings"}
                </text>
              </box>
            );
          })}
        </box>
        <box
          visible={!compactPanes || pane === "tools"}
          flexDirection="column"
          width={stacked ? "100%" : rightColWidth}
          flexShrink={0}
        >
          {compactPanes ? (
            <box flexDirection="column" flexShrink={0}>
              <text fg={theme.normal()} wrapMode="none">
                {clampBoxLine(
                  `Auth: ${page?.authMethod ?? "none"} · ${page?.userLogin ?? "—"}`,
                  inner,
                )}
              </text>
              <box flexDirection="row" gap={2} flexShrink={0}>
                <text fg={theme.accent()} onMouseDown={() => void store.startDeviceFlow()}>
                  {"[l] Login"}
                </text>
                <text fg={theme.warning()} onMouseDown={logout}>
                  {"[x] Logout"}
                </text>
              </box>
              <text
                fg={theme.accent()}
                wrapMode="none"
                onMouseDown={() => copyCommand("update", UPDATE_COMMAND)}
              >
                {"[y] Copy update command"}
              </text>
              <text fg={theme.dim()} wrapMode="none">
                {"Copy shell completions"}
              </text>
              <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
                {SHELLS.map((shell, index) => (
                  <text
                    key={shell}
                    fg={theme.accent()}
                    onMouseDown={() => copyCommand("completions", `repotruck completions ${shell}`)}
                  >
                    {`[${index + 1}] ${shell}`}
                  </text>
                ))}
              </box>
            </box>
          ) : (
            <>
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
                      logout();
                    }}
                  >
                    {"[x] Logout"}
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
                      copyCommand("update", UPDATE_COMMAND);
                    }}
                  >
                    {"[y] Copy update command"}
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
                  {SHELLS.map((shell, index) => (
                    <text
                      key={shell}
                      fg={theme.normal()}
                      wrapMode="none"
                      flexShrink={0}
                      onMouseDown={(event) => {
                        event.stopPropagation?.();
                        copyCommand("completions", `repotruck completions ${shell}`);
                      }}
                    >
                      {` [${index + 1}] ${shell}`}
                    </text>
                  ))}
                </box>
              </box>
            </>
          )}
        </box>
      </box>
      {editing !== null ? (
        <box flexDirection="column" flexShrink={0}>
          <text fg={theme.accent()} wrapMode="none">
            {`${editing.key} · Enter save · Esc cancel`}
          </text>
          <input
            focused={focused}
            value={editing.value}
            onInput={(value) => setEditing({ ...editing, value })}
            onSubmit={saveTextSetting}
            placeholder={editing.key === "defaultRoot" ? "~/repotruck" : "https://ghe.example.com"}
            width="100%"
          />
        </box>
      ) : (
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {clampBoxLine("↑↓ Settings · Enter edit · u unset · r refresh", inner)}
        </text>
      )}
    </box>
  );
}

function readSetting(pageSettings: unknown, key: string): { value: unknown; isDefault: boolean } {
  if (pageSettings === null || pageSettings === undefined) return { value: null, isDefault: true };
  const settings = pageSettings as Record<string, unknown>;
  const [section, field] = key.split(".");
  const value = section === undefined ? undefined : settings[section];
  const top =
    field !== undefined && typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[field]
      : value;
  if (top !== undefined) return { value: top, isDefault: false };
  return { value: null, isDefault: true };
}

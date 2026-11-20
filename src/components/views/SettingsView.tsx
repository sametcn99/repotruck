import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";
import { visibleSlice } from "../windowing.ts";

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
  const height = heightProp ?? Math.max(12, termHeight - 4);
  const page = snapshot.settingsPage;
  const [scrollIdx, setScrollIdx] = useState(0);

  useEffect(() => {
    if (page === null) void store.refreshSettingsPage();
  }, [page, store]);

  useKeyboard((key) => {
    if (key.name === "r") void store.refreshSettingsPage();
    else if (key.name === "up" || key.sequence === "k") {
      setScrollIdx((s) => Math.max(0, s - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setScrollIdx((s) => Math.min(SETTING_KEYS.length - 1, s + 1));
    }
  });

  const settings = page?.settings ?? null;
  const inner = Math.max(24, width - 4);
  const stacked = width < 82;
  const settingCap = stacked ? Math.max(3, height - 14) : Math.max(3, height - 7);
  const win = visibleSlice(
    Math.min(scrollIdx, SETTING_KEYS.length - 1),
    SETTING_KEYS.length,
    settingCap,
  );
  const visibleSettings = SETTING_KEYS.slice(win.start, win.end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setScrollIdx((s) => Math.min(SETTING_KEYS.length - 1, Math.max(0, s + (isUp ? -1 : 1))));
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
          borderColor={theme.border()}
          flexDirection="column"
          flexGrow={1}
          width={stacked ? "100%" : undefined}
          padding={0}
          overflow="hidden"
        >
          <text fg={theme.dim()} wrapMode="none">
            {" Configuration (config list)"}
          </text>
          {visibleSettings.map((entry) => {
            const raw = readSetting(settings, entry.key);
            const isDefault = raw.isDefault;
            return (
              <box key={entry.key} flexDirection="row" flexWrap="wrap" gap={1}>
                <text fg={theme.normal()} wrapMode="none">
                  {` ${entry.label.padEnd(Math.max(10, Math.min(18, inner - 24)))}`}
                </text>
                <text fg={isDefault ? theme.dim() : theme.accent()} wrapMode="none">
                  {String(raw.value || "(default)")}
                </text>
                <text
                  fg={theme.dim()}
                  wrapMode="none"
                  onMouseDown={(event) => {
                    event.stopPropagation?.();
                    store.confirmDialog(
                      {
                        title: `Edit ${entry.key}`,
                        message: `editing ${entry.key} (${entry.type}) — value editing lands with the field inputs; CLI: config set ${entry.key} <value>`,
                        confirmLabel: "OK",
                      },
                      () => {},
                    );
                  }}
                >
                  {" [edit]"}
                </text>
                {!isDefault ? (
                  <text
                    fg={theme.warning()}
                    wrapMode="none"
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      void store.unsetSetting(entry.key);
                    }}
                  >
                    {" [unset]"}
                  </text>
                ) : null}
                <text fg={theme.dim()} wrapMode="none">
                  {isDefault ? " default" : " settings"}
                </text>
              </box>
            );
          })}
        </box>
        <box flexDirection="column" width={stacked ? "100%" : Math.max(26, Math.floor(inner / 3))}>
          <box border borderColor={theme.border()} flexDirection="column" overflow="hidden">
            <text fg={theme.dim()} wrapMode="none">
              {" Auth & connection"}
            </text>
            <text fg={page?.authMethod ? theme.success() : theme.error()} wrapMode="none">
              {` method: ${page?.authMethod ?? "none"}`}
            </text>
            <text fg={theme.normal()} wrapMode="none">{` login: ${page?.userLogin ?? "—"}`}</text>
            <text
              fg={theme.accent()}
              wrapMode="none"
              onMouseDown={(event) => {
                event.stopPropagation?.();
                void store.startDeviceFlow();
              }}
            >
              {" [login] device flow (non-blocking)"}
            </text>
            <text
              fg={theme.error()}
              wrapMode="none"
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
              {" [logout]"}
            </text>
          </box>
          <box border borderColor={theme.border()} flexDirection="column" overflow="hidden">
            <text fg={theme.dim()} wrapMode="none">
              {" Update"}
            </text>
            <text fg={theme.normal()} wrapMode="none">
              {snapshot.updateToast !== null
                ? ` ${snapshot.updateToast.version} available`
                : " up to date"}
            </text>
            <text
              fg={theme.accent()}
              wrapMode="none"
              onMouseDown={(event) => {
                event.stopPropagation?.();
                copyText("update", "npm i -g repotruck@latest");
                store.pushStatus(
                  "DONE",
                  "[update]",
                  "self-update command copied — the dashboard suspends during updates",
                );
              }}
            >
              {" [self-update] copy command"}
            </text>
          </box>
          <box
            border
            borderColor={theme.border()}
            flexDirection={stacked ? "row" : "column"}
            flexWrap="wrap"
            overflow="hidden"
          >
            <text fg={theme.dim()} wrapMode="none">
              {" Shell completions"}
            </text>
            {["bash", "zsh", "fish", "powershell"].map((shell) => (
              <text
                key={shell}
                fg={theme.normal()}
                wrapMode="none"
                onMouseDown={(event) => {
                  event.stopPropagation?.();
                  copyText(`completions ${shell}`, `repotruck completions ${shell}`);
                  store.pushStatus(
                    "DONE",
                    "[completions]",
                    `completions ${shell} script command copied`,
                  );
                }}
              >
                {` [${shell}]`}
              </text>
            ))}
          </box>
        </box>
      </box>
      <text fg={theme.dim()} wrapMode="none">
        {
          "edit dialog carries the config set parity · unset restores defaults · r refresh · Esc cockpit"
        }
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

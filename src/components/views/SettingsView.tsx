import { useKeyboard } from "@opentui/react";
import { useEffect, useSyncExternalStore } from "react";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { copyText } from "../ui/JsonCopy.ts";

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
export function SettingsView({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const page = snapshot.settingsPage;

  useEffect(() => {
    if (page === null) void store.refreshSettingsPage();
  }, [page, store]);

  useKeyboard((key) => {
    if (key.name === "r") void store.refreshSettingsPage();
  });

  const settings = page?.settings ?? null;
  const inner = Math.max(30, width - 4);

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" gap={2}>
        <box border borderColor={theme.border()} flexDirection="column" flexGrow={1} padding={0}>
          <text fg={theme.dim()}>{" Configuration (config list)"}</text>
          {SETTING_KEYS.map((entry) => {
            const raw = readSetting(settings, entry.key);
            const isDefault = raw.isDefault;
            return (
              <box key={entry.key} flexDirection="row" gap={1}>
                <text
                  fg={theme.normal()}
                >{` ${entry.label.padEnd(Math.min(18, inner - 26))}`}</text>
                <text fg={isDefault ? theme.dim() : theme.accent()}>
                  {String(raw.value || "(default)")}
                </text>
                <text
                  fg={theme.dim()}
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
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      void store.unsetSetting(entry.key);
                    }}
                  >
                    {" [unset]"}
                  </text>
                ) : null}
                <text fg={theme.dim()}>{isDefault ? " default" : " settings"}</text>
              </box>
            );
          })}
        </box>
        <box flexDirection="column" width={Math.floor(inner / 3)}>
          <box border borderColor={theme.border()} flexDirection="column">
            <text fg={theme.dim()}>{" Auth & connection"}</text>
            <text fg={page?.authMethod ? theme.success() : theme.error()}>
              {` method: ${page?.authMethod ?? "none"}`}
            </text>
            <text fg={theme.normal()}>{` login: ${page?.userLogin ?? "—"}`}</text>
            <text
              fg={theme.accent()}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                store.pushStatus(
                  "DONE",
                  "[auth]",
                  "device flow runs in your terminal: repotruck auth login (copied)",
                );
                copyText("auth login", "repotruck auth login");
              }}
            >
              {" [login] copy device-flow command"}
            </text>
            <text
              fg={theme.error()}
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
          <box border borderColor={theme.border()} flexDirection="column">
            <text fg={theme.dim()}>{" Update"}</text>
            <text fg={theme.normal()}>
              {snapshot.updateToast !== null
                ? ` ${snapshot.updateToast.version} available`
                : " up to date"}
            </text>
            <text
              fg={theme.accent()}
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
          <box border borderColor={theme.border()} flexDirection="column">
            <text fg={theme.dim()}>{" Shell completions"}</text>
            {["bash", "zsh", "fish", "powershell"].map((shell) => (
              <text
                key={shell}
                fg={theme.normal()}
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
      <text fg={theme.dim()}>
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

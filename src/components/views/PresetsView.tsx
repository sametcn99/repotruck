import { useKeyboard } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { PRESET_IDS } from "../../presets/index.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";

const TOKENS = ["owner", "category", "language", "name"] as const;

/**
 * `repotruck preset list/add/remove` as a page: built-in and custom preset
 * cards with mini tree previews, a token-order builder validated by the
 * same rules as the CLI, and remove for custom entries.
 */
export function PresetsView({ store, width }: { store: Store; width: number }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [idValue, setIdValue] = useState("");
  const [segments, setSegments] = useState<string[]>([]);
  const [inputMode, setInputMode] = useState<"id" | "none">("none");

  useKeyboard((key) => {
    if (inputMode === "id") {
      if (key.name === "escape") setInputMode("none");
      return;
    }
    if (key.name === "a") {
      setBuilderOpen(true);
      setInputMode("id");
    }
  });

  const custom = snapshot.customPresets;
  const cols = width < 56 ? 1 : width < 84 ? 2 : 3;
  const cardWidth = Math.max(18, Math.floor((width - cols * 2 - 2) / cols));
  const preview = (segmentsList: readonly string[]): string =>
    `${segmentsList.map((segment) => `${segment}/`).join("")}repo/`;

  return (
    <box flexDirection="column" flexGrow={1} width="100%">
      <box flexDirection="row" gap={1} flexWrap="wrap">
        {PRESET_IDS.map((preset) => (
          <box
            key={preset}
            border
            borderColor={preset === snapshot.preset ? theme.accent() : theme.border()}
            flexDirection="column"
            width={cardWidth}
            overflow="hidden"
          >
            <text fg={preset === snapshot.preset ? theme.accent() : theme.normal()} wrapMode="none">
              {` ${preset}${preset === snapshot.preset ? " (current)" : ""}`}
            </text>
            <text fg={theme.dim()} wrapMode="none">
              {"  built-in"}
            </text>
            <text
              fg={theme.dim()}
              wrapMode="none"
              onMouseDown={(event) => {
                event.stopPropagation?.();
                store.confirmDialog(
                  {
                    title: `Reorganize to ${preset}?`,
                    message: "Opens the reorganize preview (R) with this preset preselected.",
                    confirmLabel: "Open",
                  },
                  () => {
                    store.setView("cockpit");
                    void store.openReorganizeModal();
                  },
                );
              }}
            >
              {"  [apply · reorganize]"}
            </text>
          </box>
        ))}
        {custom.map((preset) => (
          <box
            key={preset.id}
            border
            borderColor={theme.muted()}
            flexDirection="column"
            width={cardWidth}
            overflow="hidden"
          >
            <text fg={theme.muted()} wrapMode="none">{` ${preset.id}`}</text>
            <text fg={theme.dim()} wrapMode="none">{`  ${preview(preset.segments)}`}</text>
            <box flexDirection="row" gap={2}>
              <text
                fg={theme.dim()}
                wrapMode="none"
                onMouseDown={(event) => {
                  event.stopPropagation?.();
                  store.confirmDialog(
                    {
                      title: `Reorganize to ${preset.id}?`,
                      message: "Opens the reorganize preview with this preset preselected.",
                      confirmLabel: "Open",
                    },
                    () => {
                      store.setView("cockpit");
                      void store.openReorganizeModal();
                    },
                  );
                }}
              >
                {"  [apply]"}
              </text>
              <text
                fg={theme.error()}
                wrapMode="none"
                onMouseDown={(event) => {
                  event.stopPropagation?.();
                  store.confirmDialog(
                    {
                      title: `Remove preset ${preset.id}?`,
                      message: `repotruck preset remove ${preset.id}`,
                      confirmLabel: "Remove",
                      danger: true,
                    },
                    () => {
                      void store.removeCustomPreset(preset.id);
                    },
                  );
                }}
              >
                {"[remove]"}
              </text>
            </box>
          </box>
        ))}
      </box>
      {builderOpen ? (
        <box border borderColor={theme.accent()} flexDirection="column" padding={0}>
          <text fg={theme.accent()} wrapMode="none">
            {" Add custom preset (preset add)"}
          </text>
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            <text fg={theme.dim()}>id:</text>
            {inputMode === "id" ? (
              <input
                focused
                value={idValue}
                onInput={setIdValue}
                onSubmit={() => setInputMode("none")}
                width={Math.min(20, Math.max(10, width - 16))}
              />
            ) : (
              <text
                fg={theme.accent()}
                onMouseDown={(event) => {
                  event.stopPropagation?.();
                  setInputMode("id");
                }}
              >
                {idValue || "(click / a to edit)"}
              </text>
            )}
            {TOKENS.map((token) => (
              <text
                key={token}
                fg={segments.includes(token) ? theme.accent() : theme.normal()}
                onMouseDown={(event) => {
                  event.stopPropagation?.();
                  setSegments((current) => {
                    const without = current.filter((entry) => entry !== token && entry !== "name");
                    if (current.includes(token)) return without;
                    return token === "name" ? [...without, "name"] : [...without, token];
                  });
                }}
              >
                {`[${token}]`}
              </text>
            ))}
            <text fg={theme.dim()} wrapMode="none">
              {` ${segments.length > 0 ? preview(segments) : "(click tokens in order; name last)"}`}
            </text>
            <text
              fg={theme.accent()}
              onMouseDown={(event) => {
                event.stopPropagation?.();
                if (idValue.length === 0 || segments.length === 0) return;
                void store.addCustomPreset(idValue, segments);
                setSegments([]);
                setIdValue("");
                setBuilderOpen(false);
              }}
            >
              {"[add]"}
            </text>
          </box>
        </box>
      ) : (
        <text
          fg={theme.accent()}
          wrapMode="none"
          onMouseDown={(event) => {
            event.stopPropagation?.();
            setBuilderOpen(true);
            setInputMode("id");
          }}
        >
          {"[a] add custom preset"}
        </text>
      )}
      <text fg={theme.dim()} wrapMode="none">
        {
          "tokens: owner/category/language/name · 1–4 distinct · name last · apply opens reorganize preview"
        }
      </text>
    </box>
  );
}

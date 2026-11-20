import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { PRESET_IDS } from "../../presets/index.ts";
import type { Store } from "../store.ts";
import { theme } from "../theme.ts";
import { clampBoxLine, scrollSlice } from "../windowing.ts";

const TOKENS = ["owner", "category", "language", "name"] as const;

type PresetCardEntry =
  | { kind: "builtin"; id: string; current: boolean }
  | { kind: "custom"; id: string; segments: readonly string[] };

/**
 * `repotruck preset list/add/remove` as a page: built-in and custom preset
 * cards with mini tree previews, a token-order builder validated by the
 * same rules as the CLI, and remove for custom entries.
 */
export function PresetsView({
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
  const [builderOpen, setBuilderOpen] = useState(false);
  const [idValue, setIdValue] = useState("");
  const [segments, setSegments] = useState<string[]>([]);
  const [inputMode, setInputMode] = useState<"id" | "none">("none");
  const [rowOffset, setRowOffset] = useState(0);

  const custom = snapshot.customPresets;
  const cols = width < 56 ? 1 : width < 84 ? 2 : 3;
  const preview = (segmentsList: readonly string[]): string =>
    `${segmentsList.map((segment) => `${segment}/`).join("")}repo/`;

  const allCards: PresetCardEntry[] = [
    ...PRESET_IDS.map(
      (preset): PresetCardEntry => ({
        kind: "builtin",
        id: preset,
        current: preset === snapshot.preset,
      }),
    ),
    ...custom.map(
      (preset): PresetCardEntry => ({
        kind: "custom",
        id: preset.id,
        segments: preset.segments,
      }),
    ),
  ];

  const cardRows: PresetCardEntry[][] = [];
  for (let i = 0; i < allCards.length; i += cols) {
    cardRows.push(allCards.slice(i, i + cols));
  }

  // Reserve rows for builder / [a] prompt + footer line.
  const bottomChrome = builderOpen ? 4 : 2;
  const availCardAreaRows = Math.max(4, height - bottomChrome);
  // Standard 3-line cards take 5 rows (2 border + 3 inner). Compact 2-line cards take 4 rows (2 border + 2 inner).
  const compactCards = cardRows.length * 5 > availCardAreaRows;
  const cardRowHeight = compactCards ? 4 : 5;
  const maxVisibleCardRows = Math.max(1, Math.floor(availCardAreaRows / cardRowHeight));
  const rowWin = scrollSlice(rowOffset, cardRows.length, maxVisibleCardRows);
  const visibleCardRows = cardRows.slice(rowWin.start, rowWin.end);
  const cardInnerCols = Math.max(12, Math.floor((width - (cols - 1)) / cols) - 3);

  useKeyboard((key) => {
    if (inputMode === "id") {
      if (key.name === "escape") setInputMode("none");
      return;
    }
    if (key.name === "a") {
      setBuilderOpen(true);
      setInputMode("id");
    } else if (key.name === "up" || key.sequence === "k") {
      setRowOffset((r) => Math.max(0, r - 1));
    } else if (key.name === "down" || key.sequence === "j") {
      setRowOffset((r) => Math.min(Math.max(0, cardRows.length - 1), r + 1));
    }
  });

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      onMouseScroll={(e) => {
        const isUp = e.scroll?.direction === "up" || e.button === 4;
        setRowOffset((r) =>
          Math.min(Math.max(0, cardRows.length - 1), Math.max(0, r + (isUp ? -1 : 1))),
        );
      }}
    >
      <box flexDirection="column" flexShrink={0} width="100%">
        {visibleCardRows.map((row) => (
          <box
            key={`row-${row[0]?.id ?? "empty"}`}
            flexDirection="row"
            gap={1}
            flexShrink={0}
            width="100%"
          >
            {row.map((card) =>
              card.kind === "builtin" ? (
                <box
                  key={card.id}
                  border
                  borderColor={card.current ? theme.accent() : theme.border()}
                  flexDirection="column"
                  flexGrow={1}
                  flexBasis={0}
                  flexShrink={0}
                  overflow="hidden"
                >
                  <text
                    fg={card.current ? theme.accent() : theme.normal()}
                    wrapMode="none"
                    flexShrink={0}
                  >
                    {clampBoxLine(
                      compactCards
                        ? ` ${card.id}${card.current ? " (current)" : ""} · built-in`
                        : ` ${card.id}${card.current ? " (current)" : ""}`,
                      cardInnerCols,
                    )}
                  </text>
                  {!compactCards ? (
                    <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
                      {"  built-in"}
                    </text>
                  ) : null}
                  <text
                    fg={theme.dim()}
                    wrapMode="none"
                    flexShrink={0}
                    onMouseDown={(event) => {
                      event.stopPropagation?.();
                      store.confirmDialog(
                        {
                          title: `Reorganize to ${card.id}?`,
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
                    {clampBoxLine("  [apply · reorganize]", cardInnerCols)}
                  </text>
                </box>
              ) : (
                <box
                  key={card.id}
                  border
                  borderColor={theme.muted()}
                  flexDirection="column"
                  flexGrow={1}
                  flexBasis={0}
                  flexShrink={0}
                  overflow="hidden"
                >
                  <text fg={theme.muted()} wrapMode="none" flexShrink={0}>
                    {clampBoxLine(
                      compactCards ? ` ${card.id} · ${preview(card.segments)}` : ` ${card.id}`,
                      cardInnerCols,
                    )}
                  </text>
                  {!compactCards ? (
                    <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
                      {clampBoxLine(`  ${preview(card.segments)}`, cardInnerCols)}
                    </text>
                  ) : null}
                  <box flexDirection="row" gap={2} flexShrink={0}>
                    <text
                      fg={theme.dim()}
                      wrapMode="none"
                      flexShrink={0}
                      onMouseDown={(event) => {
                        event.stopPropagation?.();
                        store.confirmDialog(
                          {
                            title: `Reorganize to ${card.id}?`,
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
                      flexShrink={0}
                      onMouseDown={(event) => {
                        event.stopPropagation?.();
                        store.confirmDialog(
                          {
                            title: `Remove preset ${card.id}?`,
                            message: `repotruck preset remove ${card.id}`,
                            confirmLabel: "Remove",
                            danger: true,
                          },
                          () => {
                            void store.removeCustomPreset(card.id);
                          },
                        );
                      }}
                    >
                      {"[remove]"}
                    </text>
                  </box>
                </box>
              ),
            )}
          </box>
        ))}
      </box>
      {builderOpen ? (
        <box border borderColor={theme.accent()} flexDirection="column" padding={0} flexShrink={0}>
          <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
            {" Add custom preset (preset add)"}
          </text>
          <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
            <text fg={theme.dim()} flexShrink={0}>
              id:
            </text>
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
                flexShrink={0}
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
                flexShrink={0}
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
            <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
              {` ${segments.length > 0 ? preview(segments) : "(click tokens in order; name last)"}`}
            </text>
            <text
              fg={theme.accent()}
              flexShrink={0}
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
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            setBuilderOpen(true);
            setInputMode("id");
          }}
        >
          {cardRows.length > maxVisibleCardRows
            ? `[a] add custom preset · (rows ${rowWin.start + 1}-${rowWin.end}/${cardRows.length} · ↑↓ scroll)`
            : "[a] add custom preset"}
        </text>
      )}
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(
          "tokens: owner/category/language/name · 1–4 distinct · name last · apply opens reorganize preview",
          width,
        )}
      </text>
    </box>
  );
}

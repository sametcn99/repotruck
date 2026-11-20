import { theme } from "../theme.ts";

export function PaneTabs<T extends string>({
  panes,
  selected,
  onSelect,
}: {
  panes: readonly (readonly [T, string])[];
  selected: T;
  onSelect: (pane: T) => void;
}) {
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {"[Tab]"}
      </text>
      {panes.map(([pane, label]) => (
        <text
          key={pane}
          fg={selected === pane ? theme.cursorFg() : theme.normal()}
          bg={selected === pane ? theme.cursorBg() : undefined}
          wrapMode="none"
          flexShrink={0}
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.button === 0) onSelect(pane);
          }}
        >
          {` ${label} `}
        </text>
      ))}
    </box>
  );
}

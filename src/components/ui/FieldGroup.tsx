import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import type { FlagSpec } from "../../commands/registry.ts";
import { theme } from "../theme.ts";
import { visibleSlice } from "../windowing.ts";

/**
 * Values map for a FlagSpec set: bools as booleans, everything else as
 * strings (lists keep their serialized comma form until ListEditor edits).
 */
export type FieldValues = Record<string, boolean | string>;

export function defaultFieldValues(flags: readonly FlagSpec[]): FieldValues {
  const values: FieldValues = {};
  for (const flag of flags) {
    values[flag.flag] = flag.type === "bool" ? flag.default === "true" : (flag.default ?? "");
  }
  return values;
}

/**
 * Flag-form control rendered from registry FlagSpecs. Owns field focus and
 * editing (like modals own their keys): Space toggles bools, ←/→ cycle
 * enums and ints, Enter edits strings/lists inline, ↑/↓ move between
 * fields. The parent reads `values` and renders the live CLI line.
 */
export function FieldGroup({
  flags,
  values,
  onChange,
  width,
  maxRows,
  showFlags = true,
}: {
  flags: readonly FlagSpec[];
  values: FieldValues;
  onChange: (flag: string, value: boolean | string) => void;
  width: number;
  maxRows?: number;
  showFlags?: boolean;
}) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inner = Math.max(20, width - 4);
  const boundedFocus = Math.min(Math.max(0, focusIndex), Math.max(0, flags.length - 1));
  const viewport = maxRows !== undefined ? Math.max(1, maxRows) : flags.length;
  const win = visibleSlice(boundedFocus, flags.length, viewport);
  const visibleFlags = flags.slice(win.start, win.end);

  const current = flags[boundedFocus];

  const beginEdit = (flag: FlagSpec): void => {
    if (flag.type === "string" || flag.type === "path" || flag.type === "url") {
      setEditing(flag.flag);
      setEditValue(String(values[flag.flag] ?? ""));
    } else if (flag.type === "list") {
      const raw = String(values[flag.flag] ?? "");
      setEditing(flag.flag);
      setEditValue(raw);
    }
  };

  const commitEdit = (): void => {
    if (editing !== null) {
      onChange(editing, editValue);
    }
    setEditing(null);
  };

  const cycleEnum = (flag: FlagSpec, direction: 1 | -1): void => {
    const choices = flag.values ?? [];
    if (choices.length === 0) return;
    const currentIdx = choices.indexOf(String(values[flag.flag] ?? ""));
    const next = (currentIdx + direction + choices.length) % choices.length;
    onChange(flag.flag, choices[next]!);
  };

  const stepInt = (flag: FlagSpec, direction: 1 | -1): void => {
    const raw = String(values[flag.flag] ?? "");
    if (flag.type === "optional-int") {
      if (raw === "") onChange(flag.flag, "1");
      else {
        const n = Number.parseInt(raw, 10);
        if (Number.isNaN(n)) onChange(flag.flag, "1");
        else if (n + direction < 1) onChange(flag.flag, "");
        else onChange(flag.flag, String(n + direction));
      }
      return;
    }
    const n = Number.parseInt(raw, 10);
    const next = Number.isNaN(n) ? 1 : Math.max(1, n + direction);
    onChange(flag.flag, String(next));
  };

  useKeyboard((key) => {
    if (current === undefined) return;
    if (editing !== null) {
      // The focused <input> owns typing; only intercept Escape/Enter here
      // when the input is not focused (input onSubmit handles Enter).
      if (key.name === "escape") {
        setEditing(null);
      }
      return;
    }
    if (key.name === "up") {
      setFocusIndex((i) => (i > 0 ? i - 1 : flags.length - 1));
    } else if (key.name === "down") {
      setFocusIndex((i) => (i < flags.length - 1 ? i + 1 : 0));
    } else if (key.name === "space") {
      if (current.type === "bool") onChange(current.flag, !(values[current.flag] ?? false));
      else beginEdit(current);
    } else if (key.name === "return") {
      beginEdit(current);
    } else if (key.name === "left") {
      if (current.type === "enum") cycleEnum(current, -1);
      else if (current.type === "int" || current.type === "optional-int") stepInt(current, -1);
      else if (current.type === "bool") onChange(current.flag, false);
    } else if (key.name === "right") {
      if (current.type === "enum") cycleEnum(current, 1);
      else if (current.type === "int" || current.type === "optional-int") stepInt(current, 1);
      else if (current.type === "bool") onChange(current.flag, true);
    }
  });

  return (
    <box flexDirection="column" width="100%" flexShrink={0}>
      {visibleFlags.map((flag, idx) => {
        const index = win.start + idx;
        const focused = index === boundedFocus;
        const value: boolean | string = values[flag.flag] ?? "";
        const label = showFlags ? flagLabel(flag) : flag.summary;
        return (
          <box key={flag.flag} flexDirection="column" flexShrink={0}>
            <text
              fg={focused ? theme.accent() : theme.normal()}
              wrapMode="none"
              flexShrink={0}
              onMouseDown={(e) => {
                e.stopPropagation();
                setFocusIndex(index);
                if (flag.type === "bool") {
                  onChange(flag.flag, !(values[flag.flag] ?? false));
                } else if (flag.type === "enum") {
                  cycleEnum(flag, 1);
                } else {
                  beginEdit(flag);
                }
              }}
            >
              {formatFieldLine(label, flag, value, focused, inner)}
            </text>
            {editing === flag.flag ? (
              <input
                focused
                value={editValue}
                onInput={setEditValue}
                onSubmit={() => commitEdit()}
                width="100%"
              />
            ) : null}
          </box>
        );
      })}
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {flags.length > viewport
          ? `↑↓ field (${win.start + 1}-${win.end}/${flags.length}) · Space toggle/edit · ←→ cycle`
          : "↑↓ field · Space toggle/edit · ←→ cycle · Enter edit · Esc close input"}
      </text>
    </box>
  );
}

function flagLabel(flag: FlagSpec): string {
  if (flag.short !== undefined) return `${flag.short}, ${flag.flag}`;
  return flag.flag;
}

export function formatFieldLine(
  label: string,
  flag: FlagSpec,
  value: boolean | string,
  focused: boolean,
  inner: number,
): string {
  const marker = focused ? "> " : "  ";
  let rendered: string;
  if (flag.type === "bool") rendered = value === true ? "[x]" : "[ ]";
  else if (flag.type === "enum") rendered = `${(value || flag.values?.[0]) ?? ""} (< >)`;
  else if (flag.type === "int") rendered = `[${value === "" ? "1" : value}] (− +)`;
  else if (flag.type === "optional-int") rendered = value === "" ? "off (+)" : `[${value}] (− +)`;
  else if (flag.type === "list") rendered = value === "" ? "— (enter to edit)" : `${value} (edit)`;
  else rendered = value === "" ? "—" : String(value);
  const line = `${marker}${label}  ${rendered}`;
  return line.length <= inner ? line : `${line.slice(0, Math.max(1, inner - 1))}…`;
}

/**
 * Serialize FieldValues into CLI arguments for the live command line.
 * Defaults and empty values are skipped; bools render only when true.
 */
export function buildCliArguments(
  commandPath: string,
  flags: readonly FlagSpec[],
  values: FieldValues,
  positional: readonly string[] = [],
): string {
  const parts = [commandPath];
  for (const arg of positional) parts.push(arg);
  for (const flag of flags) {
    const value = values[flag.flag];
    if (flag.type === "bool") {
      if (value === true && flag.default !== "true") parts.push(flag.flag);
      continue;
    }
    const text = String(value ?? "");
    if (text === "" || text === flag.default) continue;
    if (flag.type === "list") {
      for (const item of text
        .split(",")
        .map((piece) => piece.trim())
        .filter(Boolean)) {
        parts.push(`${flag.flag} ${item.includes(" ") ? `'${item}'` : item}`);
      }
      continue;
    }
    parts.push(`${flag.flag} ${text.includes(" ") ? `'${text}'` : text}`);
  }
  return parts.join(" ");
}

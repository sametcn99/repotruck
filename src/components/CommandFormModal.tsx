import { InputRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { type CommandSpec, REGISTRY_BY_ID } from "../commands/registry.ts";
import { ModalShell } from "./ModalShell.tsx";
import { executeRegistryCommand } from "./store/modalWorkflows.ts";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";
import {
  buildCliArguments,
  defaultFieldValues,
  FieldGroup,
  type FieldValues,
} from "./ui/FieldGroup.tsx";
import { copyText } from "./ui/JsonCopy.ts";
import { clampBoxLine } from "./windowing.ts";

export function CommandFormModal({ store }: { store: Store }) {
  const modal = useSyncExternalStore(store.subscribe, store.getSnapshot).modal;
  const spec = modal?.type === "commandForm" ? REGISTRY_BY_ID.get(modal.specId) : undefined;
  return spec === undefined ? null : <CommandForm key={spec.id} store={store} spec={spec} />;
}

function CommandForm({ store, spec }: { store: Store; spec: CommandSpec }) {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();
  const [actionIndex, setActionIndex] = useState<number | null>(null);
  const [, refresh] = useState(0);
  const { values, positional } = stateFor(store, spec);
  const args = spec.args.map((arg) => ({
    flag: arg.required ? `${arg.name}*` : arg.name,
    type: "string" as const,
    summary: arg.summary,
    tui: arg.summary,
  }));
  const fields = [...args, ...spec.flags];
  const fieldValues = { ...values };
  args.forEach((arg, index) => {
    fieldValues[arg.flag] = positional[index] ?? "";
  });
  const cli = buildCliArguments(
    `repotruck ${spec.path}`,
    spec.flags,
    values,
    positional.filter(Boolean),
  );
  const formWidth = Math.max(16, width - 6);
  // Reserve space for the title, hint, summary, CLI preview, actions and one inline editor.
  const maxFlagRows = Math.max(1, height - (height < 22 || width < 64 ? 19 : 21));
  const [copied, setCopied] = useState<string | null>(null);
  const actions: { label: string; run: () => void }[] = [];
  if (spec.id === "scan" || spec.id === "backup") {
    actions.push({
      label: spec.id === "scan" ? "Run" : "Snapshot",
      run: () => {
        store.closeModal();
        void store.runWorkspaceMaintenance(spec.id === "scan" ? "scan" : "backup");
      },
    });
  }
  actions.push({
    label: "Copy CLI",
    run: () => {
      const result = copyText("command", cli);
      store.setModalError(result.ok ? null : result.message);
      if (result.ok) setCopied(result.message);
    },
  });
  if (spec.surface.kind === "view" || spec.surface.kind === "modal") {
    actions.push({
      label: spec.surface.kind === "view" ? "Open page" : "Open",
      run: () => executeRegistryCommand(store, spec.id, false),
    });
  }
  actions.push({ label: "Close", run: store.closeModal });

  const focus = actionIndex ?? (fields.length === 0 ? 0 : null);
  useKeyboard((key) => {
    if (store.getSnapshot().modal?.type !== "commandForm") return;
    if (renderer.currentFocusedRenderable instanceof InputRenderable) return;
    if (key.name === "tab") {
      key.stopPropagation();
      const zones = fields.length === 0 ? actions.length : actions.length + 1;
      const next = ((focus ?? actions.length) + (key.shift ? -1 : 1) + zones) % zones;
      setActionIndex(next === actions.length ? null : next);
    } else if (focus !== null && (key.name === "left" || key.name === "right")) {
      setActionIndex((focus + (key.name === "left" ? -1 : 1) + actions.length) % actions.length);
    } else if (focus !== null && (key.name === "return" || key.name === "space")) {
      key.stopPropagation();
      actions[focus]?.run();
    }
  });

  return (
    <ModalShell
      store={store}
      title={`${spec.path} — ${spec.title}`}
      hint="Tab focus · ↑↓ fields · Enter choose · Esc back"
      gap={0}
      status={copied === null ? null : clampBoxLine(copied, formWidth)}
    >
      <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(spec.summary, formWidth)}
      </text>
      {fields.length > 0 ? (
        <FieldGroup
          flags={fields}
          values={fieldValues}
          active={focus === null}
          onFocus={() => setActionIndex(null)}
          onChange={(field, value) => {
            const arg = args.findIndex((entry) => entry.flag === field);
            if (arg < 0) values[field] = value;
            else positional[arg] = String(value);
            setCopied(null);
            store.setModalError(null);
            refresh((revision) => revision + 1);
          }}
          width={formWidth}
          maxRows={maxFlagRows}
        />
      ) : null}
      <text fg={theme.accent()} wrapMode="none" flexShrink={0}>
        {clampBoxLine(` $ ${cli}`, formWidth)}
      </text>
      <box flexDirection="row" flexWrap="wrap" gap={1} flexShrink={0}>
        {actions.map(({ label, run }, index) => (
          <text
            key={label}
            fg={focus === index ? theme.cursorFg() : theme.normal()}
            bg={focus === index ? theme.cursorBg() : undefined}
            wrapMode="none"
            flexShrink={0}
            onMouseDown={(event) => {
              event.stopPropagation();
              if (event.button === 0) run();
            }}
          >
            {`[${label}]${focus === index ? " Enter" : ""}`}
          </text>
        ))}
      </box>
      {height >= 24 ? (
        <text fg={theme.dim()} wrapMode="none" flexShrink={0}>
          {`requires: ${spec.requires.join(", ") || "nothing"}`}
        </text>
      ) : null}
    </ModalShell>
  );
}

// ---- per-spec form state, kept on the store so live edits survive renders

const formState = new WeakMap<Store, Map<string, { values: FieldValues; positional: string[] }>>();

function stateFor(store: Store, spec: CommandSpec): { values: FieldValues; positional: string[] } {
  let byStore = formState.get(store);
  if (byStore === undefined) {
    byStore = new Map();
    formState.set(store, byStore);
  }
  let entry = byStore.get(spec.id);
  if (entry === undefined) {
    entry = {
      values: defaultFieldValues(spec.flags),
      positional: spec.args.map(() => ""),
    };
    byStore.set(spec.id, entry);
  }
  return entry;
}

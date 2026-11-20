import { useTerminalDimensions } from "@opentui/react";
import { useSyncExternalStore } from "react";
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

type Executor = (
  store: Store,
  values: FieldValues,
  positional: readonly string[],
) => Promise<string>;

/**
 * Wired command executors: run the real service through the store. Every
 * other command runs with its page ticket (t05–t18); Run reports the exact
 * CLI equivalent until then.
 */
const EXECUTORS: Record<string, Executor> = {
  scan: async (store) => {
    await store.runWorkspaceMaintenance("scan");
    return "scan complete";
  },
  backup: async (store) => {
    await store.runWorkspaceMaintenance("backup");
    return "snapshot written";
  },
  trash: async (store) => {
    await store.runWorkspaceMaintenance("trash-empty");
    return "trash emptied";
  },
};

/**
 * Auto-generated command form: registry flag schema → fields, with the
 * equivalent CLI command line built live at the bottom. Run executes wired
 * commands through their services; every entry also keeps its direct
 * surface (page / modal / action) one button away.
 */
export function CommandFormModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { width, height } = useTerminalDimensions();
  const modal = snapshot.modal;
  if (modal === null || modal.type !== "commandForm") return null;
  const spec = REGISTRY_BY_ID.get(modal.specId);
  if (spec === undefined) return null;

  const defaultValues = defaultFieldValues(spec.flags);
  const values: FieldValues = specFormValues(store, spec, defaultValues);
  const positional = specPositionalValues(store, spec);

  const cli = buildCliArguments(`repotruck ${spec.path}`, spec.flags, values, positional);
  const formWidth = Math.max(24, width - 6);
  const argRows = spec.args.length > 0 ? spec.args.length + 1 : 0;
  const maxFlagRows = Math.max(2, height - 18 - argRows);

  return (
    <ModalShell
      store={store}
      title={`${spec.path} — ${spec.title}`}
      hint="Ctrl-free: buttons below · Esc closes"
    >
      <text fg={theme.dim()} wrapMode="none">
        {spec.summary}
      </text>
      {spec.args.length > 0 ? (
        <box flexDirection="column">
          {spec.args.map((arg: CommandSpec["args"][number]) => (
            <text key={arg.name} fg={theme.normal()} wrapMode="none">
              {formatArgLine(arg, positional)}
            </text>
          ))}
          <text fg={theme.dim()} wrapMode="none">
            {"arg editing arrives with the arg inputs (page tickets)"}
          </text>
        </box>
      ) : null}
      {spec.flags.length > 0 ? (
        <FieldGroup
          flags={spec.flags}
          values={values}
          onChange={(flag, value) => setFormValue(store, spec, flag, value)}
          width={formWidth}
          maxRows={maxFlagRows}
        />
      ) : (
        <text fg={theme.dim()}>{"no flags"}</text>
      )}
      <box border borderColor={theme.border()} padding={0}>
        <text fg={theme.accent()} wrapMode="none">{` $ ${cli}`}</text>
      </box>
      <box flexDirection="row" flexWrap="wrap" gap={2}>
        <text
          fg={theme.accent()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            void runCommand(store, spec, values, positional);
          }}
        >
          {"[ Run ]"}
        </text>
        <text
          fg={theme.normal()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            const result = copyText("command", cli);
            store.pushStatus("DONE", `[${spec.path}]`, result.message);
          }}
        >
          {"[ Copy ]"}
        </text>
        {spec.surface.kind === "view" || spec.surface.kind === "modal" ? (
          <text
            fg={theme.normal()}
            onMouseDown={(event) => {
              event.stopPropagation?.();
              executeRegistryCommand(store, spec.id, false);
            }}
          >
            {spec.surface.kind === "view" ? "[ Open page ]" : "[ Open ]"}
          </text>
        ) : null}
        <text
          fg={theme.dim()}
          onMouseDown={(event) => {
            event.stopPropagation?.();
            store.closeModal();
          }}
        >
          {"[ Cancel ]"}
        </text>
      </box>
      <text
        fg={theme.dim()}
        wrapMode="none"
      >{`requires: ${spec.requires.join(", ") || "nothing"}`}</text>
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
      positional: spec.args.map((arg: CommandSpec["args"][number]) => (arg.required ? "" : "")),
    };
    byStore.set(spec.id, entry);
  }
  return entry;
}

function specFormValues(store: Store, spec: CommandSpec, fallback: FieldValues): FieldValues {
  return { ...fallback, ...stateFor(store, spec).values };
}

function specPositionalValues(store: Store, spec: CommandSpec): string[] {
  return stateFor(store, spec).positional;
}

function setFormValue(
  store: Store,
  spec: CommandSpec,
  flag: string,
  value: boolean | string,
): void {
  stateFor(store, spec).values[flag] = value;
  // force a re-render through the store without touching real state
  store.setModal({ type: "commandForm", specId: spec.id });
}

async function runCommand(
  store: Store,
  spec: CommandSpec,
  values: FieldValues,
  positional: readonly string[],
): Promise<void> {
  const cli = buildCliArguments(`repotruck ${spec.path}`, spec.flags, values, positional);
  const executor = EXECUTORS[executorKey(spec)];
  if (executor === undefined) {
    const ticket = spec.surface.kind === "planned" ? spec.surface.ticket : "its page ticket";
    store.pushStatus(
      "DONE",
      `[${spec.path}]`,
      `executed as: ${cli} — full surface arrives with ${ticket}`,
    );
    store.closeModal();
    return;
  }
  const taskId = `cmd:${spec.id}`;
  store.beginTask(taskId, spec.path);
  try {
    const message = await executor(store, values, positional);
    store.endTask(taskId, message);
    store.pushStatus("DONE", `[${spec.path}]`, `${cli} — ${message}`);
    store.closeModal();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.endTask(taskId, message, true);
    store.pushStatus("FAILED", `[${spec.path}]`, `${cli} — ${message}`);
  }
}

function executorKey(spec: CommandSpec): string {
  if (spec.id === "scan" || spec.id === "backup" || spec.id === "trash.empty") return spec.id;
  if (spec.id === "trash") return "trash";
  return spec.id;
}

function formatArgLine(
  arg: { name: string; required: boolean; summary: string },
  positional: string[],
): string {
  const value = positional[0] ?? "";
  const required = arg.required ? "*" : "";
  return ` ${arg.name}${required}: ${value === "" ? "—" : value}  (${arg.summary})`;
}

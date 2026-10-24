import { useKeyboard } from "@opentui/react";
import { useSyncExternalStore } from "react";
import type { ModalState, Store } from "./store.ts";
import { theme } from "./theme.ts";

const DIM_FG = theme.dim();
const WARNING_FG = theme.error();

type ConfirmModalState = Extract<ModalState, { type: "confirmDelete" | "confirmUntrack" }>;

function asConfirmModal(modal: ModalState | null): ConfirmModalState | null {
  if (modal === null) return null;
  if (modal.type === "confirmDelete" || modal.type === "confirmUntrack") return modal;
  return null;
}

interface ConfirmConfig {
  title: string;
  message: string;
  detail: string;
  hint: string;
  confirm: () => void;
}

function confirmConfig(modal: ConfirmModalState, store: Store): ConfirmConfig {
  if (modal.type === "confirmDelete") {
    return {
      title: "Delete repository",
      message: `moves ${modal.absPath} to .repotruck/trash (z undoes) — y/N`,
      detail: `This untracks ${modal.key} and parks its directory in the workspace trash (press z afterwards to undo). Only y confirms; anything else cancels.`,
      hint: "y delete · N/Escape cancel",
      confirm: () => void store.confirmDelete(modal.key),
    };
  }
  return {
    title: "Untrack repository",
    message: `stop tracking ${modal.key} — the clone stays on disk — y/N`,
    detail: `This only removes ${modal.key} from the repotruck workspace config; nothing on disk is touched. Only y confirms; anything else cancels.`,
    hint: "y untrack · N/Escape cancel",
    confirm: () => void store.confirmUntrack(modal.key),
  };
}

export function ConfirmModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const modal = asConfirmModal(snapshot.modal);

  useKeyboard((keyEvent) => {
    if (modal === null) return;
    if (keyEvent.sequence === "y") {
      confirmConfig(modal, store).confirm();
    } else if (
      keyEvent.name === "escape" ||
      keyEvent.sequence === "n" ||
      keyEvent.name === "return"
    ) {
      store.closeModal();
    }
  });

  if (modal === null) return null;
  const config = confirmConfig(modal, store);

  return (
    <box
      title={config.title}
      border
      borderColor={theme.error()}
      flexDirection="column"
      flexGrow={1}
      padding={1}
      gap={1}
      onMouseDown={(e) => {
        if (e.button === 2) {
          e.stopPropagation();
          store.closeModal();
        }
      }}
    >
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <text fg={WARNING_FG}>{config.title}</text>
        <text
          fg={DIM_FG}
          onMouseDown={(e) => {
            e.stopPropagation();
            store.closeModal();
          }}
        >
          {"[× Close]"}
        </text>
      </box>
      <text fg={WARNING_FG}>{config.message}</text>
      <text fg={DIM_FG}>{config.detail}</text>
      <box flexDirection="row" gap={2}>
        <text
          fg={theme.cursorFg()}
          bg={theme.cursorBg()}
          onMouseDown={(e) => {
            e.stopPropagation();
            config.confirm();
          }}
        >
          {" [ Confirm ] "}
        </text>
        <text
          fg={DIM_FG}
          onMouseDown={(e) => {
            e.stopPropagation();
            store.closeModal();
          }}
        >
          {" [ Cancel ] "}
        </text>
      </box>
      <text
        fg={DIM_FG}
        onMouseDown={(e) => {
          e.stopPropagation();
          store.closeModal();
        }}
      >
        {config.hint}
      </text>
    </box>
  );
}

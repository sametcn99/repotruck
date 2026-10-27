import { useKeyboard } from "@opentui/react";
import { useSyncExternalStore } from "react";
import type { ModalState, Store } from "./store.ts";
import { theme } from "./theme.ts";

type ConfirmModalState = Extract<
  ModalState,
  { type: "confirmDelete" | "confirmUntrack" | "confirmArchive" }
>;

function asConfirmModal(modal: ModalState | null): ConfirmModalState | null {
  if (modal === null) return null;
  if (
    modal.type === "confirmDelete" ||
    modal.type === "confirmUntrack" ||
    modal.type === "confirmArchive"
  ) {
    return modal;
  }
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
  const count = modal.keys !== undefined && modal.keys.length > 1 ? modal.keys.length : 1;
  if (modal.type === "confirmDelete") {
    return {
      title: count > 1 ? `Delete ${count} repositories` : "Delete repository",
      message:
        count > 1
          ? `moves ${count} repositories (starting with ${modal.key}) to .repotruck/trash (z undoes) — y/N`
          : `moves ${modal.absPath} to .repotruck/trash (z undoes) — y/N`,
      detail:
        count > 1
          ? `This untracks ${count} repositories and parks their directories in the workspace trash (press z afterwards to undo). Only y confirms; anything else cancels.`
          : `This untracks ${modal.key} and parks its directory in the workspace trash (press z afterwards to undo). Only y confirms; anything else cancels.`,
      hint: "y delete · N/Escape cancel",
      confirm: () => void store.confirmDelete(modal.key, modal.keys),
    };
  }
  if (modal.type === "confirmArchive") {
    return {
      title: count > 1 ? `Archive ${count} repositories` : "Archive repository",
      message:
        count > 1
          ? `archives ${count} repositories on GitHub and moves local clones to archived/ — y/N`
          : `archives ${modal.key} on GitHub and moves its local clone to archived/ — y/N`,
      detail:
        "Archiving marks the repository read-only on GitHub and relocates the local directory into the archived bucket. Only y confirms; anything else cancels.",
      hint: "y archive · N/Escape cancel",
      confirm: () => void store.confirmArchive(modal.key, modal.keys),
    };
  }
  return {
    title: count > 1 ? `Untrack ${count} repositories` : "Untrack repository",
    message:
      count > 1
        ? `stop tracking ${count} repositories — clones stay on disk — y/N`
        : `stop tracking ${modal.key} — the clone stays on disk — y/N`,
    detail:
      count > 1
        ? `This only removes ${count} repositories from the repotruck workspace config; nothing on disk is touched. Only y confirms; anything else cancels.`
        : `This only removes ${modal.key} from the repotruck workspace config; nothing on disk is touched. Only y confirms; anything else cancels.`,
    hint: "y untrack · N/Escape cancel",
    confirm: () => void store.confirmUntrack(modal.key, modal.keys),
  };
}

export function ConfirmModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const modal = asConfirmModal(snapshot.modal);
  const dimFg = theme.dim();
  const warningFg = theme.error();

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
      borderColor={warningFg}
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
        <text fg={warningFg}>{config.title}</text>
        <text
          fg={dimFg}
          onMouseDown={(e) => {
            e.stopPropagation();
            store.closeModal();
          }}
        >
          {"[× Close]"}
        </text>
      </box>
      <text fg={warningFg}>{config.message}</text>
      <text fg={dimFg}>{config.detail}</text>
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
          fg={dimFg}
          onMouseDown={(e) => {
            e.stopPropagation();
            store.closeModal();
          }}
        >
          {" [ Cancel ] "}
        </text>
      </box>
      <text
        fg={dimFg}
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

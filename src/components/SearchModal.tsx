import { useKeyboard } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { ModalShell } from "./ModalShell.tsx";
import type { Store } from "./store.ts";

export function SearchModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const initial =
    snapshot.modal !== null && snapshot.modal.type === "search" ? snapshot.modal.initial : "";
  const [term, setTerm] = useState(initial);

  useKeyboard((key) => {
    if (key.name === "escape") {
      store.clearSearch();
      store.closeModal();
    }
  });

  return (
    <ModalShell
      store={store}
      title="Search"
      hint="Filters as you type · Enter closes · Escape clears and closes"
    >
      <text>Filter repositories by owner or name (case-insensitive substring):</text>
      <input
        focused
        value={term}
        onInput={(value) => {
          setTerm(value);
          store.applySearch(value);
        }}
        onSubmit={() => {
          store.applySearch(term);
          store.closeModal();
        }}
        width="100%"
      />
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg="green"
          onMouseDown={(e) => {
            e.stopPropagation();
            store.applySearch(term);
            store.closeModal();
          }}
        >
          {"[ Done ]"}
        </text>
        <text
          fg="gray"
          onMouseDown={(e) => {
            e.stopPropagation();
            store.clearSearch();
            store.closeModal();
          }}
        >
          {"[ Clear & Close ]"}
        </text>
      </box>
    </ModalShell>
  );
}

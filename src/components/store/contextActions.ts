import type { Store } from "./Store.ts";

export function executeContextAction(
  store: Store,
  key: string,
  action: string,
  selectKey: (key: string) => void,
): void {
  switch (action) {
    case "detail":
      store.openDetailModal(key);
      return;
    case "open":
      void store.openOpenModal(key);
      return;
    case "sync":
      void store.submitClone(key);
      return;
    case "move":
      void store.openMoveModal(key);
      return;
    case "alias":
      void store.openAliasModal(key);
      return;
    case "pin":
      selectKey(key);
      void store.togglePinSelection();
      return;
    case "worktree":
      void store.openWorktreeModal(key);
      return;
    case "archive":
      selectKey(key);
      store.openSelectionArchiveConfirm();
      return;
    case "untrack":
      selectKey(key);
      store.openSelectionUntrackConfirm();
      return;
    case "delete":
      selectKey(key);
      void store.openSelectionDeleteConfirm();
      return;
    case "delete-permanent":
      store.openPermanentDeleteConfirm(key);
      return;
    case "resolve":
      store.setView("resolve");
      store.pushStatus("DONE", "[resolve]", `sync resolve ${key} — guide page arrives with t15`);
      return;
    default:
      return;
  }
}

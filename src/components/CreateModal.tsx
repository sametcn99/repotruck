import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { validateCreateName } from "../services/creator.ts";
import { ModalShell, SelectList } from "./ModalShell.tsx";
import { type CreateStep, nextCreateStep, prevCreateStep, type Store } from "./store.ts";
import { theme } from "./theme.ts";
import { visibleSlice } from "./windowing.ts";

const STEP_LABELS: Record<string, string> = {
  name: "[1/6] name",
  source: "[2/6] source",
  org: "[3/6] owner",
  path: "[4/6] path",
  description: "[5/6] description",
  visibility: "[6/6] visibility",
};

function createHint(step: CreateStep, editingSource: boolean): string {
  if (step === "name") return "Enter next · Esc cancel";
  const back = "Shift+Tab back · Esc cancel";
  if (step === "visibility") return `Space visibility · Enter create · ${back}`;
  if (step === "source") {
    return editingSource
      ? `Tab source options · Enter next · ${back}`
      : `Space change source · Enter next · ${back}`;
  }
  if (step === "org") return `↑↓ owner · Enter next · ${back}`;
  return `Enter next · ${back}`;
}

export function CreateModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { height } = useTerminalDimensions();
  const modal = snapshot.modal;
  const step = modal !== null && modal.type === "create" ? modal.step : "name";
  const draft =
    modal !== null && modal.type === "create"
      ? modal.draft
      : { name: "", path: "", isPrivate: true };
  const [name, setName] = useState(draft.name);
  const [path, setPath] = useState(draft.path);
  const [pathCustomized, setPathCustomized] = useState(draft.path.length > 0);
  const [description, setDescription] = useState(draft.description ?? "");
  const [fromDir, setFromDir] = useState(draft.fromDir ?? "");
  const [sourceImport, setSourceImport] = useState(draft.fromDir !== undefined);
  const [sourceInput, setSourceInput] = useState(true);
  const [orgCursor, setOrgCursor] = useState(0);
  const dimFg = theme.dim();
  const selectedFg = theme.success();

  const orgRows: Array<{ label: string; org: string | undefined }> = [
    { label: `Personal (${snapshot.userLogin ?? "unknown"})`, org: undefined },
    ...snapshot.orgs.map((org) => ({ label: org, org })),
  ];
  const boundedOrgCursor = Math.min(orgCursor, Math.max(0, orgRows.length - 1));
  const orgViewport = Math.max(2, height - 16);
  const orgWin = visibleSlice(boundedOrgCursor, orgRows.length, orgViewport);
  const visibleOrgRows = orgRows.slice(orgWin.start, orgWin.end);
  const selectedOrg = draft.org;

  const advance = (partial: Partial<typeof draft>): void => {
    const next = nextCreateStep(step);
    if (next === null) return;
    store.setModalError(null);
    store.setModal({
      type: "create",
      step: next,
      draft: { ...draft, ...partial },
    });
  };

  const goBack = (): void => {
    const prev = prevCreateStep(step);
    if (prev === null) return;
    store.setModalError(null);
    store.setModal({
      type: "create",
      step: prev,
      draft,
    });
  };

  const advanceFromName = (): void => {
    const trimmed = name.trim();
    if (validateCreateName(trimmed) === null) {
      store.setModalError(`invalid repository name: ${trimmed || "(empty)"}`);
      return;
    }
    setName(trimmed);
    advance({
      name: trimmed,
      path: pathCustomized ? path : "",
    });
  };

  const advanceFromSource = (): void => {
    if (sourceImport && fromDir.trim().length === 0) {
      store.setModalError("source directory path is required when importing");
      return;
    }
    advance(sourceImport ? { fromDir: fromDir.trim() } : { fromDir: undefined });
  };

  const advanceFromOrg = (): void => {
    const org = orgRows[boundedOrgCursor]?.org;
    const nextPath = pathCustomized && path.length > 0 ? path : store.presetTargetFor(name, org);
    setPath(nextPath);
    advance({
      org,
      path: nextPath,
    });
  };

  const advanceFromPath = (): void => {
    advance({ path });
  };

  const advanceFromDescription = (): void => {
    advance({ description: description.length > 0 ? description : undefined });
  };

  const editingSource = step === "source" && sourceImport && sourceInput;
  const editingText = step === "name" || step === "path" || step === "description" || editingSource;

  useKeyboard((key) => {
    if ((key.name === "tab" && key.shift) || (key.name === "left" && !editingText)) {
      key.stopPropagation();
      goBack();
      return;
    }
    if (step === "source") {
      if (key.name === "tab" && sourceImport) {
        key.stopPropagation();
        setSourceInput((current) => !current);
      } else if (!editingSource && key.name === "space") {
        store.setModalError(null);
        setSourceImport((current) => !current);
        setSourceInput(true);
      } else if (!editingSource && key.name === "return") {
        if (sourceImport) setSourceInput(true);
        else advanceFromSource();
      }
      return;
    }
    if (step === "org") {
      if (key.name === "up") {
        setOrgCursor(Math.max(0, boundedOrgCursor - 1));
      } else if (key.name === "down") {
        setOrgCursor(Math.min(orgRows.length - 1, boundedOrgCursor + 1));
      } else if (key.name === "return") {
        advanceFromOrg();
      }
      return;
    }
    if (step !== "visibility") return;
    if (key.name === "space") {
      store.setModal({
        type: "create",
        step,
        draft: { ...draft, name, path, isPrivate: !draft.isPrivate },
      });
    } else if (key.name === "return") {
      void store.submitCreate({
        ...draft,
        name,
        path,
        description: description.length > 0 ? description : undefined,
        fromDir: sourceImport && fromDir.trim().length > 0 ? fromDir.trim() : undefined,
        org: selectedOrg,
      });
    }
  });

  return (
    <ModalShell store={store} title="New repository" hint={createHint(step, editingSource)}>
      <text fg={theme.focusBorder()}>{STEP_LABELS[step] ?? step}</text>
      {step === "name" ? (
        <>
          <text>Repository name:</text>
          <input
            key="step-name"
            focused
            value={name}
            onInput={(val) => {
              setName(val);
              if (snapshot.modalError !== null) store.setModalError(null);
            }}
            onSubmit={advanceFromName}
            width="100%"
          />
        </>
      ) : null}
      {step === "source" ? (
        <>
          <text>Where does the repository come from?</text>
          <text
            fg={!sourceImport ? selectedFg : dimFg}
            onMouseDown={(e) => {
              e.stopPropagation();
              store.setModalError(null);
              setSourceImport(false);
            }}
          >
            {[`${!sourceImport ? "[x]" : "[ ]"} New (empty) repository`]}
          </text>
          <text
            fg={sourceImport ? selectedFg : dimFg}
            onMouseDown={(e) => {
              e.stopPropagation();
              store.setModalError(null);
              setSourceImport(true);
              setSourceInput(true);
            }}
          >
            {[`${sourceImport ? "[x]" : "[ ]"} Import from a local directory (--from)`]}
          </text>
          {sourceImport ? (
            <input
              key="step-source-dir"
              focused={editingSource}
              onMouseDown={() => setSourceInput(true)}
              placeholder="Local directory"
              value={fromDir}
              onInput={(value) => {
                setFromDir(value);
                if (snapshot.modalError !== null) store.setModalError(null);
              }}
              onSubmit={advanceFromSource}
              width="100%"
            />
          ) : null}
        </>
      ) : null}
      {step === "org" ? (
        <>
          <text>Owner (a Git repository must be clean when importing):</text>
          <SelectList
            items={visibleOrgRows}
            cursor={boundedOrgCursor - orgWin.start}
            keyOf={(row) => row.label}
            labelOf={(row) => row.label}
            fgOf={(row, isCursor) =>
              isCursor ? theme.cursorFg() : selectedOrg === row.org ? selectedFg : theme.normal()
            }
            onSelect={(_row, index) => setOrgCursor(orgWin.start + index)}
            onActivate={() => advanceFromOrg()}
          />
        </>
      ) : null}
      {step === "path" ? (
        <>
          <text>Workspace-relative path:</text>
          <input
            key="step-path"
            focused
            value={path}
            onInput={(val) => {
              setPath(val);
              setPathCustomized(true);
            }}
            onSubmit={advanceFromPath}
            width="100%"
          />
        </>
      ) : null}
      {step === "description" ? (
        <>
          <text>Description (optional):</text>
          <input
            key="step-description"
            focused
            value={description}
            onInput={setDescription}
            onSubmit={advanceFromDescription}
            width="100%"
          />
        </>
      ) : null}
      {step === "visibility" ? (
        <>
          <text
            fg={draft.isPrivate ? selectedFg : dimFg}
            onMouseDown={(e) => {
              e.stopPropagation();
              store.setModal({
                type: "create",
                step,
                draft: { ...draft, name, path, isPrivate: true },
              });
            }}
          >
            {`[${draft.isPrivate ? "x" : " "}] Private`}
          </text>
          <text
            fg={!draft.isPrivate ? selectedFg : dimFg}
            onMouseDown={(e) => {
              e.stopPropagation();
              store.setModal({
                type: "create",
                step,
                draft: { ...draft, name, path, isPrivate: false },
              });
            }}
          >
            {`[${!draft.isPrivate ? "x" : " "}] Public`}
          </text>
        </>
      ) : null}
      <box flexDirection="row" flexWrap="wrap" gap={2} marginTop={height < 20 ? 0 : 1}>
        {step !== "name" ? (
          <text
            fg={dimFg}
            onMouseDown={(e) => {
              e.stopPropagation();
              goBack();
            }}
          >
            {"[Shift+Tab] Back"}
          </text>
        ) : null}
        {step === "visibility" ? (
          <text
            fg={selectedFg}
            onMouseDown={(e) => {
              e.stopPropagation();
              void store.submitCreate({
                ...draft,
                name,
                path,
                description: description.length > 0 ? description : undefined,
                fromDir: sourceImport && fromDir.trim().length > 0 ? fromDir.trim() : undefined,
                org: selectedOrg,
              });
            }}
          >
            {"[Enter] Create Repository"}
          </text>
        ) : (
          <text
            fg={selectedFg}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (step === "name") advanceFromName();
              else if (step === "source") advanceFromSource();
              else if (step === "org") advanceFromOrg();
              else if (step === "path") advanceFromPath();
              else if (step === "description") advanceFromDescription();
            }}
          >
            {"[Enter] Continue"}
          </text>
        )}
        <text
          fg={dimFg}
          onMouseDown={(e) => {
            e.stopPropagation();
            store.closeModal();
          }}
        >
          {"[ Cancel ]"}
        </text>
      </box>
    </ModalShell>
  );
}

import { useKeyboard } from "@opentui/react";
import { useState, useSyncExternalStore } from "react";
import { validateCreateName } from "../services/creator.ts";
import { ModalShell, SelectList } from "./ModalShell.tsx";
import { type CreateStep, nextCreateStep, prevCreateStep, type Store } from "./store.ts";
import { theme } from "./theme.ts";

const STEP_LABELS: Record<string, string> = {
  name: "[1/6] name",
  source: "[2/6] source",
  org: "[3/6] owner",
  path: "[4/6] path",
  description: "[5/6] description",
  visibility: "[6/6] visibility",
};

function createHint(step: CreateStep): string {
  if (step === "visibility") {
    return "Space flips visibility \u00b7 Enter creates \u00b7 Left back \u00b7 Escape cancels";
  }
  if (step === "source") {
    return "Space toggles the source \u00b7 Enter continues \u00b7 Left back \u00b7 Escape cancels";
  }
  if (step === "org") {
    return "Up/Down choose the owner \u00b7 Enter continues \u00b7 Left back \u00b7 Escape cancels";
  }
  if (step === "name") {
    return "Enter continues \u00b7 Escape cancels";
  }
  return "Enter continues \u00b7 Left back \u00b7 Escape cancels";
}

export function CreateModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
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
  const [orgCursor, setOrgCursor] = useState(0);
  const dimFg = theme.dim();
  const selectedFg = theme.success();

  const orgRows: Array<{ label: string; org: string | undefined }> = [
    { label: `Personal (${snapshot.userLogin ?? "unknown"})`, org: undefined },
    ...snapshot.orgs.map((org) => ({ label: org, org })),
  ];
  const boundedOrgCursor = Math.min(orgCursor, Math.max(0, orgRows.length - 1));
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

  useKeyboard((key) => {
    if (key.name === "left") {
      goBack();
      return;
    }
    if (step === "source") {
      if (key.name === "space") {
        store.setModalError(null);
        setSourceImport((current) => !current);
      } else if (key.name === "return" && !sourceImport) {
        advanceFromSource();
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
    <ModalShell store={store} title="New repository" hint={createHint(step)}>
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
            }}
          >
            {[`${sourceImport ? "[x]" : "[ ]"} Import from a local directory (--from)`]}
          </text>
          {sourceImport ? (
            <input
              key="step-source-dir"
              focused
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
            items={orgRows}
            cursor={boundedOrgCursor}
            keyOf={(row) => row.label}
            labelOf={(row) => row.label}
            fgOf={(row, isCursor) =>
              isCursor ? theme.cursorFg() : selectedOrg === row.org ? selectedFg : theme.normal()
            }
            onSelect={(_row, index) => setOrgCursor(index)}
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
      <box flexDirection="row" gap={2} marginTop={1}>
        {step !== "name" ? (
          <text
            fg={dimFg}
            onMouseDown={(e) => {
              e.stopPropagation();
              goBack();
            }}
          >
            {"[ < Back ]"}
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
            {"[ Create Repository ]"}
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
            {"[ Continue > ]"}
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

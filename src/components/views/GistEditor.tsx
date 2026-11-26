import type { InputRenderable, TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState } from "react";
import type { GistCreate, GistDetail, GistEdit } from "../../services/gistApi.ts";
import { theme } from "../theme.ts";
import { clampBoxLine } from "../windowing.ts";

interface DraftFile {
  key: string;
  original: string | null;
  name: string;
  content: string | null;
}

function editDraft(
  detail: GistDetail,
  description: string,
  drafts: readonly DraftFile[],
): GistEdit {
  const files = drafts.flatMap(({ original, name, content }) =>
    content !== null && (original === null || detail.contents[original] !== content)
      ? [{ name: original ?? name, content }]
      : [],
  );
  const rename = drafts.flatMap(({ original, name }) =>
    original !== null && original !== name ? [{ from: original, to: name }] : [],
  );
  const present = new Set(drafts.map(({ original }) => original));
  return {
    expectedVersion: detail.version,
    description: description === detail.description ? undefined : description,
    files,
    rename,
    remove: detail.files.filter((name) => !present.has(name)),
  };
}

export function GistEditor({
  detail,
  active,
  busy,
  width,
  height,
  cancel,
  saveCreate,
  saveEdit,
}: {
  detail?: GistDetail;
  active: boolean;
  busy: boolean;
  width: number;
  height: number;
  cancel: () => void;
  saveCreate: (input: GistCreate) => void;
  saveEdit: (input: GistEdit) => void;
}) {
  const [visibility, setVisibility] = useState(false);
  const [drafts, setDrafts] = useState<DraftFile[]>(() =>
    detail
      ? detail.files.map((name) => ({
          key: `existing:${name}`,
          original: name,
          name,
          content: detail.contents[name] ?? null,
        }))
      : [{ key: "new:0", original: null, name: "", content: "" }],
  );
  const [cursor, setCursor] = useState(0);
  const [field, setField] = useState(0);
  const nextFile = useRef(1);
  const textarea = useRef<TextareaRenderable | null>(null);
  const descriptionField = useRef<InputRenderable | null>(null);
  const filenameField = useRef<InputRenderable | null>(null);
  const selected = drafts[cursor];
  const mayEditFiles = detail?.truncated !== true;
  const fields = mayEditFiles && selected ? (selected.content === null ? 2 : 3) : 1;

  function readFiles(): DraftFile[] {
    return drafts.map((file, index) =>
      index === cursor
        ? {
            ...file,
            name: filenameField.current?.value ?? file.name,
            content: textarea.current?.plainText ?? file.content,
          }
        : file,
    );
  }

  function moveFile(delta: number) {
    if (!drafts.length) return;
    setDrafts(readFiles());
    setCursor((cursor + delta + drafts.length) % drafts.length);
    setField(1);
  }

  function addFile() {
    if (!mayEditFiles) return;
    setDrafts([
      ...readFiles(),
      { key: `new:${nextFile.current++}`, original: null, name: "", content: "" },
    ]);
    setCursor(drafts.length);
    setField(1);
  }

  function removeFile() {
    if (!mayEditFiles || drafts.length <= 1) return;
    setDrafts(readFiles().filter((_, index) => index !== cursor));
    setCursor(Math.min(cursor, drafts.length - 2));
    setField(1);
  }

  function save() {
    const description = descriptionField.current?.value ?? detail?.description ?? "";
    const files = readFiles();
    if (detail) saveEdit(editDraft(detail, description, files));
    else
      saveCreate({
        description,
        public: visibility,
        files: files.map(({ name, content }) => ({ name, content: content ?? "" })),
      });
  }

  useKeyboard((key) => {
    if (!active || busy) return;
    if (key.name === "escape") {
      key.stopPropagation();
      cancel();
    } else if (key.name === "tab") {
      key.stopPropagation();
      setField((Math.min(field, fields - 1) + (key.shift ? fields - 1 : 1)) % fields);
    } else if (key.ctrl) {
      switch (key.name) {
        case "s":
          key.stopPropagation();
          save();
          break;
        case "up":
          key.stopPropagation();
          moveFile(-1);
          break;
        case "down":
          key.stopPropagation();
          moveFile(1);
          break;
        case "n":
          key.stopPropagation();
          addFile();
          break;
        case "d":
          key.stopPropagation();
          removeFile();
          break;
        case "p":
          if (!detail) {
            key.stopPropagation();
            setVisibility(!visibility);
          }
          break;
      }
    }
  });

  const focus = active && !busy;
  return (
    <box flexGrow={1} flexDirection="column" minHeight={0} gap={0}>
      <text fg={theme.accent()} flexShrink={0}>
        {detail ? "Edit Gist on GitHub" : "Create GitHub Gist"}
      </text>
      <text fg={theme.dim()} flexShrink={0}>
        {detail
          ? detail.public
            ? "Public Gist"
            : "Secret Gist"
          : visibility
            ? "Public · anyone can find it [Ctrl+P]"
            : "Secret · anyone with the link can open it [Ctrl+P]"}
      </text>
      <input
        focused={focus && field === 0}
        ref={descriptionField}
        value={detail?.description ?? ""}
        placeholder="Description"
      />
      {selected && mayEditFiles ? (
        <>
          <text fg={theme.dim()} flexShrink={0}>
            {`File ${cursor + 1}/${drafts.length} · Ctrl+↑/↓ switch · Ctrl+N add · Ctrl+D remove`}
          </text>
          <input
            key={`name:${selected.key}`}
            focused={focus && field === 1}
            value={selected.name}
            placeholder="Filename"
            ref={filenameField}
          />
          {selected.content === null ? (
            <text fg={theme.muted()}>Use the local Git clone to edit this file’s contents.</text>
          ) : (
            <textarea
              key={`content:${selected.key}`}
              ref={textarea}
              focused={focus && field === 2}
              flexShrink={0}
              height={Math.max(2, height - 7)}
              initialValue={selected.content}
              placeholder="File contents"
            />
          )}
        </>
      ) : (
        <text fg={theme.muted()}>Use the local Git clone to edit the complete file list.</text>
      )}
      <text
        fg={theme.accent()}
        flexShrink={0}
        onMouseDown={(event) => {
          event.stopPropagation();
          if (focus) save();
        }}
      >
        {clampBoxLine(busy ? "Saving…" : "[Ctrl+S] Save · [Tab] Move focus · [Esc] Cancel", width)}
      </text>
    </box>
  );
}

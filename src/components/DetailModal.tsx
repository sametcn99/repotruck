import path from "node:path";
import { useKeyboard } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { simpleGit } from "simple-git";
import { aheadBehindCount } from "../services/cloner.ts";
import { loadWorkspace } from "../services/workspace.ts";
import { ModalShell } from "./ModalShell.tsx";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

const DIM_FG = theme.dim();
const ERROR_FG = theme.error();

interface DetailLocal {
  tracked: boolean;
  relativePath: string | null;
  alias: string | null;
  disk: string;
}

const DISK_LOADING = "checking…";

export async function detailLocalFor(root: string, key: string): Promise<DetailLocal> {
  const config = await loadWorkspace(root);
  const [owner, name, ...rest] = key.split("/");
  if (owner === undefined || name === undefined || rest.length > 0) {
    return { tracked: false, relativePath: null, alias: null, disk: DISK_LOADING };
  }
  const entry = config.repos.find(
    (item) =>
      item.owner.toLowerCase() === owner.toLowerCase() &&
      item.name.toLowerCase() === name.toLowerCase(),
  );
  if (entry === undefined) {
    return { tracked: false, relativePath: null, alias: null, disk: DISK_LOADING };
  }
  const alias = Object.entries(config.aliases ?? {}).find(
    ([, target]) => target.toLowerCase() === entry.relativePath.toLowerCase(),
  )?.[0];
  const dir = path.join(root, ...entry.relativePath.split("/"));
  let disk = DISK_LOADING;
  try {
    const git = simpleGit(dir);
    const inside = (await git.raw(["rev-parse", "--is-inside-work-tree"])).trim();
    if (inside !== "true") {
      disk = "not a git repository";
    } else {
      try {
        const status = await git.raw(["status", "--porcelain"]);
        const dirty = status.trim().length > 0 ? "dirty" : "clean";
        try {
          const { ahead, behind } = await aheadBehindCount(git);
          disk = `${dirty}, ahead ${ahead}, behind ${behind}`;
        } catch {
          disk = `${dirty}, no upstream`;
        }
      } catch {
        disk = "unknown git status";
      }
    }
  } catch {
    disk = "not on disk";
  }
  return {
    tracked: true,
    relativePath: entry.relativePath,
    alias: alias ?? null,
    disk,
  };
}

export function DetailModal({ store }: { store: Store }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const modal = snapshot.modal;
  const key = modal !== null && modal.type === "detail" ? modal.key : "";
  const repo = snapshot.repos.find(
    (item) => `${item.owner}/${item.name}`.toLowerCase() === key.toLowerCase(),
  );
  const [local, setLocal] = useState<DetailLocal | null>(null);

  useEffect(() => {
    let active = true;
    void detailLocalFor(store.root, key).then((result) => {
      if (active) setLocal(result);
    });
    return () => {
      active = false;
    };
  }, [store.root, key]);

  useKeyboard((keyEvent) => {
    if (keyEvent.name === "escape" || keyEvent.name === "return") {
      store.closeModal();
    }
  });

  if (repo === undefined) {
    return (
      <ModalShell store={store} title="Repository details" hint="Escape closes">
        <text fg={ERROR_FG}>{`repository not in the current list: ${key}`}</text>
      </ModalShell>
    );
  }

  const flags: string[] = [];
  if (repo.isPrivate) flags.push("[Private]");
  if (repo.isFork) flags.push("[Fork]");
  if (repo.isArchived) flags.push("[Archived]");

  return (
    <ModalShell store={store} title="Repository details" hint="Escape closes" gap={0}>
      <text>{`${key}${flags.length > 0 ? ` ${flags.join(" ")}` : ""}`}</text>
      <text fg={DIM_FG}>{`description: ${repo.description ?? "no description"}`}</text>
      <text fg={DIM_FG}>{`language: ${repo.language ?? "null"}`}</text>
      {typeof repo.stars === "number" ? <text fg={DIM_FG}>{`stars: ${repo.stars}`}</text> : null}
      <text fg={DIM_FG}>{`updated: ${repo.updatedAt ?? "unknown"}`}</text>
      <text fg={DIM_FG}>{`url: ${repo.httpsUrl}`}</text>
      <text fg={DIM_FG}>
        {local === null
          ? "local: checking…"
          : local.tracked
            ? `tracked at ${local.relativePath}${local.alias !== null ? ` · alias: ${local.alias}` : ""} · ${local.disk}`
            : "not tracked by repotruck"}
      </text>
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={theme.dim()}
          onMouseDown={(e) => {
            e.stopPropagation();
            store.closeModal();
          }}
        >
          {"[ Close ]"}
        </text>
      </box>
    </ModalShell>
  );
}

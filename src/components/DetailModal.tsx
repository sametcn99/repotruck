import { existsSync } from "node:fs";
import path from "node:path";
import { useKeyboard } from "@opentui/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { simpleGit } from "simple-git";
import { loadWorkspace } from "../services/workspace.ts";
import { inspectGitDotEntry } from "../services/worktree.ts";
import { ModalShell } from "./ModalShell.tsx";
import type { RepoLocalHealth } from "./store/types.ts";
import type { Store } from "./store.ts";
import { theme } from "./theme.ts";

interface DetailLocal {
  tracked: boolean;
  relativePath: string | null;
  alias: string | null;
  disk: string;
}

const DISK_LOADING = "checking\u2026";

function parsePorcelainDiskState(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const header = lines[0] ?? "";
  const rest = lines.slice(1).filter((line) => line.trim().length > 0);
  const dirty = rest.length > 0 ? "dirty" : "clean";
  if (header.startsWith("## ") && header.includes("...")) {
    const aheadMatch = /\bahead (\d+)/.exec(header);
    const behindMatch = /\bbehind (\d+)/.exec(header);
    const ahead = aheadMatch?.[1] ? Number.parseInt(aheadMatch[1], 10) : 0;
    const behind = behindMatch?.[1] ? Number.parseInt(behindMatch[1], 10) : 0;
    return `${dirty}, ahead ${ahead}, behind ${behind}`;
  }
  return `${dirty}, no upstream`;
}

function seedDetailFromHealth(info: RepoLocalHealth | undefined): DetailLocal | null {
  if (info === undefined) return null;
  if (!info.tracked) {
    return { tracked: false, relativePath: null, alias: null, disk: DISK_LOADING };
  }
  if (info.missing) {
    return {
      tracked: true,
      relativePath: info.relativePath,
      alias: info.alias,
      disk: "not on disk",
    };
  }
  const dirty = info.dirty ? "dirty" : "clean";
  const disk =
    info.ahead > 0 || info.behind > 0
      ? `${dirty}, ahead ${info.ahead}, behind ${info.behind}`
      : `${dirty}, no upstream`;
  return {
    tracked: true,
    relativePath: info.relativePath,
    alias: info.alias,
    disk,
  };
}

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
  if (!existsSync(dir)) {
    disk = "not on disk";
  } else if (inspectGitDotEntry(dir).kind === "none") {
    disk = "not a git repository";
  } else {
    try {
      const git = simpleGit(dir);
      const raw = await git.raw(["status", "--porcelain=v1", "-b"]);
      disk = parsePorcelainDiskState(raw);
    } catch {
      disk = "unknown git status";
    }
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
  const seeded = seedDetailFromHealth(snapshot.localHealth?.get(key.toLowerCase()));
  const [local, setLocal] = useState<DetailLocal | null>(seeded);
  const dimFg = theme.dim();

  useEffect(() => {
    let active = true;
    setLocal(seedDetailFromHealth(store.getSnapshot().localHealth?.get(key.toLowerCase())));
    void detailLocalFor(store.root, key).then((result) => {
      if (active) setLocal(result);
    });
    return () => {
      active = false;
    };
  }, [store, key]);

  useKeyboard((keyEvent) => {
    if (keyEvent.name === "escape" || keyEvent.name === "return") {
      store.closeModal();
    }
  });

  if (repo === undefined) {
    return (
      <ModalShell store={store} title="Repository details" hint="Escape closes">
        <text fg={theme.error()}>{`repository not in the current list: ${key}`}</text>
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
      <text fg={dimFg}>{`description: ${repo.description ?? "no description"}`}</text>
      <text fg={dimFg}>{`language: ${repo.language ?? "null"}`}</text>
      {typeof repo.stars === "number" ? <text fg={dimFg}>{`stars: ${repo.stars}`}</text> : null}
      <text fg={dimFg}>{`updated: ${repo.updatedAt ?? "unknown"}`}</text>
      <text fg={dimFg}>{`url: ${repo.httpsUrl}`}</text>
      <text fg={dimFg}>
        {local === null
          ? "local: checking\u2026"
          : local.tracked
            ? `tracked at ${local.relativePath}${local.alias !== null ? ` \u00b7 alias: ${local.alias}` : ""} \u00b7 ${local.disk}`
            : "not tracked by repotruck"}
      </text>
      <box flexDirection="row" gap={2} marginTop={1}>
        <text
          fg={dimFg}
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

import { existsSync } from "node:fs";
import { simpleGit } from "simple-git";
import { loadWorkspace } from "../../services/workspace.ts";
import { workspacePath } from "../../services/workspacePaths.ts";
import { inspectGitDotEntry } from "../../services/worktree.ts";
import type { RepoLocalHealth } from "./types.ts";

export interface DetailLocal {
  tracked: boolean;
  relativePath: string | null;
  alias: string | null;
  disk: string;
}

export const DISK_LOADING = "checking\u2026";

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

export function seedDetailFromHealth(info: RepoLocalHealth | undefined): DetailLocal | null {
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
  const dir = workspacePath(root, entry.relativePath);
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

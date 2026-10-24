import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { sanitizeSegment } from "../presets/index.ts";
import type { RepotruckConfig } from "./config.ts";
import { saveWorkspace } from "./workspace.ts";

export function moveDir(src: string, dest: string): void {
  mkdirSync(path.dirname(dest), { recursive: true });
  try {
    renameSync(src, dest);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "EXDEV"
    ) {
      try {
        cpSync(src, dest, { recursive: true });
      } catch (copyError) {
        // Never leave a half-copied destination behind; the source is intact.
        try {
          rmSync(dest, { recursive: true, force: true });
        } catch {
          /* best effort cleanup */
        }
        throw copyError;
      }
      rmSync(src, { recursive: true, force: true });
      return;
    }
    throw error;
  }
}

export function validateMoveDestination(dest: string): string[] | null {
  if (dest.length === 0) return null;
  if (/^[A-Za-z]:/.test(dest)) return null;
  if (path.isAbsolute(dest)) return null;
  const segments = dest.split("\\").join("/").split("/");
  if (segments.some((segment) => segment === ".." || segment === ".")) return null;
  const cleaned = segments
    .filter((segment) => segment.length > 0)
    .map((segment) => sanitizeSegment(segment));
  if (cleaned.length === 0) return null;
  return cleaned;
}

export interface MoveResult {
  ok: boolean;
  message: string;
}

export interface MoveOptions {
  emit?: (message: string) => void;
}

export async function moveRepository(
  root: string,
  config: RepotruckConfig,
  key: string,
  destRelative: string,
  options: MoveOptions = {},
): Promise<MoveResult> {
  const [keyOwner, keyName, ...rest] = key.split("/");
  if (
    keyOwner === undefined ||
    keyOwner.length === 0 ||
    keyName === undefined ||
    keyName.length === 0 ||
    rest.length > 0
  ) {
    return { ok: false, message: `invalid repository key: ${key}` };
  }

  const entry = config.repos.find(
    (item) =>
      item.owner.toLowerCase() === keyOwner.toLowerCase() &&
      item.name.toLowerCase() === keyName.toLowerCase(),
  );
  if (entry === undefined) {
    return { ok: false, message: `${key} is not tracked by repotruck` };
  }

  const sourceDir = path.join(root, ...entry.relativePath.split("/"));
  if (!existsSync(sourceDir)) {
    return { ok: false, message: `${key} is not on disk` };
  }

  const segments = validateMoveDestination(destRelative);
  if (segments === null) {
    return {
      ok: false,
      message: `invalid destination path: ${destRelative}`,
    };
  }
  const destDir = path.join(root, ...segments);
  const destRel = segments.join("/");
  const alreadyThere = entry.relativePath.toLowerCase() === destRel.toLowerCase();
  if (alreadyThere) {
    return { ok: true, message: "already there" };
  }

  const occupiedByOther = config.repos.some(
    (item) =>
      !(
        item.owner.toLowerCase() === entry.owner.toLowerCase() &&
        item.name.toLowerCase() === entry.name.toLowerCase()
      ) && item.relativePath.toLowerCase() === destRel.toLowerCase(),
  );
  if (occupiedByOther) {
    return {
      ok: false,
      message: `destination is already tracked by another repository: ${destRel}`,
    };
  }
  if (existsSync(destDir)) {
    return { ok: false, message: `destination already exists on disk: ${destRel}` };
  }

  options.emit?.(`moving ${key} to ${destRel}`);
  moveDir(sourceDir, destDir);

  const repos = config.repos.map((item) =>
    item.owner.toLowerCase() === entry.owner.toLowerCase() &&
    item.name.toLowerCase() === entry.name.toLowerCase()
      ? { ...item, relativePath: destRel, custom: true }
      : item,
  );
  const aliases: Record<string, string> = { ...(config.aliases ?? {}) };
  for (const [alias, target] of Object.entries(aliases)) {
    if (target.toLowerCase() === entry.relativePath.toLowerCase()) {
      aliases[alias] = destRel;
    }
  }
  await saveWorkspace(root, { ...config, repos, aliases });
  return { ok: true, message: `moved to ${destRel}` };
}

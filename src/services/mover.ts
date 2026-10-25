import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, renameSync, rmdirSync, rmSync } from "node:fs";
import path from "node:path";
import { sanitizeSegment } from "../presets/index.ts";
import { firstErrorLine } from "./cloner.ts";
import type { RepotruckConfig } from "./config.ts";
import { repoKeyEquals } from "./fsUtils.ts";
import { updateWorkspace } from "./workspace.ts";

export interface MoveFsDeps {
  renameSync?: typeof renameSync;
  mkdirSync?: typeof mkdirSync;
  cpSync?: typeof cpSync;
  rmSync?: typeof rmSync;
  existsSync?: typeof existsSync;
  rmdirSync?: typeof rmdirSync;
}

export function moveDir(src: string, dest: string, deps: MoveFsDeps = {}): void {
  const mkdirFn = deps.mkdirSync ?? mkdirSync;
  const renameFn = deps.renameSync ?? renameSync;
  const cpFn = deps.cpSync ?? cpSync;
  const rmFn = deps.rmSync ?? rmSync;
  const existsFn = deps.existsSync ?? existsSync;
  const rmdirFn = deps.rmdirSync ?? rmdirSync;

  const destParent = path.dirname(dest);
  mkdirFn(destParent, { recursive: true });
  try {
    renameFn(src, dest);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "EXDEV"
    ) {
      try {
        cpFn(src, dest, { recursive: true });
      } catch (copyError) {
        // Never leave a half-copied destination behind; the source is intact.
        try {
          rmFn(dest, { recursive: true, force: true });
        } catch {
          /* best effort cleanup */
        }
        // Best-effort cleanup of empty parent directories created for destination
        try {
          let cur = destParent;
          while (cur && cur !== path.dirname(cur)) {
            if (existsFn(cur)) {
              try {
                rmdirFn(cur);
              } catch {
                break; // Stop climbing if directory is not empty or can't be removed
              }
            }
            cur = path.dirname(cur);
          }
        } catch {
          /* best effort cleanup */
        }
        throw copyError;
      }
      rmFn(src, { recursive: true, force: true });
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
  moveDirImpl?: typeof moveDir;
  deps?: MoveFsDeps;
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

  const existsFn = options.deps?.existsSync ?? existsSync;
  const sourceDir = path.join(root, ...entry.relativePath.split("/"));
  if (!existsFn(sourceDir)) {
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

  const isExactSame = entry.relativePath === destRel;
  const isCaseOnly = entry.relativePath.toLowerCase() === destRel.toLowerCase() && !isExactSame;

  if (isExactSame) {
    return { ok: true, message: "already there" };
  }

  if (!isCaseOnly) {
    const occupiedByOther = config.repos.some(
      (item) =>
        !repoKeyEquals(item, entry.owner, entry.name) &&
        item.relativePath.toLowerCase() === destRel.toLowerCase(),
    );
    if (occupiedByOther) {
      return {
        ok: false,
        message: `destination is already tracked by another repository: ${destRel}`,
      };
    }
    if (existsFn(destDir)) {
      return { ok: false, message: `destination already exists on disk: ${destRel}` };
    }
  }

  options.emit?.(`moving ${key} to ${destRel}`);
  const moveFn = options.moveDirImpl ?? ((s: string, d: string) => moveDir(s, d, options.deps));

  if (isCaseOnly) {
    const tempDir = `${sourceDir}.tmp-${randomUUID().slice(0, 8)}`;
    try {
      moveFn(sourceDir, tempDir);
    } catch (phase1Error) {
      return {
        ok: false,
        message: `failed to move repository to ${destRel}: ${firstErrorLine(phase1Error)}`,
      };
    }

    try {
      moveFn(tempDir, destDir);
    } catch (phase2Error) {
      try {
        moveFn(tempDir, sourceDir);
      } catch (rollbackError) {
        return {
          ok: false,
          message: `phase 2 failed (${firstErrorLine(phase2Error)}); rollback failed (${firstErrorLine(rollbackError)})`,
        };
      }
      return {
        ok: false,
        message: `failed to move repository to ${destRel}: ${firstErrorLine(phase2Error)}`,
      };
    }
  } else {
    try {
      moveFn(sourceDir, destDir);
    } catch (error) {
      return {
        ok: false,
        message: `failed to move repository to ${destRel}: ${firstErrorLine(error)}`,
      };
    }
  }

  await updateWorkspace(root, (current) => {
    const repos = current.repos.map((item) =>
      repoKeyEquals(item, entry.owner, entry.name)
        ? { ...item, relativePath: destRel, custom: true }
        : item,
    );
    const aliases: Record<string, string> = { ...(current.aliases ?? {}) };
    for (const [alias, target] of Object.entries(aliases)) {
      if (target.toLowerCase() === entry.relativePath.toLowerCase()) {
        aliases[alias] = destRel;
      }
    }
    return { config: { ...current, repos, aliases }, result: undefined };
  });
  return { ok: true, message: `moved to ${destRel}` };
}

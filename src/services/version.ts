import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function readPackageVersion(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dir, "package.json"), "utf8");
    const pkg: unknown = JSON.parse(raw);
    if (
      pkg !== null &&
      typeof pkg === "object" &&
      typeof (pkg as { version?: unknown }).version === "string"
    ) {
      return (pkg as { version: string }).version;
    }
    return null;
  } catch {
    return null;
  }
}

let cachedVersion: string | null = null;

export async function readVersion(): Promise<string> {
  if (cachedVersion !== null) return cachedVersion;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const version = await readPackageVersion(dir);
    if (version !== null) {
      cachedVersion = version;
      return version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedVersion = "0.0.0";
  return cachedVersion;
}

interface ParsedSemver {
  core: [number, number, number];
  prerelease: string[];
}

const NUMERIC_IDENTIFIER = /^\d+$/;

function parseSemver(value: string): ParsedSemver | null {
  const withoutBuild = value.split("+")[0] ?? "";
  const dashIndex = withoutBuild.indexOf("-");
  const corePart = dashIndex >= 0 ? withoutBuild.slice(0, dashIndex) : withoutBuild;
  const prePart = dashIndex >= 0 ? withoutBuild.slice(dashIndex + 1) : "";
  const corePieces = corePart.split(".");
  if (corePieces.length !== 3) return null;
  const core: [number, number, number] = [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    const piece = corePieces[index];
    if (piece === undefined || !NUMERIC_IDENTIFIER.test(piece)) return null;
    core[index] = Number.parseInt(piece, 10);
  }
  const prerelease =
    prePart.length > 0
      ? prePart
          .split(".")
          .filter((identifier) => identifier.length > 0 && /^[0-9A-Za-z-]+$/.test(identifier))
      : [];
  return { core, prerelease };
}

function comparePrereleaseIdentifiers(left: string, right: string): number {
  const leftIsNumeric = NUMERIC_IDENTIFIER.test(left);
  const rightIsNumeric = NUMERIC_IDENTIFIER.test(right);
  if (leftIsNumeric && rightIsNumeric) {
    const l = Number.parseInt(left, 10);
    const r = Number.parseInt(right, 10);
    return l === r ? 0 : l < r ? -1 : 1;
  }
  if (leftIsNumeric) return -1;
  if (rightIsNumeric) return 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function isNewerVersion(candidate: string | null, current: string): boolean {
  if (candidate === null || candidate.length === 0) return false;
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  if (a === null || b === null) return false;
  for (let index = 0; index < 3; index += 1) {
    const l = a.core[index]!;
    const r = b.core[index]!;
    if (l > r) return true;
    if (l < r) return false;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return false;
  if (a.prerelease.length === 0) return true;
  if (b.prerelease.length === 0) return false;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined) return false;
    if (right === undefined) return true;
    const compared = comparePrereleaseIdentifiers(left, right);
    if (compared > 0) return true;
    if (compared < 0) return false;
  }
  return false;
}

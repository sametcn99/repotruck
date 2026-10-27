import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "__pycache__",
  "venv",
  "coverage",
  "site-packages",
]);

function shouldSkipDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIRS.has(name);
}

export interface IgnoreRule {
  negated: boolean;
  regex: RegExp;
}

/** Compiles a root .gitignore into segment-boundary-safe matchers. */
export function parseGitignore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    if (negated) line = line.slice(1).trim();
    if (line.length === 0) continue;

    const dirOnly = line.endsWith("/");
    const leadingSlash = line.startsWith("/");
    line = line.replace(/^\/+/, "").replace(/\/+$/, "");
    if (line.length === 0) continue;

    // In Git, a leading `/` or an internal `/` anchors the pattern to the repo root;
    // a bare pattern without internal `/` matches at any directory boundary.
    const rootAnchored = leadingSlash || line.includes("/");
    const body = globBodyToRegex(line);
    if (body === null) continue;
    const prefix = rootAnchored ? "^" : "(?:^|/)";
    const suffix = dirOnly ? "/.+$" : "(?:$|/.+$)";
    try {
      rules.push({ negated, regex: new RegExp(`${prefix}${body}${suffix}`, "i") });
    } catch {
      /* ignore malformed regex */
    }
  }
  return rules;
}

function globBodyToRegex(pattern: string): string | null {
  let source = "";
  let index = 0;
  while (index < pattern.length) {
    const ch = pattern[index]!;
    if (ch === "*") {
      if (pattern[index + 1] === "*") {
        index += 2;
        if (pattern[index] === "/") {
          source += "(?:.+/)?";
          index += 1;
        } else {
          source += ".*";
        }
        continue;
      }
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (ch === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }
  return source;
}

export function isIgnoredByRules(relPath: string, rules: readonly IgnoreRule[]): boolean {
  const clean = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  let ignored = false;
  for (const rule of rules) {
    if (rule.regex.test(clean)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

async function readRootGitignore(repoDir: string): Promise<IgnoreRule[]> {
  try {
    return parseGitignore(await readFile(path.join(repoDir, ".gitignore"), "utf8"));
  } catch {
    return [];
  }
}

export interface WalkedFile {
  absPath: string;
  relPath: string;
}

async function tryWalkViaGitLsFiles(repoDir: string): Promise<WalkedFile[] | null> {
  if (!existsSync(path.join(repoDir, ".git"))) return null;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoDir, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { maxBuffer: 32 * 1024 * 1024, timeout: 10_000, windowsHide: true },
    );
    const seen = new Set<string>();
    const files: WalkedFile[] = [];
    for (const raw of stdout.split("\0")) {
      if (raw.length === 0) continue;
      const relPath = raw.replace(/\\/g, "/");
      if (seen.has(relPath)) continue;
      const segments = relPath.split("/");
      if (segments.some((seg) => shouldSkipDir(seg))) continue;
      const absPath = path.join(repoDir, ...segments);
      if (!existsSync(absPath)) continue;
      seen.add(relPath);
      files.push({ absPath, relPath });
    }
    files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
    return files;
  } catch {
    return null;
  }
}

export async function walkSourceFiles(repoDir: string): Promise<WalkedFile[]> {
  const fromGit = await tryWalkViaGitLsFiles(repoDir);
  if (fromGit !== null) return fromGit;

  const files: WalkedFile[] = [];
  const ignoreRules = await readRootGitignore(repoDir);
  const visit = async (dir: string, prefix: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (shouldSkipDir(entry.name)) continue;
      const absPath = path.join(dir, entry.name);
      const relPath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (ignoreRules.length > 0 && isIgnoredByRules(`${relPath}/_`, ignoreRules)) {
          // Wait: a negated rule inside an ignored dir (e.g. `!gen/keep.ts`) may un-ignore a child,
          // so only skip descending when no negated rules exist.
          const hasNegations = ignoreRules.some((r) => r.negated);
          if (!hasNegations) continue;
        }
        await visit(absPath, relPath);
      } else if (entry.isFile()) {
        if (ignoreRules.length > 0 && isIgnoredByRules(relPath, ignoreRules)) continue;
        files.push({ absPath, relPath });
      }
    }
  };
  await visit(repoDir, "");
  files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return files;
}

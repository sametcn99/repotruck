import { existsSync } from "node:fs";
import path from "node:path";
import type { SimpleGit } from "simple-git";

export interface FileDiffStat {
  added: number | null;
  removed: number | null;
  path: string;
}

export interface OutgoingCommit {
  hash: string;
  subject: string;
  stats?: FileDiffStat[];
}

export interface GitConflictState {
  inRebase: boolean;
  inMerge: boolean;
  inCherryPick: boolean;
  conflictedFiles: string[];
}

export interface CommitSignatureInfo {
  configured: boolean;
  signingKey: string | null;
  lastCommitStatus:
    | "valid"
    | "bad"
    | "untrusted"
    | "expired"
    | "revoked"
    | "missing_key"
    | "unsigned"
    | "unknown";
  signer: string | null;
  keyId: string | null;
  rawStatus: string;
}

export interface DetailedGitStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isClean: boolean;
  modifiedFiles: FileDiffStat[];
  untrackedFiles: string[];
  outgoingCommits: OutgoingCommit[];
  conflicts?: GitConflictState;
  signature?: CommitSignatureInfo;
}

export function parsePorcelainV2(porcelainV2Output: string): {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  modifiedPaths: string[];
  untrackedPaths: string[];
} {
  let branch = "";
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const modifiedPaths: string[] = [];
  const untrackedPaths: string[] = [];

  const lines = porcelainV2Output.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length).trim();
    } else if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length).trim();
    } else if (line.startsWith("# branch.ab ")) {
      const ab = line.slice("# branch.ab ".length).trim();
      const parts = ab.split(/\s+/);
      for (const p of parts) {
        if (p.startsWith("+")) ahead = Number.parseInt(p.slice(1), 10) || 0;
        if (p.startsWith("-")) behind = Number.parseInt(p.slice(1), 10) || 0;
      }
    } else if (line.startsWith("? ")) {
      untrackedPaths.push(line.slice(2).trim());
    } else if (line.startsWith("1 ") || line.startsWith("2 ") || line.startsWith("u ")) {
      const tokens = line.split(" ");
      const filePath = tokens[tokens.length - 1];
      if (filePath) modifiedPaths.push(filePath);
    }
  }

  return { branch, upstream, ahead, behind, modifiedPaths, untrackedPaths };
}

export function parseNumstat(numstatOutput: string): FileDiffStat[] {
  const stats: FileDiffStat[] = [];
  const lines = numstatOutput.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(/\t+/);
    if (parts.length >= 3) {
      const addPart = parts[0] ?? "0";
      const remPart = parts[1] ?? "0";
      const added = addPart === "-" ? null : Number.parseInt(addPart, 10) || 0;
      const removed = remPart === "-" ? null : Number.parseInt(remPart, 10) || 0;
      const filePath = parts.slice(2).join("\t").trim();
      stats.push({ added, removed, path: filePath });
    }
  }
  return stats;
}

export function formatDiffBar(
  added: number | null,
  removed: number | null,
  maxTotal: number,
  maxBarWidth = 20,
): string {
  if (added === null || removed === null) {
    return "[binary]";
  }
  const total = added + removed;
  if (total === 0 || maxTotal === 0) return "";
  const barLen = Math.max(1, Math.min(maxBarWidth, Math.round((total / maxTotal) * maxBarWidth)));
  const addChars = Math.round((added / total) * barLen);
  const removeChars = barLen - addChars;
  return `${"\u2588".repeat(addChars)}${"\u2591".repeat(removeChars)}`;
}

export async function inspectGitConflictState(git: SimpleGit): Promise<GitConflictState> {
  let inRebase = false;
  let inMerge = false;
  let inCherryPick = false;
  let conflictedFiles: string[] = [];

  try {
    const gitDirRaw = await git.revparse(["--git-dir"]);
    const gitDir = path.resolve(gitDirRaw.trim());
    inRebase =
      existsSync(path.join(gitDir, "rebase-merge")) ||
      existsSync(path.join(gitDir, "rebase-apply"));
    inMerge = existsSync(path.join(gitDir, "MERGE_HEAD"));
    inCherryPick = existsSync(path.join(gitDir, "CHERRY_PICK_HEAD"));
  } catch {
    // Ignore git dir resolution error
  }

  try {
    const unmerged = await git.raw(["diff", "--name-only", "--diff-filter=U"]);
    conflictedFiles = unmerged
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } catch {
    conflictedFiles = [];
  }

  return { inRebase, inMerge, inCherryPick, conflictedFiles };
}

export async function inspectCommitSignature(git: SimpleGit): Promise<CommitSignatureInfo> {
  let configured = false;
  let signingKey: string | null = null;
  try {
    const gpgSign = await git.raw(["config", "--get", "commit.gpgsign"]);
    configured = gpgSign.trim().toLowerCase() === "true";
  } catch {
    configured = false;
  }

  try {
    const key = await git.raw(["config", "--get", "user.signingkey"]);
    signingKey = key.trim() || null;
  } catch {
    signingKey = null;
  }

  let rawStatus = "N";
  let keyId: string | null = null;
  let signer: string | null = null;

  try {
    const log = await git.raw(["log", "-1", "--pretty=format:%G?|%GK|%GS"]);
    const [statusPart, keyPart, signerPart] = log.split("|");
    rawStatus = statusPart?.trim() || "N";
    keyId = keyPart?.trim() || null;
    signer = signerPart?.trim() || null;
  } catch {
    rawStatus = "N";
  }

  let lastCommitStatus: CommitSignatureInfo["lastCommitStatus"] = "unknown";
  switch (rawStatus) {
    case "G":
      lastCommitStatus = "valid";
      break;
    case "B":
      lastCommitStatus = "bad";
      break;
    case "U":
      lastCommitStatus = "untrusted";
      break;
    case "X":
    case "Y":
      lastCommitStatus = "expired";
      break;
    case "R":
      lastCommitStatus = "revoked";
      break;
    case "E":
      lastCommitStatus = "missing_key";
      break;
    case "N":
      lastCommitStatus = "unsigned";
      break;
    default:
      lastCommitStatus = "unknown";
  }

  return {
    configured,
    signingKey,
    lastCommitStatus,
    signer,
    keyId,
    rawStatus,
  };
}

export async function collectDetailedGitStatus(git: SimpleGit): Promise<DetailedGitStatus> {
  let porcelain = "";
  try {
    porcelain = await git.raw(["status", "--porcelain=v2", "--branch", "--untracked-files=normal"]);
  } catch {
    porcelain = "";
  }

  const parsed = parsePorcelainV2(porcelain);

  let numstat = "";
  try {
    numstat = await git.raw(["diff", "HEAD", "--numstat"]);
  } catch {
    numstat = "";
  }
  const modifiedFiles = parseNumstat(numstat);

  const outgoingCommits: OutgoingCommit[] = [];
  if (parsed.upstream && parsed.ahead > 0) {
    try {
      const logRaw = await git.raw([
        "log",
        "--reverse",
        "--numstat",
        "--format=__COMMIT__%h %s",
        `${parsed.upstream}..HEAD`,
      ]);
      const lines = logRaw.split(/\r?\n/);
      let currentCommit: OutgoingCommit | null = null;
      for (const line of lines) {
        if (line.startsWith("__COMMIT__")) {
          const firstSpace = line.indexOf(" ", "__COMMIT__".length);
          const hash =
            firstSpace >= 0
              ? line.slice("__COMMIT__".length, firstSpace)
              : line.slice("__COMMIT__".length);
          const subject = firstSpace >= 0 ? line.slice(firstSpace + 1) : "";
          currentCommit = { hash, subject, stats: [] };
          outgoingCommits.push(currentCommit);
        } else if (currentCommit && line.includes("\t")) {
          const parts = line.split(/\t+/);
          if (parts.length >= 3) {
            const addPart = parts[0] ?? "0";
            const remPart = parts[1] ?? "0";
            currentCommit.stats?.push({
              added: addPart === "-" ? null : Number.parseInt(addPart, 10) || 0,
              removed: remPart === "-" ? null : Number.parseInt(remPart, 10) || 0,
              path: parts.slice(2).join("\t").trim(),
            });
          }
        }
      }
    } catch {
      // ignore git log failure if upstream cannot be reached
    }
  }

  const conflicts = await inspectGitConflictState(git);
  const signature = await inspectCommitSignature(git);

  const isClean =
    parsed.modifiedPaths.length === 0 &&
    parsed.untrackedPaths.length === 0 &&
    conflicts.conflictedFiles.length === 0;

  return {
    branch: parsed.branch,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    isClean,
    modifiedFiles,
    untrackedFiles: parsed.untrackedPaths,
    outgoingCommits,
    conflicts,
    signature,
  };
}

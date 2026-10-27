import path from "node:path";
import { simpleGit } from "simple-git";
import type { RepotruckConfig } from "./config.ts";

export interface ChangelogCommit {
  hash: string;
  date: string;
  author: string;
  message: string;
  category: "feat" | "fix" | "docs" | "refactor" | "chore" | "other";
}

export interface RepoChangelog {
  repoKey: string;
  relativePath: string;
  commits: ChangelogCommit[];
}

export interface GenerateChangelogOptions {
  since?: string;
  until?: string;
  author?: string;
  repoRef?: string;
}

export function categorizeCommitMessage(message: string): ChangelogCommit["category"] {
  const lower = message.trim().toLowerCase();
  if (/^feat(\(.*\))?:/.test(lower)) return "feat";
  if (/^fix(\(.*\))?:/.test(lower)) return "fix";
  if (/^docs(\(.*\))?:/.test(lower)) return "docs";
  if (/^refactor(\(.*\))?:/.test(lower)) return "refactor";
  if (/^chore(\(.*\))?:/.test(lower)) return "chore";
  return "other";
}

export function parseGitLogLines(raw: string): ChangelogCommit[] {
  const commits: ChangelogCommit[] = [];
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    const parts = line.split("|||");
    if (parts.length >= 4) {
      const hash = parts[0]?.trim() ?? "";
      const date = parts[1]?.trim() ?? "";
      const author = parts[2]?.trim() ?? "";
      const message = parts.slice(3).join("|||").trim();
      if (hash && message) {
        commits.push({
          hash: hash.slice(0, 8),
          date,
          author,
          message,
          category: categorizeCommitMessage(message),
        });
      }
    }
  }
  return commits;
}

/**
 * Gathers commits across workspace repositories matching criteria.
 */
export async function getWorkspaceChangelog(
  root: string,
  config: RepotruckConfig,
  options: GenerateChangelogOptions = {},
): Promise<RepoChangelog[]> {
  const since = options.since ?? "7 days ago";
  const results: RepoChangelog[] = [];

  const reposToScan = options.repoRef
    ? config.repos.filter(
        (r) =>
          r.relativePath === options.repoRef ||
          `${r.owner}/${r.name}`.toLowerCase() === options.repoRef?.toLowerCase(),
      )
    : config.repos;

  for (const entry of reposToScan) {
    const repoDir = path.join(root, ...entry.relativePath.split("/"));
    const git = simpleGit(repoDir);
    try {
      const args = [
        "log",
        `--since=${since}`,
        "--pretty=format:%h|||%ad|||%an|||%s",
        "--date=short",
      ];
      if (options.until) {
        args.push(`--until=${options.until}`);
      }
      if (options.author) {
        args.push(`--author=${options.author}`);
      }
      const raw = await git.raw(args);
      const commits = parseGitLogLines(raw);
      if (commits.length > 0) {
        results.push({
          repoKey: `${entry.owner}/${entry.name}`,
          relativePath: entry.relativePath,
          commits,
        });
      }
    } catch {
      // Uncloned or non-git repo, skip silently
    }
  }

  return results;
}

/**
 * Formats a cross-repo changelog as a clean Markdown report.
 */
export function formatChangelogMarkdown(changelogs: RepoChangelog[], since: string): string {
  if (changelogs.length === 0) {
    return `# Workspace Changelog (since ${since})\n\nNo commits found.\n`;
  }

  const lines: string[] = [`# Workspace Changelog (since ${since})\n`];

  for (const cl of changelogs) {
    lines.push(`## ${cl.repoKey} (${cl.relativePath})`);

    const feats = cl.commits.filter((c) => c.category === "feat");
    const fixes = cl.commits.filter((c) => c.category === "fix");
    const others = cl.commits.filter((c) => c.category !== "feat" && c.category !== "fix");

    if (feats.length > 0) {
      lines.push("\n### Features");
      for (const c of feats) {
        lines.push(`- **${c.hash}** ${c.message} _(${c.author}, ${c.date})_`);
      }
    }

    if (fixes.length > 0) {
      lines.push("\n### Bug Fixes");
      for (const c of fixes) {
        lines.push(`- **${c.hash}** ${c.message} _(${c.author}, ${c.date})_`);
      }
    }

    if (others.length > 0) {
      lines.push("\n### Other Changes");
      for (const c of others) {
        lines.push(`- **${c.hash}** ${c.message} _(${c.author}, ${c.date})_`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

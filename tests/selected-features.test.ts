import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { formatChangelogMarkdown, type RepoChangelog } from "../src/services/changelog.ts";
import {
  isRepoInventoryEntry,
  isRepotruckConfig,
  type RepotruckConfig,
} from "../src/services/config.ts";
import { runDoctor } from "../src/services/doctor.ts";
import { inspectCommitSignature } from "../src/services/gitState.ts";
import { computeWorkspaceHealthScore } from "../src/services/healthScore.ts";
import {
  exportInstructionsFile,
  formatInstructions,
  isInstructionFormat,
} from "../src/services/instructionExport.ts";
import { getConflictResolutionGuide } from "../src/services/syncResolver.ts";
import {
  createRepoWorktree,
  listRepoWorktrees,
  parseWorktreeListPorcelain,
  removeRepoWorktree,
} from "../src/services/worktree.ts";

const tempRoots: string[] = [];

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("Feature 1: Worktree Manager", () => {
  test("parseWorktreeListPorcelain parses porcelain output accurately", () => {
    const raw = `worktree /path/to/main
HEAD 0123456789abcdef0123456789abcdef01234567
branch refs/heads/main

worktree /path/to/feat
HEAD fedcba9876543210fedcba9876543210fedcba98
branch refs/heads/feature-x
locked reason for lock

worktree /path/to/detached
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
detached
`;
    const parsed = parseWorktreeListPorcelain(raw);
    expect(parsed.length).toBe(3);

    expect(parsed[0]?.path).toBe(path.normalize("/path/to/main"));
    expect(parsed[0]?.isMain).toBe(true);
    expect(parsed[0]?.branch).toBe("main");
    expect(parsed[0]?.locked).toBe(false);

    expect(parsed[1]?.path).toBe(path.normalize("/path/to/feat"));
    expect(parsed[1]?.isMain).toBe(false);
    expect(parsed[1]?.branch).toBe("feature-x");
    expect(parsed[1]?.locked).toBe(true);

    expect(parsed[2]?.path).toBe(path.normalize("/path/to/detached"));
    expect(parsed[2]?.isMain).toBe(false);
    expect(parsed[2]?.branch).toBeNull();
  });

  test("create and remove worktree lifecycle with real git repo", async () => {
    const repoDir = makeTemp("rt-test-wt-repo-");
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig("user.name", "Tester");
    await git.addConfig("user.email", "tester@example.com");
    writeFileSync(path.join(repoDir, "README.md"), "# Test Repo\n", "utf8");
    await git.add("README.md");
    await git.commit("Initial commit");

    const wtPath = path.join(makeTemp("rt-test-wt-dir-"), "feature-wt");
    const createRes = await createRepoWorktree(repoDir, "feat-test", wtPath, { newBranch: true });
    expect(createRes.ok).toBe(true);
    expect(existsSync(wtPath)).toBe(true);

    const trees = await listRepoWorktrees(repoDir);
    expect(trees.length).toBe(2);
    expect(trees.some((t) => t.path === path.resolve(wtPath))).toBe(true);

    const removeRes = await removeRepoWorktree(repoDir, wtPath, true);
    expect(removeRes.ok).toBe(true);

    const treesAfter = await listRepoWorktrees(repoDir);
    expect(treesAfter.length).toBe(1);
    expect(treesAfter[0]?.isMain).toBe(true);
  });
});

describe("Feature 2: Advanced Sync & Rebase Resolution Guide", () => {
  test("getConflictResolutionGuide returns clean state for unconflicted repo", async () => {
    const repoDir = makeTemp("rt-test-sync-guide-");
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig("user.name", "Tester");
    await git.addConfig("user.email", "tester@example.com");
    writeFileSync(path.join(repoDir, "file.txt"), "hello", "utf8");
    await git.add("file.txt");
    await git.commit("init");

    const guide = await getConflictResolutionGuide(repoDir);
    expect(guide.hasConflicts).toBe(false);
    expect(guide.suggestedSteps.length).toBe(0);
    expect(guide.statusDescription).toContain("Working tree is clean");
  });
});

describe("Feature 3: Multi-Export AGENTS.md / CursorRules", () => {
  test("isInstructionFormat validates supported targets", () => {
    expect(isInstructionFormat("cursor")).toBe(true);
    expect(isInstructionFormat("claude")).toBe(true);
    expect(isInstructionFormat("copilot")).toBe(true);
    expect(isInstructionFormat("agents")).toBe(true);
    expect(isInstructionFormat("unknown")).toBe(false);
  });

  test("formatInstructions formats customized instructions for Cursor, Claude, Copilot", () => {
    const input = {
      preset: "categorized" as const,
      lastSync: "2026-10-28T00:00:00.000Z",
      repos: [
        {
          owner: "sametcn99",
          name: "repotruck",
          category: "tools" as const,
          relativePath: "tools/repotruck",
          internal: true,
          language: "TypeScript",
          updatedAt: null,
        },
      ],
      aliases: { rt: "sametcn99/repotruck" },
      pinned: ["sametcn99/repotruck"],
    };

    const cursorDoc = formatInstructions(input, "cursor");
    expect(cursorDoc).toContain("# Cursor Rules — Multi-Repo Workspace");
    expect(cursorDoc).toContain("tools/repotruck");

    const claudeDoc = formatInstructions(input, "claude");
    expect(claudeDoc).toContain("# Claude Code Workspace Configuration");
    expect(claudeDoc).toContain("sametcn99/repotruck");

    const copilotDoc = formatInstructions(input, "copilot");
    expect(copilotDoc).toContain("# GitHub Copilot Workspace Instructions");
    expect(copilotDoc).toContain("Active Focus (Pinned)");
  });

  test("exportInstructionsFile writes file atomically to root", async () => {
    const root = makeTemp("rt-export-inst-");
    const input = {
      preset: "categorized" as const,
      lastSync: null,
      repos: [],
      aliases: {},
    };

    const res = await exportInstructionsFile(root, input, "cursor");
    expect(res.format).toBe("cursor");
    expect(res.targetPath).toBe(path.join(root, ".cursorrules"));
    expect(existsSync(res.targetPath)).toBe(true);
    const content = readFileSync(res.targetPath, "utf8");
    expect(content).toContain("# Cursor Rules — Multi-Repo Workspace");
  });
});

describe("Feature 4: Cross-Repo Changelog", () => {
  test("formatChangelogMarkdown classifies commits into conventional groups", () => {
    const changelog: RepoChangelog[] = [
      {
        repoKey: "repotruck",
        relativePath: "sametcn99/repotruck",
        commits: [
          {
            hash: "abc1234",
            author: "Alice",
            date: "2026-10-28",
            message: "feat(worktree): add interactive worktree modal",
            category: "feat",
          },
          {
            hash: "def5678",
            author: "Bob",
            date: "2026-10-28",
            message: "fix(sync): resolve edge case in divergence rebase",
            category: "fix",
          },
          {
            hash: "789abcd",
            author: "Charlie",
            date: "2026-10-28",
            message: "docs: update command reference table",
            category: "docs",
          },
        ],
      },
    ];

    const md = formatChangelogMarkdown(changelog, "7 days ago");
    expect(md).toContain("# Workspace Changelog");
    expect(md).toContain("### Features");
    expect(md).toContain("add interactive worktree modal");
    expect(md).toContain("### Bug Fixes");
    expect(md).toContain("resolve edge case in divergence rebase");
    expect(md).toContain("### Other Changes");
  });
});

describe("Feature 5: Workspace Health Scoreboard", () => {
  test("computeWorkspaceHealthScore generates grades and actionable advice", async () => {
    const config: RepotruckConfig = {
      version: 1,
      root: "/tmp/ws",
      preset: "categorized",
      lastSync: null,
      repos: [
        {
          owner: "acme",
          name: "lib",
          relativePath: "acme/lib",
          category: "source",
          internal: true,
          language: "TypeScript",
          updatedAt: null,
        },
      ],
      pinned: ["acme/lib"],
    };

    const score = await computeWorkspaceHealthScore(
      "/tmp/ws",
      config,
      { ok: true, checks: [] },
      { dirtyCount: 0, aheadCount: 0, behindCount: 0 },
    );

    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(typeof score.grade).toBe("string");
    expect(score.breakdown.cleanliness).toBeDefined();
    expect(score.breakdown.synchronization).toBeDefined();
    expect(score.breakdown.focus).toBeDefined();
    expect(score.breakdown.hygiene).toBeDefined();
    expect(score.breakdown.doctor).toBeDefined();
  });
});

describe("Feature 6: Commit Verification & Doctor Signing Check", () => {
  test("inspectCommitSignature parses real git unsigned commit", async () => {
    const repoDir = makeTemp("rt-test-sig-repo-");
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig("user.name", "Tester");
    await git.addConfig("user.email", "tester@example.com");
    writeFileSync(path.join(repoDir, "a.txt"), "hello", "utf8");
    await git.add("a.txt");
    await git.commit("unsigned commit");

    const sig = await inspectCommitSignature(git);
    expect(sig.lastCommitStatus).toBe("unsigned");
    expect(sig.configured).toBe(false);
  });

  test("runDoctor includes signing check when requested", async () => {
    const result = await runDoctor({
      checkSigning: true,
      whichImpl: async (cmd: string) => `/usr/bin/${cmd}`,
      execImpl: async (cmd: string, args: string[]) => {
        if (args.includes("commit.gpgsign")) {
          return { stdout: "true\n" };
        }
        if (args.includes("user.signingkey")) {
          return { stdout: "3AA5C34371567BD2\n" };
        }
        return { stdout: `${cmd} version 2.40.0` };
      },
      probeAuthImpl: async () => ({ method: "env" }),
      readEntriesImpl: async () => [],
      existsSyncImpl: () => true,
    });

    const signingCheck = result.checks.find((c) => c.check === "signing");
    expect(signingCheck).toBeDefined();
    expect(signingCheck?.status).toBe("ok");
    expect(signingCheck?.detail).toContain("commit signing enabled");
  });
});

describe("Feature 7: Sparse & Monorepo Clone", () => {
  test("isRepotruckConfig allows sparse array in RepoInventoryEntry", () => {
    const raw: RepotruckConfig = {
      version: 1,
      root: "/tmp/workspace",
      preset: "flat",
      lastSync: null,
      repos: [
        {
          owner: "monalisa",
          name: "bigrepo",
          category: "source",
          relativePath: "bigrepo",
          internal: true,
          language: "TypeScript",
          updatedAt: null,
          sparse: ["packages/core", "apps/web"],
        },
      ],
    };

    expect(isRepotruckConfig(raw)).toBe(true);
    expect(isRepoInventoryEntry(raw.repos[0])).toBe(true);
    expect(raw.repos[0]?.sparse).toEqual(["packages/core", "apps/web"]);
  });
});

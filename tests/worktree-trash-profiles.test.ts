import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Octokit } from "@octokit/rest";
import { getWorkspaceStatus } from "../src/core/inspect.ts";
import {
  deleteWorkspaceProfile,
  getWorkspaceProfilesAndPinned,
  pinWorkspaceRepo,
  saveWorkspaceProfile,
  toggleWorkspacePin,
  unpinWorkspaceRepo,
} from "../src/core/profiles.ts";
import { searchCode } from "../src/services/codeSearch.ts";
import { walkSourceFiles } from "../src/services/codeSearchWalk.ts";
import type { RepotruckConfig } from "../src/services/config.ts";
import { runDoctor } from "../src/services/doctor.ts";
import {
  buildDiscoverQuery,
  deriveCiStateFromChecks,
  GitHubService,
} from "../src/services/github.ts";
import {
  deleteRepository,
  forgetRepository,
  workspaceTrashDir,
} from "../src/services/lifecycle.ts";
import {
  deleteProfile,
  isValidProfileName,
  listPinned,
  listProfiles,
  pinRepo,
  resolveProfileKeys,
  saveProfile,
  togglePinRepo,
  unpinRepo,
} from "../src/services/profiles.ts";
import { walkRepositoriesOnDisk } from "../src/services/stats.ts";
import {
  emptyTrash,
  listTrashEntries,
  parseTrashDirName,
  restoreTrashEntry,
} from "../src/services/trash.ts";
import { loadWorkspace, updateWorkspace } from "../src/services/workspace.ts";
import {
  findLinkedWorktrees,
  inspectGitDotEntry,
  isLinkedWorktree,
} from "../src/services/worktree.ts";

const pendingDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  pendingDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of pendingDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* ignore */
    }
  }
});

describe("worktree service & stats exclusion", () => {
  test("inspectGitDotEntry distinguishes real repos, linked worktrees, and plain folders", async () => {
    const root = makeTempDir("rt-wt-");
    const realRepo = path.join(root, "acme", "source", "api");
    const wtDir = path.join(root, "worktrees", "api-feat");
    const plainDir = path.join(root, "docs");

    mkdirSync(path.join(realRepo, ".git", "worktrees", "api-feat"), { recursive: true });
    writeFileSync(path.join(realRepo, "index.ts"), "export const x = 1;\n", "utf8");

    mkdirSync(wtDir, { recursive: true });
    writeFileSync(
      path.join(wtDir, ".git"),
      `gitdir: ${path.join(realRepo, ".git", "worktrees", "api-feat")}\n`,
      "utf8",
    );
    writeFileSync(path.join(wtDir, "big.bin"), "x".repeat(4096), "utf8");

    mkdirSync(plainDir, { recursive: true });

    expect(inspectGitDotEntry(realRepo)).toEqual({ kind: "repo" });
    expect(isLinkedWorktree(realRepo)).toBe(false);

    const wtInfo = inspectGitDotEntry(wtDir);
    expect(wtInfo.kind).toBe("worktree");
    expect(isLinkedWorktree(wtDir)).toBe(true);

    expect(inspectGitDotEntry(plainDir)).toEqual({ kind: "none" });

    const found = await findLinkedWorktrees(root);
    expect(found.length).toBe(1);
    expect(found[0]!.relativePath).toBe("worktrees/api-feat");
    expect(found[0]!.mainRepoDir).toBe(path.resolve(realRepo));

    // Verify stats excludes .repotruck and skips linked worktrees
    mkdirSync(path.join(root, ".repotruck", "trash", "old"), { recursive: true });
    writeFileSync(
      path.join(root, ".repotruck", "trash", "old", "huge.bin"),
      "z".repeat(8192),
      "utf8",
    );

    const disk = walkRepositoriesOnDisk(root);
    expect(disk.repoCount).toBe(1);
    expect(disk.totalSizeBytes).toBeLessThan(1024);
  });
});

describe("trash service & doctor trash warning", () => {
  test("soft-deletes to trash, parses hyphenated owner/name via .git/config, warns in doctor, restores, and empties", async () => {
    const root = makeTempDir("rt-trash-ws-");
    const cfgDir = makeTempDir("rt-trash-cfg-");
    const env = { REPOTRUCK_CONFIG_DIR: cfgDir };

    const repoDir = path.join(root, "my-org", "source", "my-cool-app");
    mkdirSync(path.join(repoDir, ".git"), { recursive: true });
    writeFileSync(
      path.join(repoDir, ".git", "config"),
      '[remote "origin"]\n\turl = https://github.com/my-org/my-cool-app.git\n',
      "utf8",
    );
    writeFileSync(path.join(repoDir, "README.md"), "# cool app\n", "utf8");

    const initial: RepotruckConfig = {
      version: 1,
      root,
      preset: "categorized",
      lastSync: null,
      repos: [
        {
          owner: "my-org",
          name: "my-cool-app",
          relativePath: "my-org/source/my-cool-app",
          category: "source",
          internal: true,
          language: "TypeScript",
          updatedAt: null,
        },
      ],
    };
    await updateWorkspace(root, () => ({ config: initial, result: undefined }), env);

    const delRes = await deleteRepository(
      root,
      await loadWorkspace(root, undefined, env),
      "my-org/my-cool-app",
      { yes: true, trash: true },
      env,
    );
    expect(delRes.ok).toBe(true);
    expect(existsSync(repoDir)).toBe(false);

    const entries = listTrashEntries(root);
    expect(entries.length).toBe(1);
    expect(entries[0]!.owner).toBe("my-org");
    expect(entries[0]!.name).toBe("my-cool-app");
    expect(entries[0]!.sizeBytes).toBeGreaterThan(0);

    // Doctor emits warn check when trash is non-empty
    const docRes = await runDoctor({
      env: { ...env, REPOTRUCK_TOKEN: "tok" },
      whichImpl: async () => "/usr/bin/git",
      execImpl: async () => ({ stdout: "git version 2.40.0" }),
      tuiRuntimeImpl: () => null,
    });
    const trashCheck = docRes.checks.find((c) => c.check === "trash");
    expect(trashCheck).toBeDefined();
    expect(trashCheck!.status).toBe("warn");

    // Restore back into workspace
    const restored = await restoreTrashEntry(root, "my-org/my-cool-app", { env });
    expect(restored.ok).toBe(true);
    expect(existsSync(repoDir)).toBe(true);
    expect(listTrashEntries(root).length).toBe(0);

    const afterRestoreCfg = await loadWorkspace(root, undefined, env);
    expect(
      afterRestoreCfg.repos.some((r) => r.owner === "my-org" && r.name === "my-cool-app"),
    ).toBe(true);

    // Fallback parseTrashDirName without .git/config and emptyTrash --older-than
    const parsedFallback = parseTrashDirName("acme-cli-1700000000000");
    expect(parsedFallback.owner).toBe("acme");
    expect(parsedFallback.name).toBe("cli");

    const trashRoot = workspaceTrashDir(root);
    const oldDir = path.join(trashRoot, "acme-old-1000000000000");
    const recentNow = 2_000_000_000_000;
    const recentDir = path.join(trashRoot, `acme-new-${recentNow - 1000}`);
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(recentDir, { recursive: true });
    writeFileSync(path.join(oldDir, "a.txt"), "old", "utf8");
    writeFileSync(path.join(recentDir, "b.txt"), "new", "utf8");

    const partialEmpty = emptyTrash(root, { olderThanDays: 7, now: recentNow });
    expect(partialEmpty.removed.length).toBe(1);
    expect(partialEmpty.kept.length).toBe(1);

    const fullEmpty = emptyTrash(root);
    expect(fullEmpty.removed.length).toBe(1);
    expect(listTrashEntries(root).length).toBe(0);
  });
});

describe("profiles, pinning, AGENTS.md sections, and lifecycle cleanup", () => {
  test("manages pinned repos and named profiles end-to-end and updates AGENTS.md", async () => {
    const root = makeTempDir("rt-prof-ws-");
    const cfgDir = makeTempDir("rt-prof-cfg-");
    const env = { REPOTRUCK_CONFIG_DIR: cfgDir };

    for (const rel of ["acme/source/api", "acme/source/web"]) {
      mkdirSync(path.join(root, ...rel.split("/")), { recursive: true });
    }
    const wtDir = path.join(root, "worktrees", "api-hotfix");
    mkdirSync(wtDir, { recursive: true });
    writeFileSync(
      path.join(wtDir, ".git"),
      "gitdir: /tmp/parent/.git/worktrees/api-hotfix\n",
      "utf8",
    );

    const base: RepotruckConfig = {
      version: 1,
      root,
      preset: "categorized",
      lastSync: null,
      repos: [
        {
          owner: "acme",
          name: "api",
          relativePath: "acme/source/api",
          category: "source",
          internal: true,
          language: "TypeScript",
          updatedAt: null,
        },
        {
          owner: "acme",
          name: "web",
          relativePath: "acme/source/web",
          category: "source",
          internal: true,
          language: "TypeScript",
          updatedAt: null,
        },
      ],
    };
    await updateWorkspace(root, () => ({ config: base, result: undefined }), env);

    expect(isValidProfileName("backend-v1")).toBe(true);
    expect(isValidProfileName("-bad")).toBe(false);

    // Pure helpers
    const p1 = pinRepo(base, "acme/api");
    expect(p1.ok).toBe(true);
    expect(listPinned(p1.config)).toEqual(["acme/api"]);
    const toggled = togglePinRepo(p1.config, "acme/api");
    expect(toggled.pinned).toBe(false);
    const badUnpin = unpinRepo(toggled.config, "acme/api");
    expect(badUnpin.ok).toBe(false);

    const savedPure = saveProfile(base, "core", ["acme/api", "acme/web"]);
    expect(savedPure.ok).toBe(true);
    expect(listProfiles(savedPure.config)).toEqual([
      { name: "core", repos: ["acme/api", "acme/web"] },
    ]);
    expect(resolveProfileKeys(savedPure.config, "CORE")).toEqual(["acme/api", "acme/web"]);
    const delPure = deleteProfile(savedPure.config, "core");
    expect(delPure.ok).toBe(true);
    expect(resolveProfileKeys(delPure.config, "core")).toBeNull();

    // Atomic workspace core wrappers
    expect((await pinWorkspaceRepo(root, "acme/api", env)).ok).toBe(true);
    const toggleRes = await toggleWorkspacePin(root, "acme/web", env);
    expect(toggleRes.ok).toBe(true);
    if (toggleRes.ok) {
      expect(toggleRes.pinned).toBe(true);
    }
    expect((await saveWorkspaceProfile(root, "fullstack", ["acme/api", "acme/web"], env)).ok).toBe(
      true,
    );

    const agentsMd = readFileSync(path.join(root, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("## Active Focus (Pinned)");
    expect(agentsMd).toContain("`acme/api`");
    expect(agentsMd).toContain("## Linked Git Worktrees");
    expect(agentsMd).toContain("`worktrees/api-hotfix`");

    // Filtered workspace status
    const pinnedOnlyStatus = await getWorkspaceStatus(root, env, { pinned: true });
    expect(pinnedOnlyStatus.repos.map((r) => r.key).sort()).toEqual(["acme/api", "acme/web"]);

    expect((await unpinWorkspaceRepo(root, "acme/web", env)).ok).toBe(true);
    const profStatus = await getWorkspaceStatus(root, env, { profile: "fullstack" });
    expect(profStatus.repos.length).toBe(2);

    // Forgetting a repo cleans pinned & profiles
    await forgetRepository(root, await loadWorkspace(root, undefined, env), "acme/api", env);
    const afterForget = await getWorkspaceProfilesAndPinned(root, env);
    expect(afterForget.pinned).toEqual([]);
    expect(afterForget.profiles[0]!.repos).toEqual(["acme/web"]);

    expect((await deleteWorkspaceProfile(root, "fullstack", env)).ok).toBe(true);
  });
});

describe("GitHub discover query, CI rollup, and remote health", () => {
  test("buildDiscoverQuery constructs GitHub search qualifiers cleanly", () => {
    const q = buildDiscoverQuery("mcp server", {
      org: "acme",
      lang: "typescript",
      minStars: 50,
      topics: ["ai", "cli"],
    });
    expect(q).toBe(
      "mcp server org:acme language:typescript stars:>=50 topic:ai topic:cli archived:false fork:false",
    );

    const inclusive = buildDiscoverQuery("router", {
      includeArchived: true,
      includeForks: true,
    });
    expect(inclusive).toBe("router");
  });

  test("deriveCiStateFromChecks prioritizes failure > pending > success > none", () => {
    expect(deriveCiStateFromChecks([], null)).toBe("none");
    expect(deriveCiStateFromChecks([{ status: "completed", conclusion: "success" }], null)).toBe(
      "success",
    );
    expect(
      deriveCiStateFromChecks(
        [
          { status: "completed", conclusion: "success" },
          { status: "in_progress", conclusion: null },
        ],
        null,
      ),
    ).toBe("pending");
    expect(
      deriveCiStateFromChecks(
        [
          { status: "in_progress", conclusion: null },
          { status: "completed", conclusion: "failure" },
        ],
        null,
      ),
    ).toBe("failure");
    expect(deriveCiStateFromChecks([], "error")).toBe("failure");
    expect(deriveCiStateFromChecks([], "pending")).toBe("pending");
  });

  test("GitHubService.getRepoRemoteHealth aggregates PRs and check-runs", async () => {
    const octokit = {
      request: async (url: string) => {
        if (url === "GET /repos/{owner}/{repo}") {
          return { status: 200, data: { default_branch: "main" } };
        }
        if (url === "GET /repos/{owner}/{repo}/pulls") {
          return { status: 200, data: [{ id: 1 }, { id: 2 }] };
        }
        if (url === "GET /repos/{owner}/{repo}/commits/{ref}/check-runs") {
          return {
            status: 200,
            data: { check_runs: [{ status: "completed", conclusion: "success" }] },
          };
        }
        return { status: 200, data: { total_count: 0, state: "pending" } };
      },
    } as unknown as Octokit;
    const svc = new GitHubService("tok", { octokit });
    const health = await svc.getRepoRemoteHealth("acme", "api");
    expect(health).toEqual({
      defaultBranch: "main",
      openPrs: 2,
      ciState: "success",
    });
  });
});

describe("codeSearch --text mode and git ls-files discovery", () => {
  test("searches raw lines with --text, --regex, --lang, and git ls-files fast path", async () => {
    const root = makeTempDir("rt-text-search-");
    const repoDir = path.join(root, "acme", "source", "api");
    mkdirSync(path.join(repoDir, "src"), { recursive: true });
    writeFileSync(
      path.join(repoDir, "src", "handler.ts"),
      "export function run() {\n  // TODO: wire telemetry\n  return 42;\n}\n",
      "utf8",
    );
    writeFileSync(path.join(repoDir, "README.md"), "TODO: update docs\n", "utf8");

    // Initialize a real git repo to exercise the git ls-files fast path!
    execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore" });

    const walked = await walkSourceFiles(repoDir);
    expect(walked.map((w) => w.relPath).sort()).toEqual(["README.md", "src/handler.ts"]);

    const config: RepotruckConfig = {
      version: 1,
      root,
      preset: "categorized",
      lastSync: null,
      repos: [
        {
          owner: "acme",
          name: "api",
          relativePath: "acme/source/api",
          category: "source",
          internal: true,
          language: "TypeScript",
          updatedAt: null,
        },
      ],
    };

    const hits = await searchCode({
      root,
      config,
      pattern: "TODO:",
      text: true,
    });
    expect(hits.matches.length).toBe(2);
    expect(hits.matches.every((m) => m.kind === "text")).toBe(true);

    const tsOnly = await searchCode({
      root,
      config,
      pattern: "TODO:\\s+wire",
      text: true,
      regex: true,
      lang: "ts",
    });
    expect(tsOnly.matches.length).toBe(1);
    expect(tsOnly.matches[0]!.line).toBe(2);
    expect(tsOnly.matches[0]!.formatted).toContain("TODO: wire telemetry");
  });
});

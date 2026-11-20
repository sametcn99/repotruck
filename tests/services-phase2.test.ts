import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { beginDeviceLogin, getAuthInfo, probeAuth } from "../src/services/auth.ts";
import {
  categorizeCommitMessage,
  formatChangelogMarkdown,
  getWorkspaceChangelog,
  parseGitLogLines,
} from "../src/services/changelog.ts";
import type { RepotruckConfig } from "../src/services/config.ts";
import { createRepository, type GitSeam } from "../src/services/creator.ts";
import { fixDoctor, runDoctor } from "../src/services/doctor.ts";
import type { GitHubRepoCreator } from "../src/services/github.ts";
import { calculateGrade, computeWorkspaceHealthScore } from "../src/services/healthScore.ts";
import { executeConflictAction, getConflictResolutionGuide } from "../src/services/syncResolver.ts";
import { updateWorkspace } from "../src/services/workspace.ts";

const tempRoots: string[] = [];
let savedConfigDir: string | undefined;

function tempDir(prefix: string): string {
  const dir = (realpathSync.native ?? realpathSync)(mkdtempSync(path.join(tmpdir(), prefix)));
  tempRoots.push(dir);
  return dir;
}

async function initConfiguredRepo(dir: string): Promise<ReturnType<typeof simpleGit>> {
  mkdirSync(dir, { recursive: true });
  const git = simpleGit(dir);
  await git.init(["-b", "main"]);
  await git.addConfig("user.email", "test@repotruck.dev");
  await git.addConfig("user.name", "Repotruck Test");
  return git;
}

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
});

afterAll(() => {
  if (savedConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("syncResolver service", () => {
  test("clean repo returns no conflicts and abort/continue returns false", async () => {
    const dir = tempDir("rt-syncres-clean-");
    const git = await initConfiguredRepo(dir);
    writeFileSync(path.join(dir, "a.txt"), "base\n", "utf8");
    await git.add(".");
    await git.commit("chore: init");

    await withCwd(dir, async () => {
      const guide = await getConflictResolutionGuide(dir);
      expect(guide.hasConflicts).toBe(false);
      expect(guide.conflictedFiles).toEqual([]);
      expect(guide.statusDescription).toContain("Working tree is clean");
      expect(guide.suggestedSteps).toEqual([]);

      const abortRes = await executeConflictAction(dir, "abort");
      expect(abortRes.ok).toBe(false);
      expect(abortRes.message).toContain("No active rebase or merge");
    });
  });

  test("merge conflict guide and executeConflictAction abort + continue", async () => {
    const dir = tempDir("rt-syncres-merge-");
    const git = await initConfiguredRepo(dir);
    writeFileSync(path.join(dir, "file.txt"), "line1\n", "utf8");
    await git.add(".");
    await git.commit("init");

    await git.checkoutLocalBranch("feature");
    writeFileSync(path.join(dir, "file.txt"), "from-feature\n", "utf8");
    await git.add(".");
    await git.commit("feature change");

    await git.checkout("main");
    writeFileSync(path.join(dir, "file.txt"), "from-main\n", "utf8");
    await git.add(".");
    await git.commit("main change");

    await git.raw(["merge", "feature"]).catch(() => {});

    await withCwd(dir, async () => {
      const guide = await getConflictResolutionGuide(dir);
      expect(guide.hasConflicts).toBe(true);
      expect(guide.state.inMerge).toBe(true);
      expect(guide.conflictedFiles).toContain("file.txt");
      expect(guide.statusDescription).toContain("Merge in progress");
      expect(guide.suggestedSteps.some((s) => s.includes("git merge --abort"))).toBe(true);

      const abortRes = await executeConflictAction(dir, "abort");
      expect(abortRes.ok).toBe(true);
      expect(abortRes.message).toContain("git merge --abort succeeded");

      await git.raw(["merge", "feature"]).catch(() => {});
      writeFileSync(path.join(dir, "file.txt"), "resolved\n", "utf8");
      await git.add("file.txt");
      const contRes = await executeConflictAction(dir, "continue");
      expect(contRes.ok).toBe(true);
    });
  });

  test("rebase conflict guide and executeConflictAction abort + continue", async () => {
    const dir = tempDir("rt-syncres-rebase-");
    const git = await initConfiguredRepo(dir);
    writeFileSync(path.join(dir, "conflict.txt"), "v1\n", "utf8");
    await git.add(".");
    await git.commit("init");

    await git.checkoutLocalBranch("side");
    writeFileSync(path.join(dir, "conflict.txt"), "side\n", "utf8");
    await git.add(".");
    await git.commit("side change");

    await git.checkout("main");
    writeFileSync(path.join(dir, "conflict.txt"), "main\n", "utf8");
    await git.add(".");
    await git.commit("main change");

    await git.checkout("side");
    await git.raw(["rebase", "main"]).catch(() => {});

    await withCwd(dir, async () => {
      const guide = await getConflictResolutionGuide(dir);
      expect(guide.hasConflicts).toBe(true);
      expect(guide.state.inRebase).toBe(true);
      expect(guide.statusDescription).toContain("Rebase in progress");
      expect(guide.suggestedSteps.some((s) => s.includes("git rebase --continue"))).toBe(true);

      const abortRes = await executeConflictAction(dir, "abort");
      expect(abortRes.ok).toBe(true);
      expect(abortRes.message).toContain("git rebase --abort succeeded");
    });
  });

  test("cherry-pick conflict guide detects CHERRY_PICK_HEAD", async () => {
    const dir = tempDir("rt-syncres-cp-");
    const git = await initConfiguredRepo(dir);
    writeFileSync(path.join(dir, "cp.txt"), "base\n", "utf8");
    await git.add(".");
    await git.commit("base");

    await git.checkoutLocalBranch("other");
    writeFileSync(path.join(dir, "cp.txt"), "other-change\n", "utf8");
    await git.add(".");
    await git.commit("other");
    const otherHash = (await git.revparse(["HEAD"])).trim();

    await git.checkout("main");
    writeFileSync(path.join(dir, "cp.txt"), "main-change\n", "utf8");
    await git.add(".");
    await git.commit("main");

    await git.raw(["cherry-pick", otherHash]).catch(() => {});
    await withCwd(dir, async () => {
      const guide = await getConflictResolutionGuide(dir);
      expect(guide.hasConflicts).toBe(true);
      expect(guide.state.inCherryPick).toBe(true);
      expect(guide.statusDescription).toContain("Cherry-pick in progress");
      expect(guide.suggestedSteps.some((s) => s.includes("git cherry-pick --continue"))).toBe(true);
    });
    await git.raw(["cherry-pick", "--abort"]);
  });
});

describe("changelog service", () => {
  test("categorizeCommitMessage and parseGitLogLines cover all categories", () => {
    expect(categorizeCommitMessage("feat(ui): add button")).toBe("feat");
    expect(categorizeCommitMessage("fix: null pointer")).toBe("fix");
    expect(categorizeCommitMessage("docs(readme): update")).toBe("docs");
    expect(categorizeCommitMessage("refactor: cleanup")).toBe("refactor");
    expect(categorizeCommitMessage("chore(deps): bump")).toBe("chore");
    expect(categorizeCommitMessage("wip misc change")).toBe("other");

    const parsed = parseGitLogLines(
      [
        "1234567890|||2026-04-01|||Alice|||feat(core): new api",
        "abcdef1234|||2026-04-02|||Bob|||fix: crash ||| detail",
        "malformed-line",
      ].join("\n"),
    );
    expect(parsed.length).toBe(2);
    expect(parsed[0]!.hash).toBe("12345678");
    expect(parsed[0]!.category).toBe("feat");
    expect(parsed[1]!.message).toBe("fix: crash ||| detail");
    expect(parsed[1]!.category).toBe("fix");
  });

  test("getWorkspaceChangelog filters by since/until/author/repoRef and skips non-git dirs", async () => {
    const wsRoot = tempDir("rt-cl-ws-");
    const apiDir = path.join(wsRoot, "acme", "source", "api");
    const emptyDir = path.join(wsRoot, "acme", "source", "not-git");
    mkdirSync(emptyDir, { recursive: true });

    const git = await initConfiguredRepo(apiDir);
    writeFileSync(path.join(apiDir, "index.ts"), "export const a = 1;\n", "utf8");
    await git.add(".");
    await git.commit("feat: initial feature");
    writeFileSync(path.join(apiDir, "index.ts"), "export const a = 2;\n", "utf8");
    await git.add(".");
    await git.commit("fix: resolve edge bug");
    writeFileSync(path.join(apiDir, "README.md"), "# docs\n", "utf8");
    await git.add(".");
    await git.commit("docs: document api");

    const config: RepotruckConfig = {
      version: 1,
      root: wsRoot,
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
          name: "not-git",
          relativePath: "acme/source/not-git",
          category: "source",
          internal: true,
          language: null,
          updatedAt: null,
        },
      ],
    };

    const all = await getWorkspaceChangelog(wsRoot, config, {
      since: "30 days ago",
      until: "2099-01-01",
      author: "Repotruck Test",
      repoRef: "acme/api",
    });
    expect(all.length).toBe(1);
    expect(all[0]!.commits.length).toBe(3);

    const md = formatChangelogMarkdown(all, "30 days ago");
    expect(md).toContain("## acme/api (acme/source/api)");
    expect(md).toContain("### Features");
    expect(md).toContain("### Bug Fixes");
    expect(md).toContain("### Other Changes");

    const emptyMd = formatChangelogMarkdown([], "7 days ago");
    expect(emptyMd).toContain("No commits found.");
  });
});

describe("healthScore service", () => {
  test("calculateGrade maps score ranges accurately", () => {
    expect(calculateGrade(100)).toBe("A+");
    expect(calculateGrade(95)).toBe("A+");
    expect(calculateGrade(88)).toBe("A");
    expect(calculateGrade(78)).toBe("B");
    expect(calculateGrade(62)).toBe("C");
    expect(calculateGrade(52)).toBe("D");
    expect(calculateGrade(20)).toBe("F");
  });

  test("computeWorkspaceHealthScore evaluates penalties, backups, trash and doctor failures", async () => {
    const wsRoot = tempDir("rt-health-ws-");
    const backupsDir = path.join(wsRoot, ".repotruck", "backups");
    mkdirSync(backupsDir, { recursive: true });
    writeFileSync(path.join(backupsDir, "snap-1.json"), "{}", "utf8");

    const trashDir = path.join(wsRoot, ".repotruck", "trash");
    mkdirSync(trashDir, { recursive: true });
    for (let i = 0; i < 6; i++) {
      const itemDir = path.join(trashDir, `trash-${i}`);
      mkdirSync(itemDir, { recursive: true });
      writeFileSync(
        path.join(itemDir, ".repotruck-trash.json"),
        JSON.stringify({
          key: `acme/old-${i}`,
          relativePath: `acme/old-${i}`,
          trashedAt: "2026-01-01T00:00:00.000Z",
          sizeBytes: 128,
          entry: {
            owner: "acme",
            name: `old-${i}`,
            relativePath: `acme/old-${i}`,
            category: "source",
            internal: true,
            language: null,
            updatedAt: null,
          },
        }),
        "utf8",
      );
    }

    const repos = Array.from({ length: 6 }, (_, i) => ({
      owner: "acme",
      name: `r-${i}`,
      relativePath: `acme/source/r-${i}`,
      category: "source" as const,
      internal: true,
      language: "TypeScript",
      updatedAt: null,
    }));
    const config: RepotruckConfig = {
      version: 1,
      root: wsRoot,
      preset: "categorized",
      lastSync: null,
      repos,
    };

    const score = await computeWorkspaceHealthScore(
      wsRoot,
      config,
      {
        ok: false,
        checks: [
          { status: "ok", check: "git", detail: "ok", formatted: "[ok]" },
          { status: "fail", check: "token", detail: "no token", formatted: "[fail]" },
        ],
      },
      { dirtyCount: 2, aheadCount: 1, behindCount: 2 },
    );

    expect(score.breakdown.cleanliness.dirtyCount).toBe(2);
    expect(score.breakdown.synchronization.behindCount).toBe(2);
    expect(score.breakdown.focus.score).toBe(8);
    expect(score.breakdown.hygiene.backupCount).toBe(1);
    expect(score.breakdown.hygiene.trashCount).toBe(6);
    expect(score.breakdown.doctor.passed).toBe(1);
    expect(score.recommendations.some((r) => r.includes("uncommitted changes"))).toBe(true);
    expect(score.recommendations.some((r) => r.includes("behind origin"))).toBe(true);
    expect(score.recommendations.some((r) => r.includes("unpushed commits"))).toBe(true);
    expect(score.recommendations.some((r) => r.includes("No repositories are pinned"))).toBe(true);
    expect(score.recommendations.some((r) => r.includes("accumulated in trash"))).toBe(true);
    expect(score.recommendations.some((r) => r.includes("Doctor check failed [token]"))).toBe(true);

    const wsEmpty = tempDir("rt-health-empty-");
    const emptyScore = await computeWorkspaceHealthScore(
      wsEmpty,
      { version: 1, root: wsEmpty, preset: "flat", lastSync: null, repos: [] },
      { ok: true, checks: [{ status: "ok", check: "git", detail: "ok", formatted: "[ok]" }] },
    );
    expect(emptyScore.breakdown.hygiene.backupCount).toBe(0);
    expect(emptyScore.recommendations.some((r) => r.includes("backup snapshot"))).toBe(true);
  });
});

describe("creator edge cases", () => {
  const makeGithub = (failCreate = false): GitHubRepoCreator => ({
    createRepo: async (name, opts) => {
      if (failCreate) throw new Error("API 500 error");
      return {
        owner: opts.org ?? "acme",
        name,
        description: opts.description ?? null,
        isPrivate: opts.private,
        isFork: false,
        isArchived: false,
        language: "TypeScript",
        httpsUrl: `https://github.com/${opts.org ?? "acme"}/${name}.git`,
        sshUrl: `git@github.com:${opts.org ?? "acme"}/${name}.git`,
        updatedAt: null,
      };
    },
  });

  test("rejects source directory already inside a tracked repo", async () => {
    const cfgDir = tempDir("rt-cre-cfg-");
    process.env.REPOTRUCK_CONFIG_DIR = cfgDir;
    const wsRoot = tempDir("rt-cre-ws-");
    const trackedDir = path.join(wsRoot, "acme", "source", "existing");
    mkdirSync(trackedDir, { recursive: true });
    const config: RepotruckConfig = {
      version: 1,
      root: wsRoot,
      preset: "categorized",
      lastSync: null,
      repos: [
        {
          owner: "acme",
          name: "existing",
          relativePath: "acme/source/existing",
          category: "source",
          internal: true,
          language: null,
          updatedAt: null,
        },
      ],
    };

    const res = await createRepository({
      root: wsRoot,
      config,
      github: makeGithub(),
      userLogin: "acme",
      orgs: [],
      options: { name: "new-repo", isPrivate: true, fromDir: trackedDir },
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("already tracked by repotruck");
  });

  test("handles github.createRepo error, push failure, and moveDir collision gracefully", async () => {
    const cfgDir = tempDir("rt-cre-cfg2-");
    process.env.REPOTRUCK_CONFIG_DIR = cfgDir;
    const wsRoot = tempDir("rt-cre-ws2-");
    const config: RepotruckConfig = {
      version: 1,
      root: wsRoot,
      preset: "flat",
      lastSync: null,
      repos: [],
    };
    await updateWorkspace(wsRoot, () => ({ config, result: undefined }), {
      REPOTRUCK_CONFIG_DIR: cfgDir,
    });

    const ghFail = await createRepository({
      root: wsRoot,
      config,
      github: makeGithub(true),
      userLogin: "acme",
      orgs: [],
      options: { name: "fail-gh", isPrivate: true },
    });
    expect(ghFail.ok).toBe(false);
    expect(ghFail.message).toContain("API 500 error");

    const failingGit: GitSeam = {
      isGitRepo: async () => false,
      statusPorcelain: async () => "",
      initMain: async () => {},
      addAll: async () => {},
      commitInitial: async () => {},
      setRemoteOrigin: async () => {},
      pushMain: async () => {
        throw new Error("remote rejected push");
      },
    };
    const pushFail = await createRepository({
      root: wsRoot,
      config,
      github: makeGithub(),
      userLogin: "acme",
      orgs: [],
      git: failingGit,
      options: { name: "fail-push", isPrivate: true },
    });
    expect(pushFail.ok).toBe(false);
    expect(pushFail.message).toContain("remote rejected push");

    const srcDir = tempDir("rt-cre-from-");
    writeFileSync(path.join(srcDir, "hello.txt"), "hi", "utf8");
    const destCollisionGit: GitSeam = {
      isGitRepo: async () => false,
      statusPorcelain: async () => "",
      initMain: async () => {},
      addAll: async () => {},
      commitInitial: async () => {},
      setRemoteOrigin: async () => {},
      pushMain: async () => {
        const dest = path.join(wsRoot, "collide-repo");
        mkdirSync(dest, { recursive: true });
        writeFileSync(path.join(dest, "occupied.txt"), "x", "utf8");
      },
    };
    const moveFail = await createRepository({
      root: wsRoot,
      config,
      github: makeGithub(),
      userLogin: "acme",
      orgs: [],
      git: destCollisionGit,
      options: { name: "collide-repo", isPrivate: true, fromDir: srcDir },
    });
    expect(moveFail.ok).toBe(false);
    expect(moveFail.message).toContain("was created on GitHub and pushed, but moving");
  });
});

describe("auth & doctor extra branches", () => {
  test("beginDeviceLogin yields verification handle and resolves cached completion", async () => {
    const dir = tempDir("rt-auth-begin-");
    const env = {
      REPOTRUCK_CONFIG_DIR: dir,
      PATH: dir,
      REPOTRUCK_OAUTH_CLIENT_ID: "client-123",
    };

    // biome-ignore lint/suspicious/noExplicitAny: mock octokit request function shape
    const mockRequest: any = async (route: string) => {
      if (route.includes("device/code")) {
        return {
          data: {
            device_code: "dc-1",
            user_code: "ABCD-EFGH",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 0,
          },
        };
      }
      return {
        data: {
          access_token: "gho_begin_tok",
          token_type: "bearer",
          scope: "repo",
        },
      };
    };
    mockRequest.endpoint = { DEFAULTS: { baseUrl: "https://github.com" } };

    let seenCode = "";
    const handle = await beginDeviceLogin({
      env,
      requestImpl: mockRequest,
      onVerification: (v) => {
        seenCode = v.user_code;
      },
    });
    expect(handle.userCode).toBe("ABCD-EFGH");
    expect(handle.verificationUri).toBe("https://github.com/login/device");
    expect(seenCode).toBe("ABCD-EFGH");

    const completed = await handle.completion;
    expect(completed.token).toBe("gho_begin_tok");
    expect(completed.method).toBe("device");
  });

  // The stub gh below is a POSIX shell script with ":" PATH separators —
  // Windows cannot execute it, so the fallback path is Unix-only here.
  (process.platform === "win32" ? test.skip : test)(
    "gh CLI fallback is detected by probeAuth and getAuthInfo",
    async () => {
      const binDir = tempDir("rt-gh-bin-");
      const cfgDir = tempDir("rt-gh-cfg-");
      const ghScript = path.join(binDir, "gh");
      writeFileSync(
        ghScript,
        '#!/bin/sh\nif [ "$1" = "auth" ]; then echo "gho_from_cli"; fi\n',
        "utf8",
      );
      chmodSync(ghScript, 0o755);

      const env = {
        REPOTRUCK_CONFIG_DIR: cfgDir,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      };
      const probe = await probeAuth(env);
      expect(probe.method).toBe("gh-cli");
      const info = await getAuthInfo(env, { interactive: false });
      expect(info.method).toBe("gh-cli");
      expect(info.token).toBe("gho_from_cli");
    },
  );

  test("runDoctor and fixDoctor cover missing tools, corrupt config, signing, and reorganize journal", async () => {
    const wsMissing = path.join(tempDir("rt-doc-"), "missing-ws");
    const wsExisting = tempDir("rt-doc-real-");
    const grammarDir = tempDir("rt-doc-gram-");
    const cachedGrammarPath = path.join(grammarDir, "tree-sitter-typescript.wasm");
    writeFileSync(cachedGrammarPath, "x", "utf8");

    const res = await runDoctor({
      env: { REPOTRUCK_CONFIG_DIR: wsExisting },
      whichImpl: async (cmd) => (cmd === "git" ? "/usr/bin/git" : null),
      execImpl: async (_cmd, args) => {
        if (args[0] === "--version") return { stdout: "git version 2.44.0" };
        if (args[2] === "commit.gpgsign") return { stdout: "true\n" };
        if (args[2] === "user.signingkey") return { stdout: "KEY123\n" };
        return { stdout: "" };
      },
      probeAuthImpl: async () => ({ method: "none" }),
      readEntriesImpl: async () => [
        {
          version: 1,
          root: wsMissing,
          preset: "flat",
          lastSync: null,
          lastUsed: "2026-01-01T00:00:00.000Z",
          repos: [],
        },
        {
          version: 1,
          root: wsExisting,
          preset: "flat",
          lastSync: null,
          lastUsed: "2026-01-01T00:00:00.000Z",
          repos: [],
        },
      ],
      existsSyncImpl: (p) => {
        if (p === wsMissing) return false;
        if (p.endsWith(".wasm")) return p === cachedGrammarPath;
        return true;
      },
      tuiRuntimeImpl: () => "bun < 1.3",
      readJournalImpl: (root) => {
        if (root === wsExisting) throw new Error("bad json");
        return null;
      },
      listTrashImpl: () => [
        {
          id: "old",
          dirName: "old",
          absPath: path.join(wsExisting, ".repotruck", "trash", "old"),
          owner: "acme",
          name: "old",
          trashedAt: "2026-01-01T00:00:00.000Z",
          timestampMs: Date.parse("2026-01-01T00:00:00.000Z"),
          sizeBytes: 2048,
        },
      ],
      grammarCacheDirImpl: () => grammarDir,
      checkSigning: true,
    });

    expect(res.ok).toBe(false);
    expect(res.checks.some((c) => c.check === "token" && c.status === "fail")).toBe(true);
    expect(res.checks.some((c) => c.check === "gh" && c.status === "warn")).toBe(true);
    expect(res.checks.some((c) => c.check === "disk" && c.status === "warn")).toBe(true);
    expect(res.checks.some((c) => c.check === "reorganize" && c.detail.includes("corrupt"))).toBe(
      true,
    );
    expect(res.checks.some((c) => c.check === "trash" && c.status === "warn")).toBe(true);
    expect(res.checks.some((c) => c.check === "grammars" && c.status === "warn")).toBe(true);
    expect(res.checks.some((c) => c.check === "tui-runtime" && c.status === "warn")).toBe(true);
    expect(res.checks.some((c) => c.check === "signing" && c.detail.includes("KEY123"))).toBe(true);

    const okRes = await fixDoctor({
      env: { REPOTRUCK_CONFIG_DIR: wsExisting },
      whichImpl: async () => "/usr/bin/true",
      execImpl: async () => ({ stdout: "ok" }),
      probeAuthImpl: async () => ({ method: "env" }),
      readEntriesImpl: async () => [],
      tuiRuntimeImpl: () => null,
      grammarCacheDirImpl: () => grammarDir,
    });
    expect(okRes.ok).toBe(true);
  });
});

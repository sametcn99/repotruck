import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { type CloneTarget, cloneOrUpdate } from "../src/services/cloner.ts";
import type { EnvLike } from "../src/services/config.ts";
import { defaultConfig } from "../src/services/config.ts";
import type { RepoInfo } from "../src/services/github.ts";
import { createProgressHub } from "../src/services/progressHub.ts";
import { syncRepos } from "../src/services/workspace.ts";

const tempDirs: string[] = [];
let configDir: string;
let configEnv: EnvLike;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function toFileUrl(absDir: string): string {
  const normalized = absDir.replace(/\\/g, "/");
  return `file:///${normalized}`;
}

interface RemoteFixture {
  remoteDir: string;
  fileUrl: string;
  source: ReturnType<typeof simpleGit>;
  commitOnRemote(message: string, file: string, content: string): Promise<void>;
}

async function makeRemote(prefix: string): Promise<RemoteFixture> {
  const remoteDir = tempDir(`${prefix}-remote-`);
  const sourceDir = tempDir(`${prefix}-source-`);
  const source = simpleGit(sourceDir);
  await source.init(["-b", "main"]);
  await source.addConfig("user.email", "repotruck-test@example.com");
  await source.addConfig("user.name", "repotruck test");
  writeFileSync(path.join(sourceDir, "hello.txt"), "v1\n", "utf8");
  await source.add(".");
  await source.commit("initial commit");
  const fileUrl = toFileUrl(remoteDir);
  await simpleGit().raw(["clone", "--bare", sourceDir, remoteDir]);
  await source.addRemote("origin", fileUrl);
  await source.push(["-u", "origin", "main"]);
  return {
    remoteDir,
    fileUrl,
    source,
    async commitOnRemote(message: string, file: string, content: string): Promise<void> {
      writeFileSync(path.join(sourceDir, file), content, "utf8");
      await source.add(".");
      await source.commit(message);
      await source.push();
    },
  };
}

function targetFor(remoteUrl: string, destDir: string): CloneTarget {
  return {
    owner: "acme",
    name: "api",
    httpsUrl: remoteUrl,
    sshUrl: remoteUrl,
    destDir,
  };
}

beforeAll(() => {
  configDir = tempDir("repotruck-syncgit-cfg-");
  configEnv = { REPOTRUCK_CONFIG_DIR: configDir };
});

function worktreeText(file: string): string {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

const savedGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;

afterAll(() => {
  if (savedGitConfigGlobal === undefined) {
    delete process.env.GIT_CONFIG_GLOBAL;
  } else {
    process.env.GIT_CONFIG_GLOBAL = savedGitConfigGlobal;
  }
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("cloneOrUpdate against file:// remotes", () => {
  test("scenario 1: fresh clone reports done/cloned", async () => {
    const remote = await makeRemote("rt-git-clone");
    const dest = path.join(tempDir("rt-git-dest1-"), "acme", "source", "api");
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    expect(progress.phase).toBe("done");
    expect(progress.message).toBe("cloned");
    expect(existsSync(path.join(dest, ".git"))).toBe(true);
  });

  test("scenario 2: new remote commits pull cleanly (done/updated)", async () => {
    const remote = await makeRemote("rt-git-pull");
    const dest = path.join(tempDir("rt-git-dest2-"), "acme", "source", "api");
    await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    await remote.commitOnRemote("second", "hello.txt", "v2\n");
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    expect(progress.phase).toBe("done");
    expect(progress.message).toBe("updated");
    expect(worktreeText(path.join(dest, "hello.txt"))).toBe("v2\n");
  });

  test("scenario 3: no changes report up to date", async () => {
    const remote = await makeRemote("rt-git-uptodate");
    const dest = path.join(tempDir("rt-git-dest3-"), "acme", "source", "api");
    await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    expect(progress.phase).toBe("done");
    expect(progress.message).toBe("up to date");
  });

  test("scenario 4: ahead-only with default strategy fails and names the options", async () => {
    const remote = await makeRemote("rt-git-ahead");
    const dest = path.join(tempDir("rt-git-dest4-"), "acme", "source", "api");
    await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    const git = simpleGit(dest);
    writeFileSync(path.join(dest, "local.txt"), "local work\n", "utf8");
    await git.add(".");
    await git.commit("local commit");
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    expect(progress.phase).toBe("failed");
    expect(progress.message).toContain("ahead 1");
    expect(progress.message).toContain("--divergence");
  });

  test("scenario 5 (diverged): rebase lands both sides", async () => {
    const remote = await makeRemote("rt-git-rebase");
    const dest = path.join(tempDir("rt-git-dest5-"), "acme", "source", "api");
    await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    await remote.commitOnRemote("remote change", "remote.txt", "remote\n");
    const git = simpleGit(dest);
    writeFileSync(path.join(dest, "local.txt"), "local work\n", "utf8");
    await git.add(".");
    await git.commit("local commit");
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest), {
      divergence: "rebase",
    });
    expect(progress.phase).toBe("done");
    expect(progress.message).toContain("rebased");
    const log = await git.log();
    const subjects = log.all.map((entry) => entry.message);
    expect(subjects).toContain("local commit");
    expect(subjects).toContain("remote change");
  });

  test("scenario 6 (diverged): reset discards local commits and matches origin", async () => {
    const remote = await makeRemote("rt-git-reset");
    const dest = path.join(tempDir("rt-git-dest6-"), "acme", "source", "api");
    await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    await remote.commitOnRemote("remote change", "hello.txt", "v2\n");
    const git = simpleGit(dest);
    writeFileSync(path.join(dest, "local.txt"), "doomed local work\n", "utf8");
    await git.add(".");
    await git.commit("doomed local commit");
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest), {
      divergence: "reset",
    });
    expect(progress.phase).toBe("done");
    expect(progress.message).toContain("reset to origin");
    expect(existsSync(path.join(dest, "local.txt"))).toBe(false);
    expect(worktreeText(path.join(dest, "hello.txt"))).toBe("v2\n");
  });

  test("scenario 7 (diverged): skip keeps local commits out of done and failed", async () => {
    const remote = await makeRemote("rt-git-skip");
    const dest = path.join(tempDir("rt-git-dest7-"), "acme", "source", "api");
    await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    await remote.commitOnRemote("remote change", "remote.txt", "remote\n");
    const git = simpleGit(dest);
    writeFileSync(path.join(dest, "local.txt"), "kept local work\n", "utf8");
    await git.add(".");
    await git.commit("kept local commit");
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest), {
      divergence: "skip",
    });
    expect(progress.phase).toBe("skipped");
    expect(progress.message).toContain("ahead 1");
    expect(progress.message).toContain("divergence skip");
    expect(worktreeText(path.join(dest, "local.txt"))).toBe("kept local work\n");
  });

  test("scenario 8: dirty worktree without --stash fails with guidance", async () => {
    const remote = await makeRemote("rt-git-dirty");
    const dest = path.join(tempDir("rt-git-dest8-"), "acme", "source", "api");
    await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    writeFileSync(path.join(dest, "hello.txt"), "dirty edit\n", "utf8");
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    expect(progress.phase).toBe("failed");
    expect(progress.message).toContain("dirty worktree");
    expect(progress.message).toContain("--stash");
  });

  test("scenario 9: --stash preserves uncommitted changes across the update", async () => {
    const remote = await makeRemote("rt-git-stash");
    const dest = path.join(tempDir("rt-git-dest9-"), "acme", "source", "api");
    await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    await remote.commitOnRemote("remote change", "remote.txt", "remote\n");
    writeFileSync(path.join(dest, "hello.txt"), "local edit\n", "utf8");
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest), { stash: true });
    expect(progress.phase).toBe("done");
    expect(worktreeText(path.join(dest, "hello.txt"))).toBe("local edit\n");
    expect(worktreeText(path.join(dest, "remote.txt"))).toBe("remote\n");
  });

  test("scenario 10: --depth 1 creates a shallow clone", async () => {
    const remote = await makeRemote("rt-git-shallow");
    await remote.commitOnRemote("second", "hello.txt", "v2\n");
    await remote.commitOnRemote("third", "hello.txt", "v3\n");
    const dest = path.join(tempDir("rt-git-dest10-"), "acme", "source", "api");
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest), { depth: 1 });
    expect(progress.phase).toBe("done");
    expect(existsSync(path.join(dest, ".git", "shallow"))).toBe(true);
  });

  test("scenario 11: --blobless sets the partial clone filter", async () => {
    const remote = await makeRemote("rt-git-blobless");
    const dest = path.join(tempDir("rt-git-dest11-"), "acme", "source", "api");
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest), { blobless: true });
    expect(progress.phase).toBe("done");
    const filter = await simpleGit(dest).raw(["config", "remote.origin.partialclonefilter"]);
    expect(filter.trim()).toBe("blob:none");
  });

  test("scenario 12: fetch --prune drops deleted remote branches", async () => {
    const remote = await makeRemote("rt-git-prune");
    const dest = path.join(tempDir("rt-git-dest12-"), "acme", "source", "api");
    await remote.source.push(["origin", "main:feature"]);
    await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    const before = await simpleGit(dest).raw(["branch", "-r"]);
    expect(before).toContain("origin/feature");
    await remote.source.push(["origin", "--delete", "feature"]);
    const progress = await cloneOrUpdate(targetFor(remote.fileUrl, dest));
    expect(progress.phase).toBe("done");
    const after = await simpleGit(dest).raw(["branch", "-r"]);
    expect(after).not.toContain("origin/feature");
  });
});

describe("syncRepos with real git", () => {
  test("routes skipped repositories and publishes hub events with a summary", async () => {
    const cleanRemote = await makeRemote("rt-git-sr-clean");
    const divergedRemote = await makeRemote("rt-git-sr-div");
    const root = tempDir("rt-git-sr-root-");
    const destA = path.join(root, "acme", "source", "api");
    const destB = path.join(root, "community", "other", "source", "lib");
    await cloneOrUpdate(targetFor(cleanRemote.fileUrl, destA));
    await cloneOrUpdate({
      owner: "other",
      name: "lib",
      httpsUrl: divergedRemote.fileUrl,
      sshUrl: divergedRemote.fileUrl,
      destDir: destB,
    });
    await divergedRemote.commitOnRemote("remote change", "remote.txt", "remote\n");
    const gitB = simpleGit(destB);
    writeFileSync(path.join(destB, "local.txt"), "local\n", "utf8");
    await gitB.add(".");
    await gitB.commit("local commit");

    const repoOf = (owner: string, name: string, url: string): RepoInfo => ({
      owner,
      name,
      description: null,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      language: null,
      httpsUrl: url,
      sshUrl: url,
      updatedAt: null,
    });
    const hub = createProgressHub();
    const result = await syncRepos({
      root,
      config: defaultConfig(root, "categorized"),
      repos: [
        repoOf("acme", "api", cleanRemote.fileUrl),
        repoOf("other", "lib", divergedRemote.fileUrl),
      ],
      userLogin: "acme",
      orgs: [],
      token: null,
      divergence: "skip",
      env: configEnv,
      hub,
    });
    expect(result.done.map((entry) => entry.key)).toEqual(["acme/api"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.key).toBe("other/lib");
    expect(result.skipped[0]!.message).toContain("ahead 1");
    expect(result.failed).toEqual([]);
    const summary = hub.snapshot().find((event) => !("phase" in event));
    expect(summary).toEqual({ kind: "sync-summary", done: 1, failed: 0, skipped: 1 });
    const repoEvents = hub.snapshot().filter((event) => "phase" in event);
    for (const event of repoEvents) {
      const progress = event as { index: number; total: number };
      expect(progress.total).toBe(2);
      expect(progress.index).toBeGreaterThanOrEqual(1);
    }
  });
});

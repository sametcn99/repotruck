import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { simpleGit } from "simple-git";
import { cloneOrUpdate, firstErrorLine } from "../src/services/cloner.ts";
import { defaultConfig } from "../src/services/config.ts";
import { applyInventoryFixes, inspectWorkspaceInventory } from "../src/services/doctorInventory.ts";
import { archiveRepository, deleteRepository } from "../src/services/lifecycle.ts";
import { moveRepository } from "../src/services/mover.ts";
import { reorganizeWorkspace } from "../src/services/reorganizer.ts";
import { loadWorkspace, resolveForkPlacementRepo, syncRepos } from "../src/services/workspace.ts";
import { readWorkspaceConfig } from "../src/services/workspaceRegistry.ts";
import { createRepoWorktree, removeRepoWorktree } from "../src/services/worktree.ts";
import { gitRemoteFixture } from "./helpers/gitRemote.ts";
import { remoteRepo, workspaceFixture } from "./helpers/hardening.ts";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];
const saved = process.env.REPOTRUCK_CONFIG_DIR;
function fixture() {
  const f = workspaceFixture();
  fixtures.push(f);
  process.env.REPOTRUCK_CONFIG_DIR = f.configDir;
  rmSync(f.repoDir, { recursive: true });
  return f;
}
afterEach(() => {
  if (saved === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = saved;
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe("real Git edge states", () => {
  test("[E18] Doctor relinks a real moved checkout after inventory failure and repeated recovery is stable", async () => {
    const f = fixture(),
      remote = await gitRemoteFixture(f);
    await cloneOrUpdate(remote.target);
    await simpleGit(f.repoDir).remote(["set-url", "origin", "https://github.com/acme/api.git"]);
    f.config.aliases = { api: "acme/source/api" };
    await f.save();
    const moved = await moveRepository(f.root, f.config, "acme/api", "relocated/api", {
      updateWorkspaceImpl: async () => {
        throw new Error("ENOSPC");
      },
    });
    expect(moved.ok).toBe(false);
    const issues = await inspectWorkspaceInventory(
        (await readWorkspaceConfig(f.root, f.env))!,
        f.env,
      ),
      fixes = issues.flatMap((issue) => (issue.fix ? [issue.fix] : []));
    expect(fixes).toContainEqual({
      action: "relink",
      key: "acme/api",
      from: "acme/source/api",
      to: "relocated/api",
    });
    await applyInventoryFixes(f.root, fixes, f.env);
    const recovered = await loadWorkspace(f.root, undefined, f.env);
    expect(recovered.repos[0]?.relativePath).toBe("relocated/api");
    expect(recovered.aliases?.api).toBe("relocated/api");
    expect(await inspectWorkspaceInventory(recovered, f.env)).toEqual([]);
    expect((await loadWorkspace(f.root, undefined, f.env)).repos).toEqual(recovered.repos);
  });

  test("[E32] detached HEAD and missing upstream preserve commits and dirty files", async () => {
    const f = fixture(),
      remote = await gitRemoteFixture(f);
    expect((await cloneOrUpdate(remote.target)).phase).toBe("done");
    const git = simpleGit(f.repoDir),
      head = (await git.revparse(["HEAD"])).trim();
    await git.raw(["checkout", "--detach", "HEAD"]);
    writeFileSync(path.join(f.repoDir, "user.txt"), "keep");
    expect((await cloneOrUpdate(remote.target)).message).toContain("detached HEAD");
    expect((await git.revparse(["HEAD"])).trim()).toBe(head);
    await git.raw(["checkout", "main"]);
    await git.raw(["branch", "--unset-upstream"]);
    expect((await cloneOrUpdate(remote.target)).message).toContain("upstream branch is missing");
    expect(readFileSync(path.join(f.repoDir, "user.txt"), "utf8")).toBe("keep");
  });

  test("[E33] empty bare repository can be cloned and safely reports no commits on the second sync", async () => {
    const f = fixture(),
      bare = path.join(f.base, "empty.git");
    await simpleGit().raw(["init", "--bare", bare]);
    const url = pathToFileURL(bare).href;
    const target = { owner: "acme", name: "empty", httpsUrl: url, sshUrl: url, destDir: f.repoDir };
    expect((await cloneOrUpdate(target)).phase).toBe("done");
    const second = await cloneOrUpdate(target);
    expect(second.phase).toBe("skipped");
    expect(second.message).toContain("no commits");
    expect(existsSync(path.join(f.repoDir, ".git"))).toBe(true);
  });

  test("[E34] remote default-branch rename never silently resets the old local branch", async () => {
    const f = fixture(),
      remote = await gitRemoteFixture(f);
    await cloneOrUpdate(remote.target);
    const git = simpleGit(f.repoDir),
      old = (await git.revparse(["HEAD"])).trim();
    await remote.source.raw(["branch", "-m", "trunk"]);
    await remote.source.push(["-u", "origin", "trunk"]);
    await remote.bare.raw(["symbolic-ref", "HEAD", "refs/heads/trunk"]);
    await remote.source.push(["origin", "--delete", "main"]);
    writeFileSync(path.join(f.repoDir, "user.txt"), "keep");
    const result = await cloneOrUpdate(remote.target);
    expect(result.phase).toBe("failed");
    expect(result.message).toContain("upstream");
    expect((await git.revparse(["HEAD"])).trim()).toBe(old);
    expect(readFileSync(path.join(f.repoDir, "user.txt"), "utf8")).toBe("keep");
  });

  test("[E35] stash-pop conflict retains the user's changes and an older stash", async () => {
    const f = fixture(),
      remote = await gitRemoteFixture(f);
    await cloneOrUpdate(remote.target);
    const git = simpleGit(f.repoDir);
    writeFileSync(path.join(f.repoDir, "old.txt"), "older");
    await git.raw(["stash", "push", "-u", "-m", "older-user-stash"]);
    writeFileSync(path.join(f.repoDir, "same.txt"), "local change\n");
    await remote.commit("same.txt", "remote change\n");
    const result = await cloneOrUpdate(remote.target, { stash: true });
    expect(result.phase).toBe("failed");
    expect(result.message).toContain("stash pop failed");
    const stashes = await git.raw(["stash", "list"]);
    expect(stashes).toContain("older-user-stash");
    expect(stashes).toContain("repotruck-sync");
    expect(await git.raw(["show", "stash@{0}:same.txt"])).toBe("local change\n");
  });

  test("[E36] successful stash update preserves staging, binary/untracked data and file modes", async () => {
    const f = fixture(),
      remote = await gitRemoteFixture(f);
    await cloneOrUpdate(remote.target);
    const git = simpleGit(f.repoDir);
    writeFileSync(path.join(f.repoDir, "src/main.ts"), "export const value = 2;\r\n");
    await git.add("src/main.ts");
    const binary = Buffer.from([0, 255, 1, 128]);
    writeFileSync(path.join(f.repoDir, "untracked.bin"), binary);
    chmodSync(path.join(f.repoDir, "same.txt"), 0o755);
    const beforeMode = (await git.raw(["diff", "--summary"])).trim();
    if (process.platform !== "win32") symlinkSync("same.txt", path.join(f.repoDir, "link"));
    await remote.commit("docs/guide.md", "updated remote guide\n");
    const result = await cloneOrUpdate(remote.target, { stash: true });
    expect(result.phase).toBe("done");
    expect(readFileSync(path.join(f.repoDir, "src/main.ts"), "utf8")).toBe(
      "export const value = 2;\r\n",
    );
    expect((await git.raw(["diff", "--cached", "--name-only"])).trim()).toContain("src/main.ts");
    expect(readFileSync(path.join(f.repoDir, "untracked.bin"))).toEqual(binary);
    expect((await git.raw(["diff", "--summary"])).trim()).toBe(beforeMode);
    expect(await git.raw(["stash", "list"])).toBe("");
  });

  test("[E37] interrupted clone transport never publishes partial checkout or done inventory and can be retried", async () => {
    const f = fixture(),
      remote = await gitRemoteFixture(f);
    let calls = 0;
    const config = defaultConfig(f.root),
      repo = { ...remoteRepo, httpsUrl: remote.url, sshUrl: remote.url };
    const result = await syncRepos({
      root: f.root,
      config,
      repos: [repo],
      userLogin: "acme",
      orgs: [],
      env: f.env,
      preferSsh: false,
      cloneOrUpdateImpl: (target, options, emit) =>
        cloneOrUpdate(target, options, emit, {
          clone: async (_git, args) => {
            calls++;
            const stage = args.at(-1)!;
            mkdirSync(path.join(stage, ".git/objects/pack"), { recursive: true });
            writeFileSync(path.join(stage, ".git/objects/pack/partial"), "partial");
            throw new Error("RPC failed: early EOF");
          },
        }),
    });
    expect(calls).toBe(2);
    expect(result.done).toEqual([]);
    expect(result.failed.length).toBe(1);
    expect(existsSync(f.repoDir)).toBe(false);
    expect(
      readdirSync(path.dirname(f.repoDir)).filter((name) => name.startsWith(".repotruck-clone-")),
    ).toEqual([]);
    expect((await readWorkspaceConfig(f.root, f.env))?.repos).toEqual([]);
    expect((await cloneOrUpdate(remote.target)).phase).toBe("done");
  });

  test("[E38] pruning a removed remote tracking branch preserves the matching local branch", async () => {
    const f = fixture(),
      remote = await gitRemoteFixture(f);
    await remote.source.push(["origin", "main:feature"]);
    await cloneOrUpdate(remote.target);
    const git = simpleGit(f.repoDir);
    await git.raw(["branch", "feature", "origin/feature"]);
    const head = (await git.revparse(["feature"])).trim();
    await remote.source.push(["origin", "--delete", "feature"]);
    expect((await cloneOrUpdate(remote.target)).phase).toBe("done");
    expect(await git.raw(["branch", "-r"])).not.toContain("origin/feature");
    expect((await git.revparse(["feature"])).trim()).toBe(head);
  });

  test("[E39] shallow blobless sparse clone changes and disables sparse paths on later syncs", async () => {
    const f = fixture(),
      remote = await gitRemoteFixture(f);
    await remote.bare.addConfig("uploadpack.allowFilter", "true");
    expect(
      (await cloneOrUpdate(remote.target, { depth: 1, blobless: true, sparse: ["src"] })).phase,
    ).toBe("done");
    expect(existsSync(path.join(f.repoDir, ".git/shallow"))).toBe(true);
    expect(existsSync(path.join(f.repoDir, "src/main.ts"))).toBe(true);
    expect(existsSync(path.join(f.repoDir, "docs/guide.md"))).toBe(false);
    expect((await cloneOrUpdate(remote.target, { sparse: ["docs"] })).phase).toBe("done");
    expect(existsSync(path.join(f.repoDir, "docs/guide.md"))).toBe(true);
    expect(existsSync(path.join(f.repoDir, "src/main.ts"))).toBe(false);
    expect((await cloneOrUpdate(remote.target, { sparse: [] })).phase).toBe("done");
    expect(existsSync(path.join(f.repoDir, "src/main.ts"))).toBe(true);
  });

  test("[E39] unsupported blobless remote fails explicitly, cleans staging and permits a normal retry", async () => {
    const f = fixture(),
      remote = await gitRemoteFixture(f);
    const result = await cloneOrUpdate(remote.target, { blobless: true });
    expect(result.phase).toBe("failed");
    expect(result.message).toContain("does not support blobless");
    expect(existsSync(f.repoDir)).toBe(false);
    expect((await cloneOrUpdate(remote.target)).phase).toBe("done");
  });

  test("[E40] known fork source survives unavailable lookup; unknown source is skipped without moving", async () => {
    const f = fixture();
    const fork = { ...remoteRepo, isFork: true };
    const config = {
      ...f.config,
      repos: [{ ...f.config.repos[0]!, category: "forks" as const, forkSourceOwner: "upstream" }],
    };
    const resolved = await resolveForkPlacementRepo(fork, config, async () => {
      throw new Error("rate limited");
    });
    expect(resolved.forkSourceOwner).toBe("upstream");
    const result = await syncRepos({
      root: f.root,
      config: defaultConfig(f.root),
      repos: [fork],
      userLogin: "acme",
      orgs: [],
      env: f.env,
      preferSsh: false,
      getRepo: async () => {
        throw new Error("unavailable");
      },
    });
    expect(result.done).toEqual([]);
    expect(result.skipped[0]?.message).toContain("fork source owner unavailable");
    expect(existsSync(f.repoDir)).toBe(false);
    expect(
      firstErrorLine(new Error("https://user:secret@github.com/a/b token%20value"), "token value"),
    ).not.toContain("secret");
  });

  test("[E41] linked worktrees protect both the main checkout and its linked working directory", async () => {
    const f = fixture(),
      remote = await gitRemoteFixture(f);
    await cloneOrUpdate(remote.target);
    await f.save();
    const linked = path.join(f.root, "linked");
    expect((await createRepoWorktree(f.repoDir, "work", linked, { newBranch: true })).ok).toBe(
      true,
    );
    expect((await deleteRepository(f.root, f.config, "acme/api", { yes: true }, f.env)).ok).toBe(
      false,
    );
    expect((await moveRepository(f.root, f.config, "acme/api", "moved/api")).ok).toBe(false);
    let archiveCalled = false;
    expect(
      (
        await archiveRepository(
          f.root,
          f.config,
          "acme/api",
          {
            getRepo: async () => remoteRepo,
            archiveRepo: async () => {
              archiveCalled = true;
              return remoteRepo;
            },
          },
          {},
          f.env,
        )
      ).ok,
    ).toBe(false);
    expect(archiveCalled).toBe(false);
    expect(
      (await reorganizeWorkspace(f.root, "flat", { env: f.env })).skipped.some((row) =>
        row.reason.includes("worktree"),
      ),
    ).toBe(true);
    writeFileSync(path.join(linked, "user.txt"), "keep");
    expect((await removeRepoWorktree(f.repoDir, linked)).ok).toBe(false);
    expect(existsSync(path.join(linked, "user.txt"))).toBe(true);
    expect(existsSync(path.join(f.repoDir, ".git"))).toBe(true);
  });
});

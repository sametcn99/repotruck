import { deleteRepo, archiveRepo, pruneRepos } from "../src/core/repos.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import {
  defaultConfig,
  type EnvLike,
  type RepotruckConfig,
  readAgentsMd,
} from "../src/services/config.ts";
import {
  archiveRepository,
  deleteRepository,
  forgetRepository,
  type LifecycleGithub,
  pruneWorkspace,
  workspaceStatus,
} from "../src/services/lifecycle.ts";
import { loadWorkspace, updateWorkspace } from "../src/services/workspace.ts";
import { centralStorePath, readWorkspaceConfig } from "../src/services/workspaceRegistry.ts";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeEntry(
  owner: string,
  name: string,
  relativePath: string,
  extra: Partial<RepotruckConfig["repos"][number]> = {},
): RepotruckConfig["repos"][number] {
  return {
    owner,
    name,
    relativePath,
    category: "source",
    internal: true,
    language: null,
    updatedAt: null,
    ...extra,
  };
}

async function makeWorkspace(
  prefix: string,
  repos: RepotruckConfig["repos"],
  aliases: Record<string, string> = {},
): Promise<{ root: string; env: EnvLike; config: RepotruckConfig }> {
  const root = tempDir(`${prefix}-root-`);
  const configDir = tempDir(`${prefix}-cfg-`);
  const env: EnvLike = { REPOTRUCK_CONFIG_DIR: configDir };
  for (const entry of repos) {
    const dir = path.join(root, ...entry.relativePath.split("/"));
    mkdirSync(dir, { recursive: true });
  }
  const config: RepotruckConfig = { ...defaultConfig(root, "categorized"), repos, aliases };
  await updateWorkspace(root, () => ({ config, result: undefined }), env);
  return { root, env, config };
}

function fakeGithub(
  behavior: Record<string, "ok" | "gone" | "error">,
  errorFactory: () => Error = () => new Error("boom"),
): LifecycleGithub & { archiveCalls: string[] } {
  const archiveCalls: string[] = [];
  return {
    archiveCalls,
    async getRepo(owner, name) {
      const state = behavior[`${owner}/${name}`] ?? "ok";
      if (state === "gone") {
        const error = new Error("Not Found");
        Object.assign(error, { status: 404 });
        throw error;
      }
      if (state === "error") throw errorFactory();
      return {
        owner,
        name,
        description: null,
        isPrivate: false,
        isFork: false,
        isArchived: false,
        language: null,
        httpsUrl: `https://github.com/${owner}/${name}.git`,
        sshUrl: `git@github.com:${owner}/${name}.git`,
        updatedAt: "2026-10-24T00:00:00.000Z",
      };
    },
    async archiveRepo(owner, name) {
      archiveCalls.push(`${owner}/${name}`);
      return {
        owner,
        name,
        description: null,
        isPrivate: false,
        isFork: false,
        isArchived: true,
        language: null,
        httpsUrl: `https://github.com/${owner}/${name}.git`,
        sshUrl: `git@github.com:${owner}/${name}.git`,
        updatedAt: "2026-10-24T01:00:00.000Z",
      };
    },
  };
}

function storeBytes(env: EnvLike): string {
  return readFileSync(centralStorePath(env), "utf8");
}

describe("forgetRepository", () => {
  test("untracks the entry, drops its aliases, keeps the directory and AGENTS.md in sync", async () => {
    const { root, env } = await makeWorkspace(
      "rt-fgt",
      [
        makeEntry("acme", "api", "acme/source/api"),
        makeEntry("other", "lib", "community/other/source/lib"),
      ],
      { api: "acme/source/api" },
    );
    const result = await forgetRepository(
      root,
      (await readWorkspaceConfig(root, env))!,
      "acme/api",
      env,
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("kept on disk at acme/source/api");
    const after = await readWorkspaceConfig(root, env);
    expect(after!.repos.map((r) => `${r.owner}/${r.name}`)).toEqual(["other/lib"]);
    expect(after!.aliases).toEqual({});
    expect(existsSync(path.join(root, "acme", "source", "api"))).toBe(true);
    const agents = await readAgentsMd(root);
    expect(agents).toContain("other/lib");
    expect(agents).not.toContain("acme/api");
  });

  test("resolves aliases and unknown refs fail in English", async () => {
    const { root, env } = await makeWorkspace(
      "rt-fgt2",
      [makeEntry("acme", "api", "acme/source/api")],
      { api: "acme/source/api" },
    );
    const result = await forgetRepository(
      root,
      (await readWorkspaceConfig(root, env))!,
      "api",
      env,
    );
    expect(result.ok).toBe(true);
    const missing = await forgetRepository(
      root,
      (await readWorkspaceConfig(root, env))!,
      "nope/none",
      env,
    );
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain("not tracked by repotruck: nope/none (records: ");
    expect(missing.message).toContain(centralStorePath(env));
  });
});

describe("pruneWorkspace", () => {
  test("dry-run lists gone repositories without touching the store", async () => {
    const { root, env, config } = await makeWorkspace("rt-prn1", [
      makeEntry("acme", "api", "acme/source/api"),
      makeEntry("other", "lib", "community/other/source/lib"),
    ]);
    const before = storeBytes(env);
    const github = fakeGithub({ "acme/api": "gone" });
    const result = await pruneWorkspace(root, config, github, { dryRun: true }, env);
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual([
      "[prune] acme/api (deleted or inaccessible on GitHub) -> would untrack",
    ]);
    expect(storeBytes(env)).toBe(before);
  });

  test("prune untracks only gone repositories", async () => {
    const { root, env, config } = await makeWorkspace("rt-prn2", [
      makeEntry("acme", "api", "acme/source/api"),
      makeEntry("other", "lib", "community/other/source/lib"),
    ]);
    const github = fakeGithub({ "acme/api": "gone" });
    const result = await pruneWorkspace(root, config, github, {}, env);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("pruned 1 of 2 tracked");
    const after = await readWorkspaceConfig(root, env);
    expect(after!.repos.map((r) => `${r.owner}/${r.name}`)).toEqual(["other/lib"]);
  });

  test("classification failure (401) aborts with the store byte-identical", async () => {
    const { root, env, config } = await makeWorkspace("rt-prn3", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const before = storeBytes(env);
    const unauthorized = new Error("Bad credentials");
    Object.assign(unauthorized, { status: 401 });
    const github = fakeGithub({ "acme/api": "error" }, () => unauthorized);
    const result = await pruneWorkspace(root, config, github, {}, env);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("prune failed: acme/api");
    expect(result.message).toContain("inventory unchanged");
    expect(result.message.split("\n").length).toBe(1);
    expect(storeBytes(env)).toBe(before);
  });

  test("rate-limit-style 403 is an error, not gone, and leaves the store untouched", async () => {
    const { root, env, config } = await makeWorkspace("rt-prn4", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const before = storeBytes(env);
    const limited = new Error("API rate limit exceeded");
    Object.assign(limited, { status: 403, headers: { "retry-after": "1" } });
    const github = fakeGithub({ "acme/api": "error" }, () => limited);
    const result = await pruneWorkspace(root, config, github, {}, env);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("prune failed: acme/api");
    expect(storeBytes(env)).toBe(before);
  });

  test("network error aborts with the store byte-identical", async () => {
    const { root, env, config } = await makeWorkspace("rt-prn6", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const before = storeBytes(env);
    const github = fakeGithub(
      { "acme/api": "error" },
      () => new Error("getaddrinfo ENOTFOUND github.com"),
    );
    const result = await pruneWorkspace(root, config, github, {}, env);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("prune failed: acme/api");
    expect(result.message).toContain("inventory unchanged");
    expect(result.message.split("\n").length).toBe(1);
    expect(storeBytes(env)).toBe(before);
  });

  test("nothing gone reports cleanly", async () => {
    const { root, env, config } = await makeWorkspace("rt-prn5", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const result = await pruneWorkspace(root, config, fakeGithub({}), {}, env);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("nothing to prune (1 tracked)");
  });
});

describe("deleteRepository with trash", () => {
  test("parks the directory in .repotruck/trash instead of removing it", async () => {
    const { root, env, config } = await makeWorkspace("rt-trash1", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const repoDir = path.join(root, "acme", "source", "api");
    const result = await deleteRepository(
      root,
      config,
      "acme/api",
      { yes: true, trash: true },
      env,
    );
    expect(result.ok).toBe(true);
    expect(result.trashPath).toBeDefined();
    expect(existsSync(repoDir)).toBe(false);
    expect(existsSync(result.trashPath!)).toBe(true);
    expect(result.message).toContain("trash");
    const after = await loadWorkspace(root, undefined, env);
    expect(after.repos.length).toBe(0);
  });
});

describe("deleteRepository", () => {
  test("without --yes nothing changes", async () => {
    const { root, env, config } = await makeWorkspace("rt-del1", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const before = storeBytes(env);
    const result = await deleteRepository(root, config, "acme/api", {}, env);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("delete requires --yes");
    expect(result.message).toContain(path.join(root, "acme", "source", "api"));
    expect(storeBytes(env)).toBe(before);
    expect(existsSync(path.join(root, "acme", "source", "api"))).toBe(true);
  });

  test("--yes removes the directory first, then untracks (T3 order)", async () => {
    const { root, env, config } = await makeWorkspace(
      "rt-del2",
      [makeEntry("acme", "api", "acme/source/api")],
      { api: "acme/source/api" },
    );
    const order: string[] = [];
    const result = await deleteRepository(
      root,
      config,
      "acme/api",
      {
        yes: true,
        rmImpl: (target) => {
          order.push("rm");
          expect(existsSync(target)).toBe(true);
          rmSync(target, { recursive: true, force: true });
        },
      },
      env,
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("removed acme/source/api");
    expect(order).toEqual(["rm"]);
    expect(existsSync(path.join(root, "acme", "source", "api"))).toBe(false);
    const after = await readWorkspaceConfig(root, env);
    expect(after!.repos).toEqual([]);
    expect(after!.aliases).toEqual({});
  });

  test("rm failure keeps the inventory byte-identical (T3)", async () => {
    const { root, env, config } = await makeWorkspace("rt-del3", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const before = storeBytes(env);
    const result = await deleteRepository(
      root,
      config,
      "acme/api",
      {
        yes: true,
        rmImpl: () => {
          const error = new Error("EBUSY: resource busy");
          Object.assign(error, { code: "EBUSY" });
          throw error;
        },
      },
      env,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("failed to delete acme/source/api");
    expect(result.message).toContain("inventory unchanged");
    expect(storeBytes(env)).toBe(before);
  });

  test("a broken relativePath of '.' is refused (T2)", async () => {
    const { root, env } = await makeWorkspace("rt-del4", [
      makeEntry("acme", "api", "acme/source/api"),
      makeEntry("evil", "root", "."),
    ]);
    const before = storeBytes(env);
    const config = (await readWorkspaceConfig(root, env))!;
    const result = await deleteRepository(root, config, "evil/root", { yes: true }, env);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("refusing to delete the workspace root");
    expect(storeBytes(env)).toBe(before);
    expect(existsSync(root)).toBe(true);
  });

  test("a missing directory still untracks with the already-missing message", async () => {
    const root = tempDir("rt-del5-root-");
    const configDir = tempDir("rt-del5-cfg-");
    const env: EnvLike = { REPOTRUCK_CONFIG_DIR: configDir };
    const config: RepotruckConfig = {
      ...defaultConfig(root, "categorized"),
      repos: [makeEntry("acme", "api", "acme/source/api")],
    };
    await updateWorkspace(root, () => ({ config, result: undefined }), env);
    const result = await deleteRepository(root, config, "acme/api", { yes: true }, env);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("directory was already missing");
    expect((await readWorkspaceConfig(root, env))!.repos).toEqual([]);
  });

  test("an unknown ref fails with the records hint", async () => {
    const { root, env, config } = await makeWorkspace("rt-del6", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const before = storeBytes(env);
    const result = await deleteRepository(root, config, "nope/none", { yes: true }, env);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not tracked by repotruck: nope/none (records: ");
    expect(storeBytes(env)).toBe(before);
  });
});

describe("archiveRepository", () => {
  test("archives on GitHub, moves the directory, rewrites aliases, keeps custom", async () => {
    const { root, env } = await makeWorkspace(
      "rt-arc1",
      [makeEntry("acme", "api", "acme/source/api", { custom: true })],
      { api: "acme/source/api" },
    );
    const config = (await readWorkspaceConfig(root, env))!;
    const github = fakeGithub({});
    const result = await archiveRepository(root, config, "acme/api", github, {}, env);
    expect(result.ok).toBe(true);
    expect(github.archiveCalls).toEqual(["acme/api"]);
    expect(result.message).toContain("category: source -> archived");
    expect(result.message).toContain("moved to acme/archived/api");
    expect(existsSync(path.join(root, "acme", "archived", "api"))).toBe(true);
    expect(existsSync(path.join(root, "acme", "source", "api"))).toBe(false);
    const after = await readWorkspaceConfig(root, env);
    const entry = after!.repos[0]!;
    expect(entry.category).toBe("archived");
    expect(entry.relativePath).toBe("acme/archived/api");
    expect(entry.custom).toBe(true);
    expect(entry.updatedAt).toBe("2026-10-24T01:00:00.000Z");
    expect(after!.aliases).toEqual({ api: "acme/archived/api" });
  });

  test("no move when already at the archived path; API still called", async () => {
    const { root, env } = await makeWorkspace("rt-arc2", [
      makeEntry("acme", "api", "acme/archived/api"),
    ]);
    const config = (await readWorkspaceConfig(root, env))!;
    let moveCalled = false;
    const github = fakeGithub({});
    const result = await archiveRepository(
      root,
      config,
      "acme/api",
      github,
      {
        moveImpl: () => {
          moveCalled = true;
        },
      },
      env,
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("already at acme/archived/api");
    expect(moveCalled).toBe(false);
    expect(github.archiveCalls).toEqual(["acme/api"]);
    const after = await readWorkspaceConfig(root, env);
    expect(after!.repos[0]!.category).toBe("archived");
  });

  test("move failure keeps the archived category and points at a retry (T4)", async () => {
    const { root, env } = await makeWorkspace("rt-arc3", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const config = (await readWorkspaceConfig(root, env))!;
    const github = fakeGithub({});
    const result = await archiveRepository(
      root,
      config,
      "acme/api",
      github,
      {
        moveImpl: () => {
          const error = new Error("EBUSY: resource busy");
          Object.assign(error, { code: "EBUSY" });
          throw error;
        },
      },
      env,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("run 'repotruck archive acme/api' again");
    const after = await readWorkspaceConfig(root, env);
    expect(after!.repos[0]!.category).toBe("archived");
    expect(after!.repos[0]!.relativePath).toBe("acme/source/api");
    expect(existsSync(path.join(root, "acme", "source", "api"))).toBe(true);
  });

  test("API failure changes nothing locally", async () => {
    const { root, env, config } = await makeWorkspace("rt-arc4", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const before = storeBytes(env);
    const github = fakeGithub({});
    github.archiveRepo = async () => {
      const error = new Error("Resource not accessible");
      Object.assign(error, { status: 403 });
      throw error;
    };
    const result = await archiveRepository(root, config, "acme/api", github, {}, env);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("nothing changed locally");
    expect(storeBytes(env)).toBe(before);
  });

  test("a missing directory still records the archived path without a physical move", async () => {
    const { root, env } = await makeWorkspace(
      "rt-arc5",
      [makeEntry("acme", "api", "acme/source/api")],
      { api: "acme/source/api" },
    );
    const config = (await readWorkspaceConfig(root, env))!;
    rmSync(path.join(root, "acme", "source", "api"), { recursive: true, force: true });
    let moveCalled = false;
    const github = fakeGithub({});
    const result = await archiveRepository(
      root,
      config,
      "acme/api",
      github,
      {
        moveImpl: () => {
          moveCalled = true;
        },
      },
      env,
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain("moved to acme/archived/api");
    expect(moveCalled).toBe(false);
    const after = await readWorkspaceConfig(root, env);
    expect(after!.repos[0]!.relativePath).toBe("acme/archived/api");
    expect(after!.repos[0]!.category).toBe("archived");
    expect(after!.aliases).toEqual({ api: "acme/archived/api" });
  });

  test("an unknown ref fails with the records hint", async () => {
    const { root, env, config } = await makeWorkspace("rt-arc6", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const before = storeBytes(env);
    const github = fakeGithub({});
    const result = await archiveRepository(root, config, "nope/none", github, {}, env);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not tracked by repotruck: nope/none (records: ");
    expect(github.archiveCalls).toEqual([]);
    expect(storeBytes(env)).toBe(before);
  });
});

describe("workspaceStatus", () => {
  describe("full matrix: clean, dirty, ahead, behind, no upstream, missing, not a git repo", () => {
    let root: string;
    let env: EnvLike;
    let config: RepotruckConfig;

    beforeAll(async () => {
      root = tempDir("rt-st-root-");
      const configDir = tempDir("rt-st-cfg-");
      env = { REPOTRUCK_CONFIG_DIR: configDir };

      async function localRepo(
        rel: string,
        setup: (dir: string, git: ReturnType<typeof simpleGit>) => Promise<void>,
      ): Promise<string> {
        const dir = path.join(root, ...rel.split("/"));
        mkdirSync(dir, { recursive: true });
        const git = simpleGit(dir);
        await git.init(["-b", "main"]);
        await git.addConfig("user.email", "t@t");
        await git.addConfig("user.name", "t");
        writeFileSync(path.join(dir, "file.txt"), "v1\n", "utf8");
        await git.add(".");
        await git.commit("initial");
        await setup(dir, git);
        return rel;
      }

      async function withUpstream(
        dir: string,
        git: ReturnType<typeof simpleGit>,
        prefix: string,
      ): Promise<string> {
        const remoteDir = tempDir(`${prefix}-remote-`);
        await simpleGit().raw(["clone", "--bare", dir, remoteDir]);
        await git.addRemote("origin", `file:///${remoteDir.replace(/\\/g, "/")}`);
        await git.push(["-u", "origin", "main"]);
        return remoteDir;
      }

      const cleanRel = await localRepo("acme/source/clean", async (dir, git) => {
        await withUpstream(dir, git, "rt-st-clean");
      });
      const dirtyRel = await localRepo("acme/source/dirty", async (dir, git) => {
        await withUpstream(dir, git, "rt-st-dirty");
        writeFileSync(path.join(dir, "file.txt"), "edited\n", "utf8");
      });
      const noUpstreamRel = await localRepo("acme/source/noup", async () => {});

      const aheadRel = await localRepo("acme/source/ahead", async (dir, git) => {
        await withUpstream(dir, git, "rt-st-ahead");
        writeFileSync(path.join(dir, "local.txt"), "local\n", "utf8");
        await git.add(".");
        await git.commit("local commit");
      });
      const behindRel = await localRepo("acme/source/behind", async (dir, git) => {
        const remoteDir = await withUpstream(dir, git, "rt-st-behind");
        const mirrorDir = tempDir("rt-st-behind-mirror-");
        await simpleGit().raw(["clone", remoteDir, mirrorDir]);
        const mirror = simpleGit(mirrorDir);
        await mirror.addConfig("user.email", "t@t");
        await mirror.addConfig("user.name", "t");
        writeFileSync(path.join(mirrorDir, "file.txt"), "v2\n", "utf8");
        await mirror.add(".");
        await mirror.commit("remote change");
        await mirror.push();
        await git.fetch();
      });

      mkdirSync(path.join(root, "acme", "source", "plain"), { recursive: true });

      config = {
        ...defaultConfig(root, "categorized"),
        lastSync: "2026-10-24T02:00:00.000Z",
        repos: [
          makeEntry("acme", "clean", cleanRel),
          makeEntry("acme", "dirty", dirtyRel),
          makeEntry("acme", "noup", noUpstreamRel),
          makeEntry("acme", "ahead", aheadRel),
          makeEntry("acme", "behind", behindRel),
          makeEntry("acme", "missing", "acme/source/missing"),
          makeEntry("acme", "plain", "acme/source/plain", { custom: true }),
        ],
        aliases: { clean: cleanRel },
      };
      await updateWorkspace(root, () => ({ config, result: undefined }), env);
    }, 60_000);

    test("labels every repository state and the workspace lastSync", async () => {
      const status = await workspaceStatus(root, config);
      expect(status.lastSync).toBe("2026-10-24T02:00:00.000Z");
      const byKey = new Map(status.repos.map((item) => [item.key, item.line]));
      expect(byKey.get("acme/clean")).toBe(
        "acme/clean — clean, ahead 0, behind 0, category source, alias clean",
      );
      expect(byKey.get("acme/dirty")).toContain("dirty");
      expect(byKey.get("acme/noup")).toContain("no upstream");
      expect(byKey.get("acme/ahead")).toContain("ahead 1");
      expect(byKey.get("acme/behind")).toContain("behind 1");
      expect(byKey.get("acme/missing")).toBe("acme/missing — MISSING on disk");
      expect(byKey.get("acme/plain")).toContain("not a git repository");
      expect(byKey.get("acme/plain")).toContain("custom");
    }, 15_000);
  });

  test("empty workspace reports no repositories", async () => {
    const { root, config } = await makeWorkspace("rt-st2", []);
    const status = await workspaceStatus(root, config);
    expect(status.repos).toEqual([]);
    expect(status.lastSync).toBeNull();
  });
});

describe("core/repos functions", () => {
  test("deleteRepo delegates to deleteRepository", async () => {
    const { root, env } = await makeWorkspace("rt-core-del", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const res = await deleteRepo(root, "acme/api", { yes: false }, env);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("delete requires --yes");
  });

  test("archiveRepo delegates to archiveRepository", async () => {
    const { root, env } = await makeWorkspace("rt-core-arc", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const github = fakeGithub({});
    const res = await archiveRepo(root, "acme/api", github as any, env);
    expect(res.ok).toBe(true);
    expect(github.archiveCalls).toEqual(["acme/api"]);
  });

  test("pruneRepos delegates to pruneWorkspace", async () => {
    const { root, env } = await makeWorkspace("rt-core-prn", [
      makeEntry("acme", "api", "acme/source/api"),
    ]);
    const github = fakeGithub({ "acme/api": "gone" });
    const res = await pruneRepos(root, github as any, { dryRun: true }, env);
    expect(res.ok).toBe(true);
    expect(res.message).toContain("would be pruned");
  });
});

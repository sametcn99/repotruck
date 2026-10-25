import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/components/store.ts";
import { defaultConfig, type EnvLike } from "../src/services/config.ts";
import { syncRepos, updateWorkspace } from "../src/services/workspace.ts";
import { centralStorePath, readWorkspaceConfig } from "../src/services/workspaceRegistry.ts";

const tempDirs: string[] = [];
const savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function makeInitialWorkspace(prefix: string): {
  root: string;
  configDir: string;
  env: EnvLike;
} {
  const root = tempDir(`${prefix}-root-`);
  const configDir = tempDir(`${prefix}-cfg-`);
  const env: EnvLike = { REPOTRUCK_CONFIG_DIR: configDir };
  return { root, configDir, env };
}

describe("workspace concurrency (Sprint 1 PR 1b)", () => {
  test("50 parallel in-process updateWorkspace calls persist all 50 aliases (C14)", async () => {
    const { root, env } = makeInitialWorkspace("rt-c14");

    await updateWorkspace(
      root,
      () => ({
        config: {
          ...defaultConfig(root),
          repos: [
            {
              owner: "acme",
              name: "core",
              relativePath: "acme/source/core",
              category: "source",
              internal: true,
              language: "TypeScript",
              updatedAt: null,
            },
          ],
          aliases: {},
        },
        result: undefined,
      }),
      env,
    );

    const tasks = Array.from({ length: 50 }, (_, i) =>
      updateWorkspace(
        root,
        (current) => {
          const aliases = { ...(current.aliases ?? {}) };
          aliases[`alias_${i}`] = "acme/source/core";
          return { config: { ...current, aliases }, result: undefined };
        },
        env,
      ),
    );

    await Promise.all(tasks);

    const finalConfig = await readWorkspaceConfig(root, env);
    expect(finalConfig).not.toBeNull();
    const aliases = finalConfig?.aliases ?? {};
    expect(Object.keys(aliases).length).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(aliases[`alias_${i}`]).toBe("acme/source/core");
    }
  });

  test("two spawned processes each adding 25 aliases persist all 50 aliases (C15)", async () => {
    const { root, configDir, env } = makeInitialWorkspace("rt-c15");

    await updateWorkspace(
      root,
      () => ({
        config: {
          ...defaultConfig(root),
          repos: [
            {
              owner: "acme",
              name: "core",
              relativePath: "acme/source/core",
              category: "source",
              internal: true,
              language: "TypeScript",
              updatedAt: null,
            },
          ],
          aliases: {},
        },
        result: undefined,
      }),
      env,
    );

    const makeWorkerScript = (startIdx: number, count: number) => `
      import { updateWorkspace } from "./src/services/workspace.ts";
      const env = { REPOTRUCK_CONFIG_DIR: ${JSON.stringify(configDir)} };
      const root = ${JSON.stringify(root)};

      const tasks = Array.from({ length: ${count} }, (_, i) => {
        const aliasName = "proc_alias_" + (${startIdx} + i);
        return updateWorkspace(root, (current) => {
          const aliases = { ...(current.aliases ?? {}) };
          aliases[aliasName] = "acme/source/core";
          return { config: { ...current, aliases }, result: undefined };
        }, env);
      });

      await Promise.all(tasks);
      process.exit(0);
    `;

    const proc1 = Bun.spawn(["bun", "-e", makeWorkerScript(0, 25)], {
      cwd: process.cwd(),
      stderr: "pipe",
    });
    const proc2 = Bun.spawn(["bun", "-e", makeWorkerScript(25, 25)], {
      cwd: process.cwd(),
      stderr: "pipe",
    });

    const [exit1, exit2] = await Promise.all([proc1.exited, proc2.exited]);
    expect(exit1).toBe(0);
    expect(exit2).toBe(0);

    const finalConfig = await readWorkspaceConfig(root, env);
    expect(finalConfig).not.toBeNull();
    const aliases = finalConfig?.aliases ?? {};
    expect(Object.keys(aliases).length).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(aliases[`proc_alias_${i}`]).toBe("acme/source/core");
    }
  });

  test("concurrent alias set during slow sync does not lose alias (C16)", async () => {
    const { root, env } = makeInitialWorkspace("rt-c16");

    const repoA = {
      owner: "acme",
      name: "repo-a",
      httpsUrl: "https://github.com/acme/repo-a",
      sshUrl: "git@github.com:acme/repo-a.git",
      defaultBranch: "main",
      language: "TypeScript",
      isArchived: false,
      isFork: false,
      isPrivate: false,
      description: null,
      pushedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      diskBytes: 100,
    };

    const initialConfig = await updateWorkspace(
      root,
      () => ({
        config: {
          ...defaultConfig(root),
          repos: [],
          aliases: {},
        },
        result: undefined,
      }),
      env,
    );

    const syncPromise = syncRepos({
      root,
      config: initialConfig.config,
      repos: [repoA],
      userLogin: "acme",
      orgs: ["acme"],
      token: "fake",
      preferSsh: false,
      env,
      cloneOrUpdateImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return {
          phase: "done" as const,
          key: "acme/repo-a",
          owner: "acme",
          name: "repo-a",
          message: "mock done",
        };
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    await updateWorkspace(
      root,
      (current) => {
        const aliases = { ...(current.aliases ?? {}) };
        aliases.concurrent_alias = "acme/source/repo-a";
        return { config: { ...current, aliases }, result: undefined };
      },
      env,
    );

    await syncPromise;

    const finalConfig = await readWorkspaceConfig(root, env);
    expect(finalConfig).not.toBeNull();
    expect(finalConfig?.repos.some((r) => r.owner === "acme" && r.name === "repo-a")).toBe(true);
    expect(finalConfig?.aliases?.concurrent_alias).toBe("acme/source/repo-a");
  });

  test("TUI undo restores moved repository without wiping newly added alias (C17)", async () => {
    const { root, configDir, env } = makeInitialWorkspace("rt-c17");
    process.env.REPOTRUCK_CONFIG_DIR = configDir;

    const repo1Dir = path.join(root, "acme", "source", "core");
    const repo2Dir = path.join(root, "acme", "source", "lib");
    mkdirSync(repo1Dir, { recursive: true });
    mkdirSync(repo2Dir, { recursive: true });
    writeFileSync(path.join(repo1Dir, "README.md"), "# core", "utf8");
    writeFileSync(path.join(repo2Dir, "README.md"), "# lib", "utf8");

    await updateWorkspace(
      root,
      () => ({
        config: {
          ...defaultConfig(root),
          repos: [
            {
              owner: "acme",
              name: "core",
              relativePath: "acme/source/core",
              category: "source",
              internal: true,
              language: "TypeScript",
              updatedAt: null,
            },
            {
              owner: "acme",
              name: "lib",
              relativePath: "acme/source/lib",
              category: "source",
              internal: true,
              language: "TypeScript",
              updatedAt: null,
            },
          ],
          aliases: {},
        },
        result: undefined,
      }),
      env,
    );

    const store = new Store(root, {
      auth: async () => ({ token: "fake", userLogin: "acme", method: "env" as const }),
      github: () =>
        ({
          getRepo: async () => {
            throw new Error("offline");
          },
        }) as never,
    });
    await store.init();

    await store.openMoveModal("acme/core");
    const moved = await store.submitMove("acme/archived/core");
    expect(moved).toBe(true);

    await updateWorkspace(
      root,
      (current) => {
        const aliases = { ...(current.aliases ?? {}) };
        aliases.lib_alias = "acme/source/lib";
        return { config: { ...current, aliases }, result: undefined };
      },
      env,
    );

    await store.undoLast();

    const finalConfig = await readWorkspaceConfig(root, env);
    expect(finalConfig).not.toBeNull();
    const coreRepo = finalConfig?.repos.find((r) => r.owner === "acme" && r.name === "core");
    expect(coreRepo?.relativePath).toBe("acme/source/core");
    expect(finalConfig?.aliases?.lib_alias).toBe("acme/source/lib");
  });

  test("failed CLI alias set does not leak lock file and subsequent command succeeds immediately (F1 regression)", async () => {
    const { root, configDir, env } = makeInitialWorkspace("rt-f1-reg");

    // Initialize workspace with a valid repo
    await updateWorkspace(
      root,
      () => ({
        config: {
          ...defaultConfig(root),
          repos: [
            {
              owner: "acme",
              name: "core",
              relativePath: "acme/source/core",
              category: "source",
              internal: true,
              language: "TypeScript",
              updatedAt: null,
            },
          ],
          aliases: {},
        },
        result: undefined,
      }),
      env,
    );

    // 1. Run alias set with a non-existent repo (user error path)
    const procFail = Bun.spawn(
      [
        "bun",
        "run",
        path.resolve("src/cli.ts"),
        "alias",
        "set",
        "foo",
        "ghost/unknown-repo",
        "--dir",
        root,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, REPOTRUCK_CONFIG_DIR: configDir },
        stderr: "pipe",
        stdout: "pipe",
      },
    );

    const exitCodeFail = await procFail.exited;
    expect(exitCodeFail).toBe(1);

    // Verify lock file does NOT exist on disk
    const lockPath = `${centralStorePath(env)}.lock`;
    expect(existsSync(lockPath)).toBe(false);

    // 2. Immediately run valid alias set command - should succeed without waiting
    const procSuccess = Bun.spawn(
      ["bun", "run", path.resolve("src/cli.ts"), "alias", "set", "foo", "acme/core", "--dir", root],
      {
        cwd: process.cwd(),
        env: { ...process.env, REPOTRUCK_CONFIG_DIR: configDir },
        stderr: "pipe",
        stdout: "pipe",
      },
    );

    const exitCodeSuccess = await procSuccess.exited;
    expect(exitCodeSuccess).toBe(0);

    const finalConfig = await readWorkspaceConfig(root, env);
    expect(finalConfig?.aliases?.foo).toBe("acme/source/core");
  });
});

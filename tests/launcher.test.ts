import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RepotruckConfig } from "../src/services/config.ts";
import {
  type AppEntry,
  BUILTIN_APPS,
  detectApps,
  listAliases,
  loadCustomApps,
  removeAlias,
  resolveApp,
  resolveRepoRef,
  runAppInRepo,
  setAlias,
} from "../src/services/launcher.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sweepTempRoots(roots: string[]): string[] {
  const pending: string[] = [];
  for (const dir of roots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      pending.push(dir);
    }
  }
  return pending;
}

const pendingTempDirs: string[] = [];

afterEach(() => {
  pendingTempDirs.push(...sweepTempRoots(tempRoots));
});

afterAll(() => {
  pendingTempDirs.push(...sweepTempRoots(pendingTempDirs));
  pendingTempDirs.push(...sweepTempRoots(tempRoots));
  for (const dir of pendingTempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* best-effort */
    }
  }
});

function tempConfigDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "repotruck-launcher-"));
  tempRoots.push(dir);
  return dir;
}

const env = { REPOTRUCK_CONFIG_DIR: "" };

function configWith(
  repos: Array<{ owner: string; name: string; relativePath: string }>,
  aliases?: Record<string, string>,
): RepotruckConfig {
  return {
    version: 1,
    root: "C:\\ws",
    preset: "categorized",
    lastSync: null,
    repos: repos.map((item) => ({
      ...item,
      category: "source" as const,
      internal: true,
      language: null,
      updatedAt: null,
    })),
    ...(aliases !== undefined ? { aliases } : {}),
  } as RepotruckConfig;
}

describe("builtin registry", () => {
  test("contains the six builtin apps with their commands", () => {
    const names = BUILTIN_APPS.map((app) => app.name);
    expect(names).toEqual(["claude", "codex", "gemini", "aider", "vscode", "cursor"]);
    expect(BUILTIN_APPS.find((app) => app.name === "vscode")!.command).toBe("code");
  });
});

describe("loadCustomApps", () => {
  test("missing file yields an empty list", async () => {
    const dir = tempConfigDir();
    env.REPOTRUCK_CONFIG_DIR = dir;
    expect(await loadCustomApps(env)).toEqual([]);
  });

  test("corrupt JSON yields an empty list and never throws", async () => {
    const dir = tempConfigDir();
    env.REPOTRUCK_CONFIG_DIR = dir;
    writeFileSync(path.join(dir, "apps.json"), "{ nope", "utf8");
    expect(await loadCustomApps(env)).toEqual([]);
  });

  test("valid entries load, malformed ones are filtered", async () => {
    const dir = tempConfigDir();
    env.REPOTRUCK_CONFIG_DIR = dir;
    const entries: unknown[] = [
      { name: "marker", command: "node", args: ["-e", "console.log(1)"] },
      { name: "broken" },
      { command: "noname" },
      "garbage",
    ];
    writeFileSync(path.join(dir, "apps.json"), JSON.stringify(entries), "utf8");
    const apps = await loadCustomApps(env);
    expect(apps.length).toBe(1);
    expect(apps[0]!.name).toBe("marker");
  });
});

describe("detectApps", () => {
  test("includes builtins found on PATH and misses the rest", async () => {
    const apps = await detectApps({
      whichImpl: async (command) =>
        command === "code" || command === "cursor" ? `C:\\bin\\${command}.cmd` : null,
      customApps: [],
    });
    expect(apps.map((app) => app.name)).toEqual(["vscode", "cursor"]);
  });

  test("custom entries override builtins by name and append new ones", async () => {
    const custom: AppEntry[] = [
      { name: "vscode", command: "code-insiders" },
      { name: "marker", command: "node", args: ["-e", "ok"] },
    ];
    const apps = await detectApps({
      whichImpl: async () => null,
      customApps: custom,
    });
    expect(apps.map((app) => app.name)).toEqual(["vscode", "marker"]);
    expect(apps[0]!.command).toBe("code-insiders");
  });
});

describe("resolveApp", () => {
  test("custom wins before builtin", async () => {
    const resolved = await resolveApp("vscode", {
      customApps: [{ name: "vscode", command: "code-insiders" }],
      whichImpl: async () => "C:\\bin\\code.cmd",
    });
    expect(resolved!.command).toBe("code-insiders");
  });

  test("builtin resolves only when on PATH", async () => {
    expect(
      (await resolveApp("claude", { whichImpl: async () => "C:\\bin\\claude.exe" }))!.command,
    ).toBe("claude");
    expect(await resolveApp("claude", { whichImpl: async () => null })).toBeNull();
  });

  test("bare PATH executable resolves by name", async () => {
    const resolved = await resolveApp("marker", {
      customApps: [],
      whichImpl: async (command) => `C:\\bin\\${command}.exe`,
    });
    expect(resolved).toEqual({ name: "marker", command: "marker", args: [] });
  });

  test("unknown app with nothing on PATH returns null", async () => {
    expect(await resolveApp("nope", { customApps: [], whichImpl: async () => null })).toBeNull();
  });
});

describe("resolveRepoRef", () => {
  const config = configWith(
    [
      { owner: "monalisa", name: "api", relativePath: "monalisa/source/api" },
      { owner: "octocat", name: "hello", relativePath: "community/octocat/source/hello" },
    ],
    { api: "monalisa/source/api" },
  );

  test("alias match wins and is case-insensitive", () => {
    const match = resolveRepoRef(config, "API");
    expect(match!.dir).toBe("monalisa/source/api");
    expect(match!.entry.name).toBe("api");
  });

  test("relative path match is case-insensitive", () => {
    expect(resolveRepoRef(config, "COMMUNITY/OCTOCAT/SOURCE/HELLO")!.dir).toBe(
      "community/octocat/source/hello",
    );
  });

  test("owner/name match works", () => {
    expect(resolveRepoRef(config, "OctoCat/Hello")!.dir).toBe("community/octocat/source/hello");
  });

  test("unknown ref returns null", () => {
    expect(resolveRepoRef(config, "ghost/repo")).toBeNull();
    expect(resolveRepoRef(config, "nothing")).toBeNull();
  });
});

describe("runAppInRepo", () => {
  const config = configWith([{ owner: "acme", name: "api", relativePath: "acme/source/api" }]);
  const app = { name: "marker", command: "node", args: ["-e", "ok"] };

  test("spawns inside the repo dir and returns the exit code", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "repotruck-runapp-"));
    tempRoots.push(root);
    mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
    const seen: string[] = [];
    const result = await runAppInRepo(
      { root, config, ref: "acme/api", app, mode: "foreground" },
      {
        spawnImpl: async (request) => {
          seen.push(request.cwd);
          return 0;
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(seen[0]).toBe(path.join(root, "acme", "source", "api"));
  });

  test("attached-resume invokes onBeforeResume after the app exits", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "repotruck-runapp-"));
    tempRoots.push(root);
    mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
    const order: string[] = [];
    const result = await runAppInRepo(
      {
        root,
        config,
        ref: "acme/api",
        app,
        mode: "attached-resume",
        onBeforeResume: () => {
          order.push("resume");
        },
      },
      {
        spawnImpl: async () => {
          order.push("app");
          return 7;
        },
      },
    );
    expect(order).toEqual(["app", "resume"]);
    expect(result.code).toBe(7);
    expect(result.ok).toBe(false);
  });

  test("unknown ref fails without spawning", async () => {
    let spawned = 0;
    const result = await runAppInRepo(
      { root: "C:\\ws", config, ref: "ghost/repo", app, mode: "foreground" },
      {
        spawnImpl: async () => {
          spawned += 1;
          return 0;
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
    expect(spawned).toBe(0);
  });
});

describe("alias helpers", () => {
  const config = configWith([
    { owner: "acme", name: "api", relativePath: "acme/source/api" },
    { owner: "acme", name: "web", relativePath: "acme/source/web" },
  ]);

  test("setAlias validates the pattern", () => {
    expect(setAlias(config, "-bad", "acme/api").ok).toBe(false);
    expect(setAlias(config, "has space", "acme/api").ok).toBe(false);
  });

  test("setAlias resolves refs and stores the target", () => {
    const result = setAlias(config, "api", "acme/api");
    expect(result.ok).toBe(true);
    expect(result.config.aliases).toEqual({ api: "acme/source/api" });
  });

  test("setAlias rejects a collision with another repo's alias", () => {
    const withAlias = setAlias(config, "api", "acme/api").config;
    const result = setAlias(withAlias, "api", "acme/source/web");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("already used");
  });

  test("setAlias accepts owner/name refs and re-sets the same target", () => {
    const withAlias = setAlias(config, "api", "acme/api").config;
    const again = setAlias(withAlias, "API", "acme/api");
    expect(again.ok).toBe(true);
  });

  test("removeAlias removes and reports unknown aliases", () => {
    const withAlias = setAlias(config, "api", "acme/api").config;
    const removed = removeAlias(withAlias, "API");
    expect(removed.ok).toBe(true);
    expect(removed.config.aliases).toEqual({});
    expect(removeAlias(withAlias, "ghost").ok).toBe(false);
  });

  test("listAliases returns sorted pairs", () => {
    let current = setAlias(config, "zeta", "acme/api").config;
    current = setAlias(current, "alpha", "acme/source/web").config;
    expect(listAliases(current)).toEqual([
      { alias: "alpha", target: "acme/source/web" },
      { alias: "zeta", target: "acme/source/api" },
    ]);
  });
});

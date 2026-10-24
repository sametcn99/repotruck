import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { defaultConfig, type RepotruckConfig, readAgentsMd } from "../src/services/config.ts";
import {
  type CreateOptions,
  createRepository,
  defaultGitSeam,
  type GitSeam,
  validateCreateName,
} from "../src/services/creator.ts";
import type { CreateRepoOptions, GitHubRepoCreator, RepoInfo } from "../src/services/github.ts";
import { readWorkspaceConfig } from "../src/services/workspaceRegistry.ts";

const tempRoots: string[] = [];
let configDir: string;
let savedConfigDir: string | undefined;

const savedGitEnv: Record<string, string | undefined> = {};
const GIT_ENV_KEYS = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  configDir = tempDir("repotruck-create-cfg-");
  process.env.REPOTRUCK_CONFIG_DIR = configDir;
  for (const key of GIT_ENV_KEYS) {
    savedGitEnv[key] = process.env[key];
    process.env[key] = "repotruck-test";
  }
  process.env.GIT_AUTHOR_EMAIL = "repotruck-test@localhost";
  process.env.GIT_COMMITTER_EMAIL = "repotruck-test@localhost";
});

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  for (const key of GIT_ENV_KEYS) {
    if (savedGitEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedGitEnv[key];
    }
  }
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

interface CreateRepoCall {
  name: string;
  options: CreateRepoOptions;
}

function stubGithub(
  impl?: (call: CreateRepoCall) => Promise<RepoInfo>,
): GitHubRepoCreator & { calls: CreateRepoCall[] } {
  const calls: CreateRepoCall[] = [];
  return {
    calls,
    createRepo: async (name: string, options: CreateRepoOptions) => {
      calls.push({ name, options });
      if (impl !== undefined) return impl({ name, options });
      return {
        owner: options.org ?? "monalisa",
        name,
        description: options.description ?? null,
        isPrivate: options.private,
        isFork: false,
        isArchived: false,
        language: null,
        httpsUrl: `https://github.com/${options.org ?? "monalisa"}/${name}.git`,
        sshUrl: `git@github.com:${options.org ?? "monalisa"}/${name}.git`,
        updatedAt: null,
      };
    },
  };
}

interface PushCall {
  dir: string;
  token: string | null;
}

function testGitSeam(overrides: Partial<GitSeam> = {}): GitSeam & { pushes: PushCall[] } {
  const pushes: PushCall[] = [];
  return {
    pushes,
    ...defaultGitSeam,
    pushMain: async (dir: string, token: string | null) => {
      pushes.push({ dir, token });
    },
    ...overrides,
  };
}

describe("validateCreateName", () => {
  test("accepts valid repository names", () => {
    expect(validateCreateName("api")).toBe("api");
    expect(validateCreateName("my.repo")).toBe("my.repo");
    expect(validateCreateName("a-b_c.d")).toBe("a-b_c.d");
    expect(validateCreateName("A9")).toBe("A9");
  });

  test("rejects invalid repository names", () => {
    expect(validateCreateName("")).toBeNull();
    expect(validateCreateName("-api")).toBeNull();
    expect(validateCreateName("api-")).toBeNull();
    expect(validateCreateName(".api")).toBeNull();
    expect(validateCreateName("api.")).toBeNull();
    expect(validateCreateName("a b")).toBeNull();
    expect(validateCreateName("a/b")).toBeNull();
    expect(validateCreateName("a:b")).toBeNull();
    expect(validateCreateName("a".repeat(101))).toBeNull();
    expect(validateCreateName("a".repeat(100))).toBe("a".repeat(100));
  });
});

function makeRoot(preset: "categorized" | "flat-by-owner" = "categorized"): {
  root: string;
  config: ReturnType<typeof defaultConfig>;
} {
  const root = tempDir("repotruck-create-ws-");
  return { root, config: defaultConfig(root, preset) };
}

async function runCreate(
  root: string,
  config: ReturnType<typeof defaultConfig>,
  options: Partial<CreateOptions>,
  github: GitHubRepoCreator,
  token: string | null = null,
  seam?: GitSeam,
) {
  return createRepository({
    root,
    config,
    github,
    token,
    userLogin: "monalisa",
    orgs: [],
    options: { name: "api", isPrivate: true, ...options },
    git: seam ?? testGitSeam(),
  });
}

describe("createRepository placement", () => {
  test("preset default placement for the user login", async () => {
    const { root, config } = makeRoot("categorized");
    const github = stubGithub();
    const result = await runCreate(root, config, { name: "api" }, github);
    expect(result.ok).toBe(true);
    expect(result.relativePath).toBe("monalisa/source/api");
    expect(existsSync(path.join(root, "monalisa", "source", "api", ".git"))).toBe(true);
    const saved = await readWorkspaceConfig(root);
    const created = saved!.repos.find((item) => item.name === "api");
    expect(created!.internal).toBe(true);
    expect(created!.custom).toBeUndefined();
    expect(github.calls.length).toBe(1);
    expect(github.calls[0]!.options.private).toBe(true);
  });

  test("org repos are placed internal under the org", async () => {
    const { root, config } = makeRoot("flat-by-owner");
    const github = stubGithub();
    const result = await runCreate(root, config, { name: "svc", org: "acme-org" }, github);
    expect(result.ok).toBe(true);
    expect(result.relativePath).toBe("acme-org/svc");
    const saved = await readWorkspaceConfig(root);
    const created = saved!.repos.find((item) => item.name === "svc");
    expect(created!.owner).toBe("acme-org");
    expect(created!.internal).toBe(true);
  });

  test("customPath is validated, sanitized and flagged custom", async () => {
    const { root, config } = makeRoot("categorized");
    const result = await runCreate(
      root,
      config,
      { name: "api", customPath: "Custom:Path/api" },
      stubGithub(),
    );
    expect(result.ok).toBe(true);
    expect(result.relativePath).toBe("Custom-Path/api");
    const saved = await readWorkspaceConfig(root);
    const created = saved!.repos.find((item) => item.name === "api");
    expect(created!.custom).toBe(true);
  });

  test("invalid customPath fails without calling GitHub", async () => {
    const { root, config } = makeRoot("categorized");
    const github = stubGithub();
    const result = await runCreate(root, config, { name: "api", customPath: "../escape" }, github);
    expect(result.ok).toBe(false);
    expect(github.calls.length).toBe(0);
  });

  test("invalid name fails without calling GitHub", async () => {
    const { root, config } = makeRoot("categorized");
    const github = stubGithub();
    const result = await runCreate(root, config, { name: "-bad" }, github);
    expect(result.ok).toBe(false);
    expect(github.calls.length).toBe(0);
  });

  test("destination collision on disk fails", async () => {
    const { root, config } = makeRoot("categorized");
    mkdirSync(path.join(root, "monalisa", "source", "api"), { recursive: true });
    const github = stubGithub();
    const result = await runCreate(root, config, { name: "api" }, github);
    expect(result.ok).toBe(false);
    expect(github.calls.length).toBe(0);
  });

  test("GitHub name conflict surfaces the contract message", async () => {
    const { root, config } = makeRoot("categorized");
    const github = stubGithub(() => {
      throw new Error("name already exists on GitHub");
    });
    const result = await runCreate(root, config, { name: "api" }, github);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("name already exists on GitHub");
  });
});

describe("createRepository push hygiene", () => {
  test("remote origin stays credential-free and the token never reaches disk", async () => {
    const { root, config } = makeRoot("categorized");
    const seam = testGitSeam();
    const result = await runCreate(
      root,
      config,
      { name: "api" },
      stubGithub(),
      "tok_secret_123",
      seam,
    );
    expect(result.ok).toBe(true);
    expect(seam.pushes.length).toBe(1);
    const destDir = result.destDir!;
    const remote = await simpleGit(destDir).raw(["remote", "get-url", "origin"]);
    expect(remote.trim()).toBe("https://github.com/monalisa/api.git");
    expect(remote.includes("tok_secret_123")).toBe(false);
    const configRaw = await readWorkspaceConfig(root);
    expect(JSON.stringify(configRaw).includes("tok_secret_123")).toBe(false);
    const agents = await readAgentsMd(root);
    expect(agents!.includes("tok_secret_123")).toBe(false);
  });
});

describe("createRepository import rules", () => {
  test("source already tracked by repotruck fails", async () => {
    const { root, config } = makeRoot("categorized");
    const trackedDir = path.join(root, "monalisa", "source", "existing");
    mkdirSync(trackedDir, { recursive: true });
    const withEntry: RepotruckConfig = {
      ...config,
      repos: [
        {
          owner: "monalisa",
          name: "existing",
          relativePath: "monalisa/source/existing",
          category: "source",
          internal: true,
          language: null,
          updatedAt: null,
        },
      ],
    };
    const github = stubGithub();
    const result = await runCreate(
      root,
      withEntry,
      { name: "moved-in", fromDir: trackedDir },
      github,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("already tracked");
    expect(github.calls.length).toBe(0);
  });

  test("dirty git tree fails before GitHub is called", async () => {
    const fromDir = tempDir("repotruck-import-dirty-");
    const git = simpleGit(fromDir);
    await git.raw(["init", "-b", "main"]);
    writeFileSync(path.join(fromDir, "a.txt"), "one", "utf8");
    await git.raw(["add", "-A"]);
    await git.raw(["commit", "-m", "init"]);
    writeFileSync(path.join(fromDir, "b.txt"), "two", "utf8");

    const { root, config } = makeRoot("categorized");
    const github = stubGithub();
    const result = await runCreate(
      root,
      config,
      { name: "imported", fromDir },
      github,
      null,
      testGitSeam(),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("commit or stash first");
    expect(github.calls.length).toBe(0);
  });

  test("plain directory is initialized, committed, pushed and moved into place", async () => {
    const fromDir = tempDir("repotruck-import-plain-");
    writeFileSync(path.join(fromDir, "main.ts"), "export {};", "utf8");
    mkdirSync(path.join(fromDir, "lib"), { recursive: true });
    writeFileSync(path.join(fromDir, "lib", "util.ts"), "export {};", "utf8");

    const { root, config } = makeRoot("categorized");
    const github = stubGithub();
    const seam = testGitSeam();
    const result = await runCreate(root, config, { name: "imported", fromDir }, github, null, seam);
    expect(result.ok).toBe(true);
    expect(github.calls.length).toBe(1);
    expect(seam.pushes.length).toBe(1);

    const destDir = result.destDir!;
    expect(existsSync(path.join(destDir, "main.ts"))).toBe(true);
    expect(existsSync(path.join(destDir, "lib", "util.ts"))).toBe(true);
    expect(existsSync(path.join(destDir, ".git"))).toBe(true);
    expect(existsSync(fromDir)).toBe(false);

    const git = simpleGit(destDir);
    const log = await git.raw(["log", "--oneline"]);
    expect(log).toContain("Initial commit");
    const remote = await git.raw(["remote", "get-url", "origin"]);
    expect(remote.trim()).toBe("https://github.com/monalisa/imported.git");

    const saved = await readWorkspaceConfig(root);
    const imported = saved!.repos.find((item) => item.name === "imported");
    expect(imported!.relativePath).toBe("monalisa/source/imported");
    expect(imported!.internal).toBe(true);
    expect(saved!.lastSync).not.toBeNull();
    const agents = await readAgentsMd(root);
    expect(agents).toContain("monalisa/source/imported");
  });
});

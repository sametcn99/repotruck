import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GitHubRepoReader, RepoInfo } from "../src/services/github.ts";
import {
  cloneSingleRepository,
  GITHUB_HOST,
  isGheUrl,
  parseGitUrl,
} from "../src/services/singleCloner.ts";
import { loadWorkspace } from "../src/services/workspace.ts";

const tempRoots: string[] = [];
let configTempDir: string | undefined;
let savedConfigDir: string | undefined;

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  configTempDir = mkdtempSync(path.join(tmpdir(), "repotruck-singleclone-cfg-"));
  process.env.REPOTRUCK_CONFIG_DIR = configTempDir;
});

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  if (configTempDir !== undefined) {
    try {
      rmSync(configTempDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup error in tests */
    }
  }
});

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* ignore cleanup error in tests */
    }
  }
});

function initLocalGitRepo(name = "test-repo"): string {
  const repoDir = makeTempDir(`repotruck-git-source-${name}-`);
  execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test Runner"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repoDir,
    stdio: "ignore",
  });
  writeFileSync(path.join(repoDir, "README.md"), "# Hello from local source\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: repoDir, stdio: "ignore" });
  return repoDir;
}

describe("singleCloner - URL Parsing and GHE detection (Hermetic)", () => {
  test("isGheUrl identifies enterprise hosts vs public github.com", () => {
    const gheHosts = ["github.com", "ghe.corp.internal", "git.enterprise.net"];

    expect(isGheUrl("https://github.com/octocat/hello", [GITHUB_HOST])).toBe(false);
    expect(isGheUrl("https://github.com/octocat/hello", gheHosts)).toBe(false);
    expect(isGheUrl("https://ghe.corp.internal/org/repo.git", gheHosts)).toBe(true);
    expect(isGheUrl("git@git.enterprise.net:org/repo.git", gheHosts)).toBe(true);
    expect(isGheUrl("git.enterprise.net/org/repo", gheHosts)).toBe(true);
    expect(isGheUrl("https://unknown.com/org/repo", gheHosts)).toBe(false);
    expect(isGheUrl("invalid-string", gheHosts)).toBe(false);
    expect(isGheUrl("justaname/repo", gheHosts)).toBe(false);
    expect(isGheUrl("https://ghe.corp.internal/org/repo", [GITHUB_HOST])).toBe(false);
  });

  test("parseGitUrl handles HTTPS, SCP, short-form and 3-segment URLs", () => {
    const hosts = [GITHUB_HOST, "ghe.internal"];

    // Empty / whitespace
    expect(parseGitUrl("")).toBeNull();
    expect(parseGitUrl("   ")).toBeNull();

    // Standard GitHub HTTPS
    expect(parseGitUrl("https://github.com/octocat/Hello-World.git")).toEqual({
      owner: "octocat",
      name: "Hello-World",
    });
    expect(parseGitUrl("https://github.com/octocat/Hello-World")).toEqual({
      owner: "octocat",
      name: "Hello-World",
    });

    // SCP syntax
    expect(parseGitUrl("git@github.com:octocat/Hello-World.git")).toEqual({
      owner: "octocat",
      name: "Hello-World",
    });

    // 2-segment short form
    expect(parseGitUrl("sametcn99/repotruck")).toEqual({
      owner: "sametcn99",
      name: "repotruck",
    });

    // 3-segment form
    expect(parseGitUrl("github.com/sametcn99/repotruck")).toEqual({
      owner: "sametcn99",
      name: "repotruck",
    });

    // Enterprise host
    expect(parseGitUrl("https://ghe.internal/enterprise-org/core-service.git", hosts)).toEqual({
      owner: "enterprise-org",
      name: "core-service",
    });
    expect(parseGitUrl("git@ghe.internal:enterprise-org/core-service.git", hosts)).toEqual({
      owner: "enterprise-org",
      name: "core-service",
    });
    expect(parseGitUrl("ghe.internal/enterprise-org/core-service", hosts)).toEqual({
      owner: "enterprise-org",
      name: "core-service",
    });

    // Disallowed host
    expect(parseGitUrl("https://evil.com/org/repo")).toBeNull();
    expect(parseGitUrl("git@evil.com:org/repo.git")).toBeNull();

    // Invalid path segments or formats
    expect(parseGitUrl("https://github.com/onlyone")).toBeNull();
    expect(parseGitUrl("https://github.com/a/b/c")).toBeNull();
    expect(parseGitUrl("https://")).toBeNull();
    expect(parseGitUrl("-invalid-owner/repo")).toBeNull();
    expect(parseGitUrl("owner/?invalid")).toBeNull();
    expect(parseGitUrl("git@github.com::broken")).toBeNull();
    expect(parseGitUrl("a/b/c/d")).toBeNull();
  });
});

describe("cloneSingleRepository (Hermetic Local Git)", () => {
  test("C22: successfully clones a local repository into workspace and registers in inventory", async () => {
    const sourceRepoDir = initLocalGitRepo("local-source");
    const workspaceRoot = makeTempDir("repotruck-singleclone-ws-");

    const mockRepo: RepoInfo = {
      owner: "acme",
      name: "local-source",
      isPrivate: false,
      isArchived: false,
      isFork: false,
      description: "Local hermetic source repository",
      language: "TypeScript",
      updatedAt: new Date().toISOString(),
      stars: 42,
      httpsUrl: sourceRepoDir,
      sshUrl: sourceRepoDir,
    };

    const mockGithub: GitHubRepoReader = {
      getRepo: async (owner: string, name: string) => {
        expect(owner).toBe("acme");
        expect(name).toBe("local-source");
        return mockRepo;
      },
    };

    const progressEvents: string[] = [];
    const result = await cloneSingleRepository("acme/local-source", {
      root: workspaceRoot,
      github: mockGithub,
      userLogin: "acme",
      orgs: ["acme-org"],
      preferSsh: false,
      emit: (progress) => {
        progressEvents.push(progress.phase);
      },
    });

    expect(result.internal).toBe(true);
    expect(result.repo.name).toBe("local-source");
    expect(result.progress.phase).toBe("done");
    expect(existsSync(result.destDir)).toBe(true);
    expect(existsSync(path.join(result.destDir, "README.md"))).toBe(true);
    expect(readFileSync(path.join(result.destDir, "README.md"), "utf8")).toContain(
      "Hello from local source",
    );

    // Verify workspace inventory updated
    const ws = await loadWorkspace(workspaceRoot);
    const tracked = ws.repos.find((e) => e.owner === "acme" && e.name === "local-source");
    expect(tracked).toBeDefined();
    expect(tracked?.internal).toBe(true);
    expect(progressEvents).toContain("done");
  });

  test("clones and updates cleanly when GIT_CONFIG_COUNT token auth is active", async () => {
    const sourceRepoDir = initLocalGitRepo("authed-source");
    const workspaceRoot = makeTempDir("repotruck-authed-ws-");

    const mockRepo: RepoInfo = {
      owner: "oven-sh",
      name: "setup-bun",
      isPrivate: false,
      isArchived: false,
      isFork: false,
      description: "Authed clone regression test",
      language: "TypeScript",
      updatedAt: new Date().toISOString(),
      stars: 730,
      httpsUrl: sourceRepoDir,
      sshUrl: sourceRepoDir,
    };

    const mockGithub: GitHubRepoReader = {
      getRepo: async () => mockRepo,
    };

    const first = await cloneSingleRepository("oven-sh/setup-bun", {
      root: workspaceRoot,
      github: mockGithub,
      userLogin: "myuser",
      orgs: [],
      token: "gho_test_token_12345",
      preferSsh: false,
    });
    expect(first.progress.phase).toBe("done");
    expect(existsSync(path.join(first.destDir, "README.md"))).toBe(true);

    // Second run exercises updateRepository (fetch/pull) with GIT_CONFIG_COUNT enabled
    const second = await cloneSingleRepository("oven-sh/setup-bun", {
      root: workspaceRoot,
      github: mockGithub,
      userLogin: "myuser",
      orgs: [],
      token: "gho_test_token_12345",
      preferSsh: false,
    });
    expect(second.progress.phase).toBe("done");
  });

  test("C22: external repository is marked non-internal and routed to community prefix", async () => {
    const sourceRepoDir = initLocalGitRepo("external-lib");
    const workspaceRoot = makeTempDir("repotruck-ext-ws-");

    const mockRepo: RepoInfo = {
      owner: "external-author",
      name: "external-lib",
      isPrivate: false,
      isArchived: false,
      isFork: false,
      description: "External open-source repository",
      language: "JavaScript",
      updatedAt: new Date().toISOString(),
      stars: 10,
      httpsUrl: sourceRepoDir,
      sshUrl: sourceRepoDir,
    };

    const mockGithub: GitHubRepoReader = {
      getRepo: async () => mockRepo,
    };

    const result = await cloneSingleRepository("external-author/external-lib", {
      root: workspaceRoot,
      github: mockGithub,
      userLogin: "myuser",
      orgs: ["myorg"],
    });

    expect(result.internal).toBe(false);
    expect(result.destDir.replace(/\\/g, "/")).toContain("community");
    expect(existsSync(path.join(result.destDir, "README.md"))).toBe(true);

    const ws = await loadWorkspace(workspaceRoot);
    const tracked = ws.repos.find(
      (e) => e.owner === "external-author" && e.name === "external-lib",
    );
    expect(tracked).toBeDefined();
    expect(tracked?.internal).toBe(false);
  });

  test("rejects invalid URL with descriptive Error", async () => {
    const workspaceRoot = makeTempDir("repotruck-invalid-url-ws-");
    const mockGithub: GitHubRepoReader = {
      getRepo: async () => {
        throw new Error("Should not be called for invalid URL");
      },
    };

    await expect(
      cloneSingleRepository("not-a-valid-url@@", {
        root: workspaceRoot,
        github: mockGithub,
        userLogin: "user",
        orgs: [],
      }),
    ).rejects.toThrow("invalid GitHub repository URL: not-a-valid-url@@");
  });

  test("throws when git clone fails (e.g. invalid target remote)", async () => {
    const workspaceRoot = makeTempDir("repotruck-fail-clone-ws-");
    const nonExistentPath = path.join(workspaceRoot, "does-not-exist");

    const mockRepo: RepoInfo = {
      owner: "acme",
      name: "broken-repo",
      isPrivate: false,
      isArchived: false,
      isFork: false,
      description: "Broken repository",
      language: "TypeScript",
      updatedAt: new Date().toISOString(),
      stars: 0,
      httpsUrl: nonExistentPath,
      sshUrl: nonExistentPath,
    };

    const mockGithub: GitHubRepoReader = {
      getRepo: async () => mockRepo,
    };

    await expect(
      cloneSingleRepository("acme/broken-repo", {
        root: workspaceRoot,
        github: mockGithub,
        userLogin: "acme",
        orgs: [],
      }),
    ).rejects.toThrow();
  });

  test("GHE URL forces preferSsh to false", async () => {
    const sourceRepoDir = initLocalGitRepo("ghe-service");
    const workspaceRoot = makeTempDir("repotruck-ghe-ws-");
    const hosts = [GITHUB_HOST, "ghe.internal"];

    const mockRepo: RepoInfo = {
      owner: "corp",
      name: "ghe-service",
      isPrivate: true,
      isArchived: false,
      isFork: false,
      description: "Enterprise service",
      language: "Go",
      updatedAt: new Date().toISOString(),
      stars: 5,
      httpsUrl: sourceRepoDir,
      sshUrl: sourceRepoDir,
    };

    const mockGithub: GitHubRepoReader = {
      getRepo: async () => mockRepo,
    };

    const result = await cloneSingleRepository("https://ghe.internal/corp/ghe-service", {
      root: workspaceRoot,
      github: mockGithub,
      userLogin: "corp",
      orgs: [],
      hosts,
      preferSsh: true, // Should be overridden to false for GHE
    });

    expect(result.progress.phase).toBe("done");
    expect(existsSync(path.join(result.destDir, "README.md"))).toBe(true);
  });
});

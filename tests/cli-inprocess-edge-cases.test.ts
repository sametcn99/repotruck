import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { buildCliProgram } from "../src/cli/index.ts";
import type { CliContext } from "../src/cli/shared.ts";
import type { GitHubService, RepoInfo } from "../src/services/github.ts";
import { updateWorkspace } from "../src/services/workspace.ts";

const tempDirs: string[] = [];
let savedConfigDir: string | undefined;
let savedToken: string | undefined;
let savedNoUpdate: string | undefined;
let savedVerbose: string | undefined;
let isolatedConfigDir = "";

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function toFileUrl(absDir: string): string {
  return `file:///${absDir.replace(/\\/g, "/")}`;
}

async function createBareRemote(prefix: string): Promise<{ bareDir: string; fileUrl: string }> {
  const bareDir = makeTempDir(`${prefix}-bare-`);
  const srcDir = makeTempDir(`${prefix}-src-`);
  const git = simpleGit(srcDir);
  await git.init(["-b", "main"]);
  await git.addConfig("user.email", "cli@repotruck.test");
  await git.addConfig("user.name", "CLI Test");
  writeFileSync(
    path.join(srcDir, "index.ts"),
    "export function greetHello() { return 42; }\n",
    "utf8",
  );
  await git.add(".");
  await git.commit("initial");
  await simpleGit().raw(["clone", "--bare", srcDir, bareDir]);
  return { bareDir, fileUrl: toFileUrl(bareDir) };
}

interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], overrides: Partial<CliContext> = {}): Promise<CliRunResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const _prevExitCode = process.exitCode;
  process.exitCode = 0;

  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;

  try {
    const program = await buildCliProgram(overrides);
    program.exitOverride();
    await program.parseAsync(["node", "repotruck", ...args]);
  } catch (err) {
    const code = (err as { exitCode?: number }).exitCode;
    if (typeof code === "number") {
      process.exitCode = code;
    } else {
      throw err;
    }
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }

  const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  process.exitCode = 0;
  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    exitCode,
  };
}

function makeFakeGithub(
  remotes: Record<string, string>,
  deletedKeys = new Set<string>(),
): Partial<CliContext> {
  const repoInfoFor = (owner: string, name: string): RepoInfo => {
    const key = `${owner}/${name}`;
    const url = remotes[key] ?? `https://github.com/${owner}/${name}.git`;
    return {
      owner,
      name,
      description: `${name} service`,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      language: "TypeScript",
      httpsUrl: url,
      sshUrl: url,
      updatedAt: "2026-01-01T00:00:00.000Z",
      stars: 25,
    };
  };

  const fakeService = {
    getUserLogin: async () => "acme",
    getActiveOrgs: async () => ["acme-org"],
    listUserRepos: async () => [repoInfoFor("acme", "api"), repoInfoFor("acme", "web")],
    listOrgRepos: async (org: string) => [repoInfoFor(org, "platform")],
    getRepo: async (owner: string, name: string) => {
      if (deletedKeys.has(`${owner}/${name}`)) {
        throw Object.assign(new Error("Not Found"), { status: 404 });
      }
      return repoInfoFor(owner, name);
    },
    getRepoRemoteHealth: async () => ({
      defaultBranch: "main",
      openPrs: 3,
      ciState: "success" as const,
    }),
    searchRepos: async (query: string, limit: number) => {
      if (query.includes("nomatch")) return [];
      return [repoInfoFor("acme", "api")].slice(0, limit);
    },
    createRepo: async (
      name: string,
      options: { org?: string; private: boolean; description?: string },
    ) => {
      if (name === "already-exists") {
        throw new Error("name already exists on GitHub");
      }
      const owner = options.org ?? "acme";
      return {
        ...repoInfoFor(owner, name),
        isPrivate: options.private,
        description: options.description ?? null,
      };
    },
    archiveRepo: async (owner: string, name: string) => ({
      ...repoInfoFor(owner, name),
      isArchived: true,
    }),
  } as unknown as GitHubService;

  return {
    requireAuth: async () => ({ token: "", method: "env" }),
    buildGithub: () => fakeService,
  };
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  savedToken = process.env.REPOTRUCK_TOKEN;
  savedNoUpdate = process.env.REPOTRUCK_NO_UPDATE_CHECK;
  savedVerbose = process.env.REPOTRUCK_VERBOSE;
  isolatedConfigDir = makeTempDir("rt-cli-inproc-cfg-");
  process.env.REPOTRUCK_CONFIG_DIR = isolatedConfigDir;
  process.env.REPOTRUCK_TOKEN = "ghp_inprocess_test_token";
});

afterAll(() => {
  if (savedConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;

  if (savedToken === undefined) delete process.env.REPOTRUCK_TOKEN;
  else process.env.REPOTRUCK_TOKEN = savedToken;

  if (savedNoUpdate === undefined) delete process.env.REPOTRUCK_NO_UPDATE_CHECK;
  else process.env.REPOTRUCK_NO_UPDATE_CHECK = savedNoUpdate;

  if (savedVerbose === undefined) delete process.env.REPOTRUCK_VERBOSE;
  else process.env.REPOTRUCK_VERBOSE = savedVerbose;

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(() => {
  process.exitCode = 0;
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
});

describe("in-process CLI settings, root, presets, auth, update, doctor, and completions", () => {
  test("config get/set/unset/list and boundary validation", async () => {
    const wsRoot = makeTempDir("rt-cli-cfgroot-");

    // Unknown action & missing/unknown keys
    expect((await runCli(["config", "bogus"])).exitCode).toBe(1);
    expect((await runCli(["config", "list", "extra-arg"])).exitCode).toBe(1);
    expect((await runCli(["config", "get"])).exitCode).toBe(1);
    expect((await runCli(["config", "get", "unknown.key"])).exitCode).toBe(1);
    expect((await runCli(["config", "set", "theme"])).exitCode).toBe(1);

    // Invalid values per key
    expect((await runCli(["config", "set", "defaultRoot", "relative/path"])).exitCode).toBe(1);
    expect((await runCli(["config", "set", "sync.concurrency", "3.5"])).exitCode).toBe(1);
    expect((await runCli(["config", "set", "sync.depth", "0"])).exitCode).toBe(1);
    expect((await runCli(["config", "set", "sync.blobless", "maybe"])).exitCode).toBe(1);
    expect((await runCli(["config", "set", "sync.divergence", "fast-forward"])).exitCode).toBe(1);
    expect(
      (await runCli(["config", "set", "github.baseUrl", "http://insecure.local"])).exitCode,
    ).toBe(1);
    expect((await runCli(["config", "set", "theme", "neon"])).exitCode).toBe(1);

    // Valid sets across all keys
    expect((await runCli(["config", "set", "defaultRoot", wsRoot])).exitCode).toBe(0);
    expect((await runCli(["config", "set", "sync.concurrency", "5"])).exitCode).toBe(0);
    expect((await runCli(["config", "set", "sync.depth", "2"])).exitCode).toBe(0);
    expect((await runCli(["config", "set", "sync.blobless", "true"])).exitCode).toBe(0);
    expect((await runCli(["config", "set", "sync.stash", "true"])).exitCode).toBe(0);
    expect((await runCli(["config", "set", "sync.divergence", "skip"])).exitCode).toBe(0);
    expect(
      (await runCli(["config", "set", "github.baseUrl", "https://ghe.corp.com"])).exitCode,
    ).toBe(0);
    expect((await runCli(["config", "set", "theme", "contrast"])).exitCode).toBe(0);

    const listed = await runCli(["config", "list"]);
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain("sync.concurrency: 5 (settings)");
    expect(listed.stdout).toContain("theme: contrast (settings)");
    expect(listed.stdout).toContain("https://ghe.corp.com/api/v3");

    const got = await runCli(["config", "get", "sync.divergence"]);
    expect(got.stdout).toContain("sync.divergence: skip (settings)");

    // Unset keys back to defaults
    for (const k of [
      "defaultRoot",
      "sync.concurrency",
      "sync.depth",
      "sync.blobless",
      "sync.stash",
      "sync.divergence",
      "github.baseUrl",
      "theme",
    ]) {
      expect((await runCli(["config", "unset", k])).exitCode).toBe(0);
    }
  });

  test("root show/set/reset and preset list/add/remove", async () => {
    const customRoot = makeTempDir("rt-cli-rootcmd-");

    expect((await runCli(["root", "relative/bad"])).exitCode).toBe(1);
    expect((await runCli(["root", customRoot, "--reset"])).exitCode).toBe(1);

    const setRes = await runCli(["root", customRoot]);
    expect(setRes.exitCode).toBe(0);
    const showOverride = await runCli(["root"]);
    expect(showOverride.stdout).toContain("(settings override)");

    const resetRes = await runCli(["root", "--reset"]);
    expect(resetRes.exitCode).toBe(0);
    const showDefault = await runCli(["root"]);
    expect(showDefault.stdout).toContain("(OS default)");

    // Presets: built-in shadowing & missing final `name` rejected
    const listEmpty = await runCli(["preset", "list"]);
    expect(listEmpty.stdout).toContain("categorized (built-in)");
    expect(listEmpty.stdout).toContain("no custom presets");

    expect((await runCli(["preset", "add", "flat", "name"])).exitCode).toBe(1);
    expect((await runCli(["preset", "add", "bad-order", "name", "owner"])).exitCode).toBe(1);

    expect(
      (await runCli(["preset", "add", "lang-owner", "language", "owner", "name"])).exitCode,
    ).toBe(0);
    const listCustom = await runCli(["preset", "list"]);
    expect(listCustom.stdout).toContain("lang-owner -> language/owner/name");

    expect((await runCli(["preset", "remove", "nonexistent"])).exitCode).toBe(1);
    expect((await runCli(["preset", "remove", "lang-owner"])).exitCode).toBe(0);
  });

  test("auth status/login/logout, update disabled, doctor --json, and completions + __complete", async () => {
    // Auth with REPOTRUCK_TOKEN set
    const authStatus = await runCli(["auth", "status", "--json"]);
    expect(authStatus.exitCode).toBe(0);
    expect(JSON.parse(authStatus.stdout).method).toBe("env");

    const loginEnv = await runCli(["auth", "login"]);
    expect(loginEnv.stdout).toContain("already logged in (method: env)");

    const logoutNone = await runCli(["auth", "logout"]);
    expect(logoutNone.stdout).toContain("no cached login");

    // Update with REPOTRUCK_NO_UPDATE_CHECK=1
    process.env.REPOTRUCK_NO_UPDATE_CHECK = "1";
    const updText = await runCli(["update"]);
    expect(updText.exitCode).toBe(0);
    expect(updText.stdout).toContain("disabled");
    const updJson = await runCli(["update", "--json"]);
    expect(JSON.parse(updJson.stdout).disabled).toBe(true);
    delete process.env.REPOTRUCK_NO_UPDATE_CHECK;

    // Doctor text & JSON
    const docJson = await runCli(["doctor", "--json"]);
    const docPayload = JSON.parse(docJson.stdout);
    expect(docPayload.command).toBe("doctor");
    expect(Array.isArray(docPayload.checks)).toBe(true);

    // Completions & hidden __complete helpers
    expect((await runCli(["completions", "cmd.exe"])).exitCode).toBe(1);
    for (const sh of ["bash", "zsh", "fish", "powershell"]) {
      const comp = await runCli(["completions", sh]);
      expect(comp.exitCode).toBe(0);
      expect(comp.stdout.length).toBeGreaterThan(50);
    }
    for (const sub of ["presets", "apps", "aliases", "scopes", "kinds", "langs", "divergence"]) {
      const res = await runCli(["__complete", sub]);
      expect(res.exitCode).toBe(0);
    }
  });
});

describe("in-process CLI workspace lifecycle, sync, clone, create, discover, scan, status, run, search-code, trash, backup", () => {
  test("sync, clone, create, discover, and status --remote with hermetic GitHub + local Git", async () => {
    const wsRoot = makeTempDir("rt-cli-fullws-");
    const apiRemote = await createBareRemote("rt-cli-api");
    const webRemote = await createBareRemote("rt-cli-web");
    const createdRemote = await createBareRemote("rt-cli-created");

    const ctx = makeFakeGithub(
      {
        "acme/api": apiRemote.fileUrl,
        "acme/web": webRemote.fileUrl,
        "acme/new-svc": createdRemote.fileUrl,
      },
      new Set(["acme/deleted-repo"]),
    );

    // Sync validation errors (--json and text)
    expect((await runCli(["sync", "--scope", "bad-scope", "--json"], ctx)).exitCode).toBe(1);
    expect((await runCli(["sync", "--divergence", "wrong"], ctx)).exitCode).toBe(1);
    expect((await runCli(["sync", "--limit", "0"], ctx)).exitCode).toBe(1);
    expect((await runCli(["sync", "--preset", "missing-preset", "-d", wsRoot], ctx)).exitCode).toBe(
      1,
    );

    // Sync with non-matching filter -> 0 matched
    const syncFilteredOut = await runCli(
      ["sync", "-d", wsRoot, "--include", "nobody/*", "--json"],
      ctx,
    );
    expect(syncFilteredOut.exitCode).toBe(0);
    expect(JSON.parse(syncFilteredOut.stdout).summary.synced).toBe(0);

    // Real bulk sync (`acme/api` + `acme/web`) with --json
    const syncOk = await runCli(["sync", "-d", wsRoot, "--preset", "categorized", "--json"], ctx);
    expect(syncOk.exitCode).toBe(0);
    const syncPayload = JSON.parse(syncOk.stdout);
    expect(syncPayload.summary).toEqual({ synced: 2, skipped: 0, failed: 0 });
    expect(existsSync(path.join(wsRoot, "acme", "source", "api", ".git"))).toBe(true);

    // Clone single repo (`acme/api` already exists -> updates cleanly)
    const cloneJson = await runCli(["clone", "acme/api", "-d", wsRoot, "--json"], ctx);
    expect(cloneJson.exitCode).toBe(0);
    expect(JSON.parse(cloneJson.stdout).ok).toBe(true);

    // Discover (no match, text match, --json + --clone, and invalid --min-stars)
    expect((await runCli(["discover", "cli", "--min-stars", "-1"], ctx)).exitCode).toBe(1);
    const discNone = await runCli(["discover", "nomatch"], ctx);
    expect(discNone.stdout).toContain("no repositories matched");

    const discText = await runCli(
      ["discover", "api", "--org", "acme", "--lang", "TypeScript", "--topic", "cli"],
      ctx,
    );
    expect(discText.exitCode).toBe(0);
    expect(discText.stdout).toContain("acme/api");

    const discCloneJson = await runCli(["discover", "api", "-d", wsRoot, "--clone", "--json"], ctx);
    expect(discCloneJson.exitCode).toBe(0);
    expect(JSON.parse(discCloneJson.stdout).clone.synced).toBe(1);

    // Status (normal, --detail, --filter, --remote, --check on dirty repo)
    writeFileSync(path.join(wsRoot, "acme", "source", "api", "dirty.txt"), "untracked\n", "utf8");
    writeFileSync(
      path.join(wsRoot, "acme", "source", "api", "index.ts"),
      "export const x = 2;\n",
      "utf8",
    );

    const statusDetail = await runCli(["status", "-d", wsRoot, "--detail", "--remote"], ctx);
    expect(statusDetail.exitCode).toBe(0);
    expect(statusDetail.stdout).toContain("modified files");

    const statusFiltered = await runCli(
      ["status", "-d", wsRoot, "--filter", "dirty", "--json"],
      ctx,
    );
    expect(JSON.parse(statusFiltered.stdout).repos.map((r: { key: string }) => r.key)).toEqual([
      "acme/api",
    ]);

    const statusCheck = await runCli(["status", "-d", wsRoot, "--check"], ctx);
    expect(statusCheck.exitCode).toBe(1);
  }, 25_000);

  test("profile, alias, instructions, stats, run, search-code, reorganize, scan, lifecycle, trash, backup, open, and workspaces", async () => {
    const wsRoot = makeTempDir("rt-cli-ops-");
    const apiRemote = await createBareRemote("rt-cli-ops-api");
    const webRemote = await createBareRemote("rt-cli-ops-web");
    const ctx = makeFakeGithub(
      { "acme/api": apiRemote.fileUrl, "acme/web": webRemote.fileUrl },
      new Set(["ghost/gone"]),
    );

    await runCli(["sync", "-d", wsRoot, "--preset", "categorized"], ctx);

    // Aliases
    expect((await runCli(["alias", "list", "-d", wsRoot])).stdout).toContain("no aliases defined");
    expect((await runCli(["alias", "set", "api-svc", "acme/api", "-d", wsRoot])).exitCode).toBe(0);
    const aliasJson = await runCli(["alias", "list", "-d", wsRoot, "--json"]);
    expect(JSON.parse(aliasJson.stdout).aliases).toHaveLength(1);
    expect((await runCli(["alias", "remove", "api-svc", "-d", wsRoot])).exitCode).toBe(0);
    expect((await runCli(["alias", "remove", "missing-alias", "-d", wsRoot])).exitCode).toBe(1);

    // Profiles & pins
    expect((await runCli(["profile", "list", "-d", wsRoot])).stdout).toContain("pinned (0)");
    expect((await runCli(["profile", "pin", "acme/api", "-d", wsRoot, "--json"])).exitCode).toBe(0);
    expect(
      (await runCli(["profile", "save", "core", "--from-pinned", "-d", wsRoot, "--json"])).exitCode,
    ).toBe(0);
    expect((await runCli(["profile", "list", "-d", wsRoot, "--json"])).exitCode).toBe(0);

    // Run command (profile filter, missing profile error, --verbose, --json)
    expect(
      (await runCli(["run", "-d", wsRoot, "--profile", "nope", "git", "status"])).exitCode,
    ).toBe(1);
    const runJson = await runCli(
      ["run", "-d", wsRoot, "--profile", "core", "--json", "git", "status"],
      ctx,
    );
    expect(runJson.exitCode).toBe(0);
    expect(JSON.parse(runJson.stdout).results).toHaveLength(1);

    const runVerbose = await runCli(
      ["--verbose", "run", "-d", wsRoot, "-r", "acme/api", "git", "status"],
      ctx,
    );
    expect(runVerbose.exitCode).toBe(0);
    expect(runVerbose.stdout).toContain("stdout:");
    delete process.env.REPOTRUCK_VERBOSE;

    expect((await runCli(["profile", "unpin", "acme/api", "-d", wsRoot, "--json"])).exitCode).toBe(
      0,
    );
    // Empty `--pinned` selection in `run` exits 0 gracefully
    const runEmptyPinned = await runCli(["run", "-d", wsRoot, "--pinned", "git", "status"]);
    expect(runEmptyPinned.stdout).toContain("nothing to run");
    expect((await runCli(["profile", "delete", "core", "-d", wsRoot, "--json"])).exitCode).toBe(0);

    // Instructions template list / apply / invalid / clear
    expect((await runCli(["instructions", "template", "-d", wsRoot])).stdout).toContain("node");
    expect((await runCli(["instructions", "template", "unknown-tpl", "-d", wsRoot])).exitCode).toBe(
      1,
    );
    expect((await runCli(["instructions", "template", "node", "-d", wsRoot])).exitCode).toBe(0);
    expect((await runCli(["instructions", "template", "--clear", "-d", wsRoot])).exitCode).toBe(0);

    // Stats text & JSON
    expect((await runCli(["stats", "-d", wsRoot])).exitCode).toBe(0);
    const statsJson = await runCli(["stats", "-d", wsRoot, "--json"]);
    expect(JSON.parse(statsJson.stdout).disk.repoCount).toBe(2);

    // Search-code (--text mode + validation errors)
    expect((await runCli(["search-code", "   ", "-d", wsRoot])).exitCode).toBe(1);
    expect(
      (await runCli(["search-code", "greet", "--text", "--kind", "function", "-d", wsRoot]))
        .exitCode,
    ).toBe(1);
    expect((await runCli(["search-code", "greet", "--kind", "macro", "-d", wsRoot])).exitCode).toBe(
      1,
    );
    expect((await runCli(["search-code", "greet", "--lang", "cobol", "-d", wsRoot])).exitCode).toBe(
      1,
    );

    const textSearch = await runCli([
      "search-code",
      "greetHello",
      "--text",
      "--lang",
      "ts",
      "-d",
      wsRoot,
      "--json",
    ]);
    expect(textSearch.exitCode).toBe(0);
    expect(JSON.parse(textSearch.stdout).matches.length).toBeGreaterThanOrEqual(1);

    // Open command error branches (no app lists detected, unknown app, unknown repo with close suggestion)
    const openList = await runCli(["open", "acme/api", "-d", wsRoot]);
    expect(openList.exitCode).toBe(0);
    expect(openList.stdout).toContain("usage: repotruck open <repo> <app>");
    expect(
      (await runCli(["open", "acme/api", "nonexistent-editor-xyz-999", "-d", wsRoot])).exitCode,
    ).toBe(1);

    // Move, reorganize (--dry-run & real), archive, prune, delete/trash/restore, backup, forget, workspaces
    expect((await runCli(["reorganize", "-d", wsRoot])).exitCode).toBe(1);
    const reorgDry = await runCli([
      "reorganize",
      "flat-by-owner",
      "--dry-run",
      "-d",
      wsRoot,
      "--json",
    ]);
    expect(reorgDry.exitCode).toBe(0);
    expect((await runCli(["reorganize", "flat-by-owner", "-d", wsRoot])).exitCode).toBe(0);

    expect((await runCli(["move", "acme/web", "custom/web", "-d", wsRoot])).exitCode).toBe(0);
    expect((await runCli(["archive", "acme/web", "-d", wsRoot], ctx)).exitCode).toBe(0);

    // Inject a ghost entry deleted on GitHub and test `prune --dry-run` + `prune --json`
    await updateWorkspace(wsRoot, (cfg) => ({
      config: {
        ...cfg,
        repos: [
          ...cfg.repos,
          {
            owner: "ghost",
            name: "gone",
            category: "source",
            language: null,
            relativePath: "ghost/gone",
            internal: false,
            custom: false,
            updatedAt: null,
          },
        ],
      },
      result: undefined,
    }));
    expect((await runCli(["prune", "--dry-run", "-d", wsRoot], ctx)).exitCode).toBe(0);
    const pruneJson = await runCli(["prune", "--json", "-d", wsRoot], ctx);
    expect(pruneJson.exitCode).toBe(0);

    // Scan: drop an unregistered git repo into wsRoot, scan, --dry-run --move, and --move
    const rogueDir = path.join(wsRoot, "rogue-folder", "extra");
    mkdirSync(rogueDir, { recursive: true });
    await simpleGit(rogueDir).init(["-b", "main"]);
    await simpleGit(rogueDir).addRemote("origin", "https://github.com/acme/extra.git");

    const scanJson = await runCli(["scan", "-d", wsRoot, "--json"]);
    expect(JSON.parse(scanJson.stdout).unregisteredCount).toBe(1);
    expect((await runCli(["scan", "-d", wsRoot, "--move", "--dry-run"])).exitCode).toBe(0);
    expect((await runCli(["scan", "-d", wsRoot, "--move", "--json"])).exitCode).toBe(0);

    // Delete (requires --yes) permanently removes from disk
    expect((await runCli(["delete", "acme/extra", "-d", wsRoot])).exitCode).toBe(1);
    expect((await runCli(["delete", "acme/extra", "--yes", "-d", wsRoot])).exitCode).toBe(0);
    expect(existsSync(path.join(wsRoot, "acme", "extra"))).toBe(false);

    // Trash commands on empty trash (list / empty)
    const trashList = await runCli(["trash", "list", "-d", wsRoot, "--json"]);
    expect(JSON.parse(trashList.stdout).entries).toHaveLength(0);
    expect((await runCli(["trash", "empty", "-d", wsRoot])).exitCode).toBe(1);
    expect((await runCli(["trash", "empty", "--yes", "-d", wsRoot, "--json"])).exitCode).toBe(0);

    // Forget `acme/api` (keeps directory on disk)
    expect((await runCli(["forget", "acme/api", "-d", wsRoot])).exitCode).toBe(0);
    expect(existsSync(path.join(wsRoot, "acme", "api"))).toBe(true);

    // Backup list & restore validation
    expect((await runCli(["backup", "invalid-verb", "-d", wsRoot])).exitCode).toBe(1);
    expect((await runCli(["backup", "restore", "-d", wsRoot])).exitCode).toBe(1);
    const bkpJson = await runCli(["backup", "list", "-d", wsRoot, "--json"]);
    const snapshots = JSON.parse(bkpJson.stdout).snapshots as Array<{ file: string }>;
    expect(snapshots.length).toBeGreaterThan(0);
    expect((await runCli(["backup", "restore", snapshots[0]!.file, "-d", wsRoot])).exitCode).toBe(
      1,
    );
    expect(
      (await runCli(["backup", "restore", snapshots[0]!.file, "--yes", "-d", wsRoot])).exitCode,
    ).toBe(0);

    // Workspaces list / invalid / remove
    expect((await runCli(["workspaces", "bogus"])).exitCode).toBe(1);
    expect((await runCli(["workspaces", "remove"])).exitCode).toBe(1);
    const wsList = await runCli(["workspaces", "list", "--json"]);
    expect(wsList.exitCode).toBe(0);
    expect((await runCli(["workspaces", "remove", wsRoot])).exitCode).toBe(0);
    expect((await runCli(["workspaces", "remove", wsRoot])).exitCode).toBe(1);
  }, 25_000);
});

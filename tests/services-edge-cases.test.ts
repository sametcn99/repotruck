import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Octokit } from "@octokit/rest";
import { simpleGit } from "simple-git";
import {
  type CloneTarget,
  cloneOrUpdate,
  createCloneLimiter,
  detectSshAvailability,
  extraHeaderKeyForUrl,
  firstErrorLine,
  isDivergenceStrategy,
  originMatchesRepo,
  tokenAuthEnv,
  tokenizedUrl,
} from "../src/services/cloner.ts";
import {
  isIgnoredByRules,
  parseGitignore,
  walkSourceFiles,
} from "../src/services/codeSearchWalk.ts";
import { defaultConfig, type EnvLike, type RepotruckConfig } from "../src/services/config.ts";
import {
  buildDiscoverQuery,
  deriveCiStateFromChecks,
  fileEtagCache,
  GitHubService,
  orgLoginsFromMemberships,
  toRepoInfo,
} from "../src/services/github.ts";
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
import {
  adoptUnregisteredRepos,
  buildAdoptPlan,
  scanForRepos,
  scanWorkspaceRepos,
} from "../src/services/scanner.ts";
import {
  effectiveRoot,
  homeDirFrom,
  loadCustomPresets,
  normalizeBaseUrl,
  readSettings,
  resolveGithubBaseUrl,
  resolveRootForSession,
  resolveSyncSettings,
  validateRootInput,
  writeSettings,
} from "../src/services/settings.ts";
import { readWorkspaceConfig, writeWorkspaceConfig } from "../src/services/workspaceRegistry.ts";

const tempDirs: string[] = [];
let savedConfigDir: string | undefined;
let isolatedConfigDir = "";

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function toFileUrl(absDir: string): string {
  return `file:///${absDir.replace(/\\/g, "/")}`;
}

async function createBareAndSource(prefix: string): Promise<{
  bareDir: string;
  fileUrl: string;
  sourceDir: string;
  sourceGit: ReturnType<typeof simpleGit>;
}> {
  const bareDir = makeTempDir(`${prefix}-bare-`);
  const sourceDir = makeTempDir(`${prefix}-src-`);
  const sourceGit = simpleGit(sourceDir);
  await sourceGit.init(["-b", "main"]);
  await sourceGit.addConfig("user.email", "edge@repotruck.test");
  await sourceGit.addConfig("user.name", "Edge Tester");
  writeFileSync(path.join(sourceDir, "hello.txt"), "line1\n", "utf8");
  await sourceGit.add(".");
  await sourceGit.commit("init");
  const fileUrl = toFileUrl(bareDir);
  await simpleGit().raw(["clone", "--bare", sourceDir, bareDir]);
  await sourceGit.addRemote("origin", fileUrl);
  await sourceGit.push(["-u", "origin", "main"]);
  return { bareDir, fileUrl, sourceDir, sourceGit };
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  isolatedConfigDir = makeTempDir("rt-services-edge-cfg-");
  process.env.REPOTRUCK_CONFIG_DIR = isolatedConfigDir;
});

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("cloner edge cases", () => {
  test("originMatchesRepo handles trailing slashes, .git suffixes, SCP SSH, and blocks spoofing", () => {
    expect(originMatchesRepo("https://github.com/Acme/Api.git", "acme", "api")).toBe(true);
    expect(originMatchesRepo("https://github.com/acme/api/", "acme", "api")).toBe(true);
    expect(originMatchesRepo("https://github.com/acme/api///", "acme", "api")).toBe(true);
    expect(originMatchesRepo("https://github.com/acme/api.git/", "acme", "api")).toBe(true);
    expect(originMatchesRepo("git@github.com:Acme/Api.git", "acme", "api")).toBe(true);
    expect(originMatchesRepo("git@github.com:acme/api/", "acme", "api")).toBe(true);
    expect(originMatchesRepo("ssh://git@github.com/acme/api.git", "acme", "api")).toBe(true);

    // Spoofed owner/repo prefixes must never match
    expect(originMatchesRepo("https://github.com/evil-acme/api.git", "acme", "api")).toBe(false);
    expect(originMatchesRepo("https://github.com/acme/api-fork.git", "acme", "api")).toBe(false);
    expect(originMatchesRepo("git@github.com:evil-acme/api.git", "acme", "api")).toBe(false);
    expect(originMatchesRepo("   ", "acme", "api")).toBe(false);
  });

  test("auth helpers redact tokens and fall back safely on malformed URLs", () => {
    expect(extraHeaderKeyForUrl("https://ghe.corp.local/acme/api.git")).toBe(
      "http.https://ghe.corp.local/.extraheader",
    );
    expect(extraHeaderKeyForUrl("not a url")).toBe("http.https://github.com/.extraheader");

    const tokUrl = tokenizedUrl("https://github.com/acme/api.git", "ghp_secret999");
    expect(tokUrl).toContain("x-access-token:ghp_secret999@github.com");

    const env = tokenAuthEnv("https://github.com/acme/api.git", "ghp_secret999");
    expect(env.GIT_CONFIG_COUNT).toBe("1");
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(env.GIT_CONFIG_VALUE_0).toContain("AUTHORIZATION: basic ");

    const err = new Error(
      "fatal: repository 'https://x-access-token:ghp_secret999@github.com/a/b.git/' fail (ghp_secret999)\nsecond line",
    );
    const cleaned = firstErrorLine(err, "ghp_secret999");
    expect(cleaned).not.toContain("ghp_secret999");
    expect(cleaned).not.toContain("second line");
    expect(cleaned).toContain("***");

    expect(isDivergenceStrategy("rebase")).toBe(true);
    expect(isDivergenceStrategy("merge")).toBe(false);
    expect(typeof createCloneLimiter(0)).toBe("function");
  });

  test("detectSshAvailability covers REPOTRUCK_NO_SSH, key presence, and .ssh/config fallback", async () => {
    expect(await detectSshAvailability({ env: { REPOTRUCK_NO_SSH: "1" } })).toBe(false);

    const homeNoKeys = makeTempDir("rt-ssh-empty-");
    expect(
      await detectSshAvailability({
        homeDir: homeNoKeys,
        readHomeSshDir: async () => ["known_hosts"],
        runProbe: async () => true,
      }),
    ).toBe(false);

    expect(
      await detectSshAvailability({
        homeDir: homeNoKeys,
        readHomeSshDir: async () => ["id_ed25519"],
        runProbe: async () => true,
      }),
    ).toBe(true);

    const homeWithConfig = makeTempDir("rt-ssh-cfg-");
    mkdirSync(path.join(homeWithConfig, ".ssh"), { recursive: true });
    writeFileSync(
      path.join(homeWithConfig, ".ssh", "config"),
      "Host github.com\n  IdentityFile ~/.ssh/custom_key\n",
      "utf8",
    );
    expect(
      await detectSshAvailability({
        homeDir: homeWithConfig,
        runProbe: async () => true,
      }),
    ).toBe(true);

    const homeOtherConfig = makeTempDir("rt-ssh-other-");
    mkdirSync(path.join(homeOtherConfig, ".ssh"), { recursive: true });
    writeFileSync(
      path.join(homeOtherConfig, ".ssh", "config"),
      "Host gitlab.com\n  User git\n",
      "utf8",
    );
    expect(
      await detectSshAvailability({
        homeDir: homeOtherConfig,
        runProbe: async () => true,
      }),
    ).toBe(false);
  });

  test("cloneOrUpdate rejects non-git destination, missing origin, and mismatched origin", async () => {
    const { fileUrl } = await createBareAndSource("rt-cloner-guards");

    // 1. Non-git directory at destDir
    const nonGitDest = path.join(makeTempDir("rt-nongit-"), "acme", "api");
    mkdirSync(nonGitDest, { recursive: true });
    writeFileSync(path.join(nonGitDest, "notes.txt"), "not a repo", "utf8");
    const resNonGit = await cloneOrUpdate({
      owner: "acme",
      name: "api",
      httpsUrl: fileUrl,
      sshUrl: fileUrl,
      destDir: nonGitDest,
    });
    expect(resNonGit.phase).toBe("failed");
    expect(resNonGit.message).toContain("not a Git repository");

    // 2. Git repo without origin remote
    const noOriginDest = path.join(makeTempDir("rt-noorigin-"), "acme", "api");
    mkdirSync(noOriginDest, { recursive: true });
    await simpleGit(noOriginDest).init(["-b", "main"]);
    const resNoOrigin = await cloneOrUpdate({
      owner: "acme",
      name: "api",
      httpsUrl: fileUrl,
      sshUrl: fileUrl,
      destDir: noOriginDest,
    });
    expect(resNoOrigin.phase).toBe("failed");
    expect(resNoOrigin.message).toContain("no origin remote");

    // 3. Git repo pointing to a completely different repository
    const wrongOriginDest = path.join(makeTempDir("rt-wrongorigin-"), "acme", "api");
    mkdirSync(wrongOriginDest, { recursive: true });
    const wrongGit = simpleGit(wrongOriginDest);
    await wrongGit.init(["-b", "main"]);
    await wrongGit.addRemote("origin", "https://github.com/other-org/unrelated.git");
    const resWrong = await cloneOrUpdate({
      owner: "acme",
      name: "api",
      httpsUrl: "https://github.com/acme/api.git",
      sshUrl: "git@github.com:acme/api.git",
      destDir: wrongOriginDest,
    });
    expect(resWrong.phase).toBe("failed");
    expect(resWrong.message).toContain("tracks a different repository");
  });

  test("cloneOrUpdate handles rebase conflicts with clean abort, and token auth clone", async () => {
    const { fileUrl, sourceDir, sourceGit } = await createBareAndSource("rt-cloner-conflicts");
    const dest = path.join(makeTempDir("rt-conflict-dest-"), "acme", "api");
    const target: CloneTarget = {
      owner: "acme",
      name: "api",
      httpsUrl: fileUrl,
      sshUrl: fileUrl,
      destDir: dest,
    };

    // Clone with token enabled to exercise gitWithTokenAuth + post-clone remote set-url
    const phases: string[] = [];
    const cloned = await cloneOrUpdate(target, { token: "ghs_tok_test_123" }, (p) =>
      phases.push(p.phase),
    );
    expect(cloned.phase).toBe("done");
    expect(phases).toEqual(["cloning", "done"]);

    // Advance remote on conflicting line
    writeFileSync(path.join(sourceDir, "hello.txt"), "remote-version\n", "utf8");
    await sourceGit.add(".");
    await sourceGit.commit("remote conflicting edit");
    await sourceGit.push();

    // Commit conflicting local line -> rebase must fail AND abort cleanly (no rebase-merge left)
    const destGit = simpleGit(dest);
    await destGit.addConfig("user.email", "local@repotruck.test");
    await destGit.addConfig("user.name", "Local User");
    writeFileSync(path.join(dest, "hello.txt"), "local-commit-version\n", "utf8");
    await destGit.add(".");
    await destGit.commit("local conflicting edit");

    const rebaseRes = await cloneOrUpdate(target, { divergence: "rebase" });
    expect(rebaseRes.phase).toBe("failed");
    expect(existsSync(path.join(dest, ".git", "rebase-merge"))).toBe(false);
    expect(existsSync(path.join(dest, ".git", "rebase-apply"))).toBe(false);

    // Reset to remote
    const resetRes = await cloneOrUpdate(target, { divergence: "reset" });
    expect(resetRes.phase).toBe("done");
  }, 20_000);
});

describe("scanner & adoption edge cases", () => {
  test("scanForRepos & scanWorkspaceRepos skip worktrees, ignored dirs, no-origin repos, maxDepth, and honor custom GHE hosts", async () => {
    const root = makeTempDir("rt-scan-deep-");

    // 1. Tracked internal repo
    const trackedDir = path.join(root, "acme", "tracked-app");
    mkdirSync(trackedDir, { recursive: true });
    await simpleGit(trackedDir).init(["-b", "main"]);
    await simpleGit(trackedDir).addRemote("origin", "https://github.com/acme/tracked-app.git");

    // 2. Unregistered community repo (internal should become false)
    const commDir = path.join(root, "community", "ext", "lib");
    mkdirSync(commDir, { recursive: true });
    await simpleGit(commDir).init(["-b", "main"]);
    await simpleGit(commDir).addRemote("origin", "git@github.com:ext/lib.git");

    // 3. GitHub Enterprise repo
    const gheDir = path.join(root, "corp", "secret");
    mkdirSync(gheDir, { recursive: true });
    await simpleGit(gheDir).init(["-b", "main"]);
    await simpleGit(gheDir).addRemote("origin", "https://ghe.corp.local/corp/secret.git");

    // 4. Linked worktree (.git file pointing at gitdir) -> must be skipped
    const worktreeDir = path.join(root, "acme", "tracked-app-wt");
    mkdirSync(worktreeDir, { recursive: true });
    writeFileSync(
      path.join(worktreeDir, ".git"),
      `gitdir: ${path.join(trackedDir, ".git", "worktrees", "wt1")}\n`,
      "utf8",
    );

    // 5. Ignored directory (node_modules) containing a git repo -> must be skipped
    const nmRepo = path.join(root, "node_modules", "some-pkg");
    mkdirSync(nmRepo, { recursive: true });
    await simpleGit(nmRepo).init(["-b", "main"]);
    await simpleGit(nmRepo).addRemote("origin", "https://github.com/pkg/some-pkg.git");

    // 6. Repo without origin -> must be skipped
    const orphanDir = path.join(root, "orphan");
    mkdirSync(orphanDir, { recursive: true });
    await simpleGit(orphanDir).init(["-b", "main"]);

    // Default hosts (github.com only)
    const defaultFound = await scanForRepos(root);
    expect(defaultFound.map((r) => `${r.owner}/${r.name}`).sort()).toEqual([
      "acme/tracked-app",
      "ext/lib",
    ]);
    expect(defaultFound.find((r) => r.name === "lib")?.internal).toBe(false);
    expect(defaultFound.find((r) => r.name === "tracked-app")?.internal).toBe(true);

    // maxDepth = 0 only inspects direct children of root (none of acme/tracked-app is depth 0)
    const shallowFound = await scanForRepos(root, 0);
    expect(shallowFound).toEqual([]);

    // Custom GHE hosts included
    const config: RepotruckConfig = {
      ...defaultConfig(root, "flat-by-owner"),
      repos: [
        {
          owner: "ACME",
          name: "Tracked-App",
          category: "source",
          language: null,
          relativePath: "acme/tracked-app",
          internal: true,
          custom: false,
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    const scanRes = await scanWorkspaceRepos(root, config, ["github.com", "ghe.corp.local"]);
    expect(scanRes.tracked.map((r) => `${r.owner}/${r.name}`)).toEqual(["acme/tracked-app"]);
    expect(scanRes.unregistered.map((r) => `${r.owner}/${r.name}`).sort()).toEqual([
      "corp/secret",
      "ext/lib",
    ]);
  });

  test("buildAdoptPlan supports customPresets and adoptUnregisteredRepos prevents disk target collisions", async () => {
    const root = makeTempDir("rt-adopt-collision-");
    const env: EnvLike = { REPOTRUCK_CONFIG_DIR: isolatedConfigDir };

    // Create two unregistered repos with the SAME repo name under different owners (`alice/app` & `bob/app`)
    const aliceDir = path.join(root, "incoming-a", "app");
    const bobDir = path.join(root, "incoming-b", "app");
    mkdirSync(aliceDir, { recursive: true });
    mkdirSync(bobDir, { recursive: true });
    writeFileSync(path.join(aliceDir, "owner.txt"), "alice", "utf8");
    writeFileSync(path.join(bobDir, "owner.txt"), "bob", "utf8");
    await simpleGit(aliceDir).init(["-b", "main"]);
    await simpleGit(aliceDir).addRemote("origin", "https://github.com/alice/app.git");
    await simpleGit(bobDir).init(["-b", "main"]);
    await simpleGit(bobDir).addRemote("origin", "https://github.com/bob/app.git");

    // Use custom preset `{ id: "just-name", segments: ["name"] }` so both map to `<root>/app`
    const customPresets = [{ id: "just-name", segments: ["name" as const] }];
    const initialCfg = defaultConfig(root, "just-name");
    await writeWorkspaceConfig(root, initialCfg, env);

    const discovered = await scanForRepos(root);
    const plans = buildAdoptPlan(root, initialCfg, discovered, customPresets);
    expect(plans).toHaveLength(2);
    expect(plans.every((p) => p.targetRelativePath === "app" && p.needsMove)).toBe(true);

    // Dry run neither moves files nor mutates inventory
    const dryRes = await adoptUnregisteredRepos(root, initialCfg, plans, { dryRun: true, env });
    expect(dryRes.adopted).toHaveLength(2);
    expect(dryRes.errors).toEqual([]);
    expect(existsSync(path.join(root, "app"))).toBe(false);

    // Real adoption: first repo moves to `<root>/app`; second collides on disk and reports error safely!
    const execRes = await adoptUnregisteredRepos(root, initialCfg, plans, { env });
    expect(execRes.adopted).toHaveLength(1);
    expect(execRes.errors).toHaveLength(1);
    expect(execRes.errors[0]!.error).toContain("destination already exists on disk: app");

    // Verify both repos' contents remain intact (no silent overwrite!)
    const wsAfter = await readWorkspaceConfig(root, env);
    expect(wsAfter?.repos).toHaveLength(1);
    expect(existsSync(path.join(root, "app", "owner.txt"))).toBe(true);
  });
});

describe("codeSearchWalk .gitignore & non-git walker edge cases", () => {
  test("parseGitignore enforces segment boundaries, root anchors, directory slashes, wildcards, and negations", () => {
    const rules = parseGitignore(
      [
        "# Build and generated folders",
        "gen",
        "custom-out/",
        "/root-only",
        "sub/anchored",
        "*.min.js",
        "**/temp?.log",
        "dist-keep/*",
        "!dist-keep/important.ts",
      ].join("\r\n"),
    );

    // `gen` ignores segment `gen`, NEVER `src/agentsMd.ts` or `src/codegen.ts`
    expect(isIgnoredByRules("src/agentsMd.ts", rules)).toBe(false);
    expect(isIgnoredByRules("src/codegen.ts", rules)).toBe(false);
    expect(isIgnoredByRules("gen/output.ts", rules)).toBe(true);
    expect(isIgnoredByRules("packages/core/gen/types.ts", rules)).toBe(true);

    // `custom-out/` ignores contents inside `custom-out/`, not a plain file named `custom-out`
    expect(isIgnoredByRules("custom-out/bundle.js", rules)).toBe(true);
    expect(isIgnoredByRules("packages/ui/custom-out/index.js", rules)).toBe(true);
    expect(isIgnoredByRules("custom-out", rules)).toBe(false);

    // `/root-only` and `sub/anchored` are anchored to repository root
    expect(isIgnoredByRules("root-only/file.ts", rules)).toBe(true);
    expect(isIgnoredByRules("nested/root-only/file.ts", rules)).toBe(false);
    expect(isIgnoredByRules("sub/anchored/file.ts", rules)).toBe(true);
    expect(isIgnoredByRules("nested/sub/anchored/file.ts", rules)).toBe(false);

    // Wildcards & single-char `?`
    expect(isIgnoredByRules("assets/app.min.js", rules)).toBe(true);
    expect(isIgnoredByRules("a/b/temp1.log", rules)).toBe(true);
    expect(isIgnoredByRules("a/b/temp12.log", rules)).toBe(false);

    // Negation `!` overrides earlier ignore
    expect(isIgnoredByRules("dist-keep/trash.ts", rules)).toBe(true);
    expect(isIgnoredByRules("dist-keep/important.ts", rules)).toBe(false);
  });

  test("walkSourceFiles non-git fallback respects .gitignore and negated files inside ignored dirs", async () => {
    const dir = makeTempDir("rt-walk-nongit-");
    writeFileSync(
      path.join(dir, ".gitignore"),
      ["gen/*", "!gen/keep.ts", "secret.env"].join("\n"),
      "utf8",
    );
    mkdirSync(path.join(dir, "src"), { recursive: true });
    mkdirSync(path.join(dir, "gen"), { recursive: true });
    mkdirSync(path.join(dir, "node_modules", "pkg"), { recursive: true });

    writeFileSync(path.join(dir, "src", "agentsMd.ts"), "export const a = 1;\n", "utf8");
    writeFileSync(path.join(dir, "gen", "drop.ts"), "export const d = 2;\n", "utf8");
    writeFileSync(path.join(dir, "gen", "keep.ts"), "export const k = 3;\n", "utf8");
    writeFileSync(path.join(dir, "secret.env"), "TOKEN=123\n", "utf8");
    writeFileSync(path.join(dir, "node_modules", "pkg", "index.js"), "module.exports={}", "utf8");

    const walked = await walkSourceFiles(dir);
    expect(walked.map((f) => f.relPath)).toEqual(["gen/keep.ts", "src/agentsMd.ts"]);
  });
});

describe("settings & root validation edge cases", () => {
  test("readSettings strips invalid theme/sync values without leaking via unknown-key preservation and handles BOM", async () => {
    const cfgDir = makeTempDir("rt-settings-edge-");
    const env: EnvLike = { REPOTRUCK_CONFIG_DIR: cfgDir };

    // Write UTF-8 BOM + invalid theme (number) + invalid sync fields + unknown future key
    const rawPayload = `\uFEFF${JSON.stringify({
      theme: 123,
      defaultRoot: "/tmp/ws",
      sync: {
        concurrency: 0,
        depth: -5,
        blobless: true,
        stash: "yes",
        divergence: "invalid-mode",
      },
      github: { baseUrl: "https://ghe.example.com" },
      futureExtension: { flag: true },
    })}`;
    writeFileSync(path.join(cfgDir, "settings.json"), rawPayload, "utf8");

    const parsed = await readSettings(env);
    expect(parsed.theme).toBeUndefined();
    expect(parsed.defaultRoot).toBe("/tmp/ws");
    expect(parsed.sync).toEqual({ blobless: true });
    expect(parsed.github).toEqual({ baseUrl: "https://ghe.example.com" });
    expect((parsed as Record<string, unknown>).futureExtension).toEqual({ flag: true });

    // Empty-string theme is also rejected
    writeFileSync(path.join(cfgDir, "settings.json"), JSON.stringify({ theme: "" }), "utf8");
    expect((await readSettings(env)).theme).toBeUndefined();

    // Array JSON & corrupt JSON return `{}`
    writeFileSync(path.join(cfgDir, "settings.json"), "[1, 2, 3]", "utf8");
    expect(await readSettings(env)).toEqual({});
    writeFileSync(path.join(cfgDir, "settings.json"), "{broken json", "utf8");
    expect(await readSettings(env)).toEqual({});
  });

  test("normalizeBaseUrl, resolveGithubBaseUrl, resolveSyncSettings, loadCustomPresets, and root helpers cover boundaries", async () => {
    expect(() => normalizeBaseUrl("http://ghe.corp.com")).toThrow("expected an https URL");
    expect(() => normalizeBaseUrl("https://")).toThrow();
    expect(() => normalizeBaseUrl("https://ghe.corp.com/custom/v2")).toThrow("ending in /api/v3");
    expect(normalizeBaseUrl("https://github.com/")).toBe("https://api.github.com");
    expect(normalizeBaseUrl("https://ghe.corp.com")).toBe("https://ghe.corp.com/api/v3");
    expect(normalizeBaseUrl("https://ghe.corp.com/enterprise/api/v3/")).toBe(
      "https://ghe.corp.com/enterprise/api/v3",
    );

    const cfgDir = makeTempDir("rt-settings-helpers-");
    const env: EnvLike = {
      REPOTRUCK_CONFIG_DIR: cfgDir,
      USERPROFILE: "C:\\Users\\tester",
      HOME: "/home/tester",
    };
    await writeSettings(env, {
      theme: "contrast",
      github: { baseUrl: "https://ghe.corp.com" },
      presets: {
        valid: { segments: ["owner", "name"] },
        broken: { segments: ["invalid-segment"] },
      },
    });
    expect(await resolveGithubBaseUrl(env)).toBe("https://ghe.corp.com/api/v3");
    expect(await resolveGithubBaseUrl(env, "https://api.github.com")).toBe(
      "https://api.github.com",
    );
    const presets = loadCustomPresets(await readSettings(env));
    expect(presets).toEqual([{ id: "valid", segments: ["owner", "name"] }]);

    expect(() => resolveSyncSettings({ sync: { concurrency: 0 } })).toThrow("sync.concurrency");
    expect(() => resolveSyncSettings({ sync: { depth: -1 } })).toThrow("sync.depth");
    expect(() => resolveSyncSettings({ sync: { divergence: "bad" as unknown as "fail" } })).toThrow(
      "sync.divergence",
    );

    expect(() =>
      homeDirFrom({}, "linux", () => {
        throw new Error("no os home");
      }),
    ).toThrow("could not determine home directory");

    expect(validateRootInput("   ", env, "linux").ok).toBe(false);
    expect(validateRootInput("relative/folder", env, "linux").ok).toBe(false);
    expect(validateRootInput("~/repos", env, "linux")).toEqual({
      ok: true,
      root: "/home/tester/repos",
    });
    expect(validateRootInput("~\\repos", env, "win32")).toEqual({
      ok: true,
      root: "C:\\Users\\tester\\repos",
    });

    const eff = await effectiveRoot(env, "linux");
    expect(eff).toEqual({ root: path.join("/home/tester", "repotruck"), fromOverride: false });
    const sessionRoot = await resolveRootForSession(env, cfgDir, "linux");
    expect(sessionRoot).toBe(path.join("/home/tester", "repotruck"));
  });
});

describe("profiles & pins edge cases", () => {
  const sampleConfig = (): RepotruckConfig => ({
    ...defaultConfig("/ws", "categorized"),
    repos: [
      {
        owner: "Acme",
        name: "Api",
        category: "source",
        language: "TypeScript",
        relativePath: "Acme/source/Api",
        internal: true,
        custom: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        owner: "Acme",
        name: "Web",
        category: "source",
        language: "TypeScript",
        relativePath: "Acme/source/Web",
        internal: true,
        custom: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  test("pin, unpin, togglePin, and profile CRUD handle case-insensitivity, deduplication, and invalid inputs", () => {
    expect(isValidProfileName("work-2026.v1_a")).toBe(true);
    expect(isValidProfileName("-leading-dash")).toBe(false);
    expect(isValidProfileName("")).toBe(false);

    let cfg = sampleConfig();
    expect(pinRepo(cfg, "missing/repo").ok).toBe(false);

    const p1 = pinRepo(cfg, "acme/api");
    expect(p1.ok).toBe(true);
    cfg = p1.config;
    // Re-pinning with different case is idempotent
    const pDup = pinRepo(cfg, "ACME/API");
    expect(pDup.message).toContain("already pinned");

    // Toggle pin on untracked valid `owner/name` pins it; invalid single word fails
    const pUntracked = togglePinRepo(cfg, "ext/tool");
    expect(pUntracked.ok).toBe(true);
    cfg = pUntracked.config;
    expect(listPinned(cfg)).toEqual(["Acme/Api", "ext/tool"]);
    expect(togglePinRepo(cfg, "not-an-owner-pair").ok).toBe(false);

    // Toggle again unpins
    cfg = togglePinRepo(cfg, "Acme/Api").config;
    expect(unpinRepo(cfg, "nobody/nothing").ok).toBe(false);
    cfg = unpinRepo(cfg, "ext/tool").config;
    expect(cfg.pinned).toBeUndefined();

    // Profiles
    expect(saveProfile(cfg, "-bad", ["Acme/Api"]).ok).toBe(false);
    expect(saveProfile(cfg, "backend", []).ok).toBe(false);
    expect(saveProfile(cfg, "backend", ["nope/repo"]).ok).toBe(false);

    // Deduplicates duplicate refs and overwrites case-insensitively
    cfg = saveProfile(cfg, "Backend", ["acme/api", "ACME/API", "Acme/Web"]).config;
    expect(resolveProfileKeys(cfg, "backend")).toEqual(["Acme/Api", "Acme/Web"]);
    expect(resolveProfileKeys(cfg, "nonexistent")).toBeNull();

    cfg = saveProfile(cfg, "backend", ["Acme/Api"]).config;
    expect(listProfiles(cfg)).toEqual([{ name: "backend", repos: ["Acme/Api"] }]);

    expect(deleteProfile(cfg, "missing").ok).toBe(false);
    cfg = deleteProfile(cfg, "BACKEND").config;
    expect(cfg.profiles).toBeUndefined();
  });
});

describe("GitHubService & fileEtagCache edge cases", () => {
  test("fileEtagCache enforces TTL, evicts oldest entries past maxEntries, and recovers from corrupt JSON", async () => {
    const cacheFile = path.join(makeTempDir("rt-etag-"), "etags.json");
    writeFileSync(cacheFile, "{corrupt", "utf8");

    let clock = 1_000;
    const store = fileEtagCache(cacheFile, {
      maxEntries: 2,
      ttlMs: 500,
      now: () => clock,
    });

    expect(await store.get("repos/a/one")).toBeNull();
    await store.set("repos/a/one", { etag: '"e1"', body: { name: "one" }, savedAt: 1_000 });
    await store.set("repos/a/two", { etag: '"e2"', body: { name: "two" }, savedAt: 1_100 });
    await store.set("repos/a/three", { etag: '"e3"', body: { name: "three" }, savedAt: 1_200 });

    // Wait for scheduled async persist (500ms) so maxEntries eviction runs
    await new Promise((r) => setTimeout(r, 600));
    const persisted = JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, unknown>;
    expect(Object.keys(persisted).sort()).toEqual(["repos/a/three", "repos/a/two"]);

    // Advance clock past TTL -> entry expires
    clock = 2_000;
    expect(await store.get("repos/a/three")).toBeNull();
  });

  test("GitHubService covers searchRepos pagination/cap, createRepo 409, archiveRepo, etag 304, and CI health derivation", async () => {
    let getRepoCalls = 0;
    const fakeOctokit = {
      request: async (route: string, params?: Record<string, unknown>) => {
        if (route === "GET /repos/{owner}/{repo}") {
          getRepoCalls += 1;
          const headers = params?.headers as Record<string, string> | undefined;
          if (headers?.["If-None-Match"] === '"v1"') {
            return { status: 304, data: undefined, headers: {} };
          }
          if (params?.repo === "orphan-304") {
            return { status: 304, data: undefined, headers: {} };
          }
          return {
            status: 200,
            data: {
              name: params?.repo,
              owner: { login: params?.owner },
              default_branch: "main",
              clone_url: `https://x-access-token:tok@github.com/${params?.owner}/${params?.repo}.git`,
              stargazers_count: 42,
            },
            headers: { etag: ['"v1"'] },
          };
        }
        if (route === "GET /repos/{owner}/{repo}/pulls") {
          return { data: [{ id: 1 }, { id: 2 }] };
        }
        if (route === "GET /repos/{owner}/{repo}/commits/{ref}/check-runs") {
          if (params?.repo === "ghe-no-checks") {
            throw new Error("check-runs unsupported");
          }
          return {
            data: {
              check_runs: [{ status: "completed", conclusion: "success" }],
            },
          };
        }
        if (route === "GET /repos/{owner}/{repo}/commits/{ref}/status") {
          if (params?.repo === "ghe-no-checks") {
            return { data: { total_count: 1, state: "pending" } };
          }
          // GitHub returns state="pending" with total_count=0 when no legacy commit statuses exist
          return { data: { total_count: 0, state: "pending" } };
        }
        return { data: [] };
      },
      rest: {
        repos: {
          update: async ({ owner, repo }: { owner: string; repo: string }) => ({
            data: { name: repo, owner: { login: owner }, archived: true },
          }),
          createInOrg: async ({ org, name }: { org: string; name: string }) => {
            if (name === "taken") {
              throw Object.assign(new Error("Conflict"), { status: 409 });
            }
            return { data: { name, owner: { login: org }, private: true } };
          },
          createForAuthenticatedUser: async ({ name }: { name: string }) => ({
            data: { name, owner: { login: "me" }, private: false },
          }),
        },
        search: {
          repos: async ({ per_page, page }: { per_page: number; page: number }) => ({
            data: {
              items: Array.from({ length: per_page }, (_, idx) => ({
                name: `repo-${page}-${idx}`,
                owner: { login: "org" },
              })),
            },
          }),
        },
      },
    } as unknown as Octokit;

    const memoryCache = new Map<string, { etag: string; body: unknown; savedAt: number }>();
    const gh = new GitHubService("tok", {
      octokit: fakeOctokit,
      etagCache: {
        get: async (k) => memoryCache.get(k) ?? null,
        set: async (k, v) => {
          memoryCache.set(k, v);
        },
      },
    });

    // Conditional getRepo: 200 populates array-header etag & strips embedded credentials; second call hits 304
    const first = await gh.getRepo("acme", "api");
    expect(first.httpsUrl).toBe("https://github.com/acme/api.git");
    expect(first.stars).toBe(42);
    const second = await gh.getRepo("acme", "api");
    expect(second.name).toBe("api");
    expect(getRepoCalls).toBe(2);

    // Unexpected 304 without cached entry throws descriptive error
    await expect(gh.getRepo("acme", "orphan-304")).rejects.toThrow("unexpected 304");

    // Remote health: ignores legacy total_count=0 pending, falls back on GHE error
    const healthOk = await gh.getRepoRemoteHealth("acme", "api");
    expect(healthOk).toEqual({ defaultBranch: "main", openPrs: 2, ciState: "success" });
    const healthLegacy = await gh.getRepoRemoteHealth("acme", "ghe-no-checks");
    expect(healthLegacy).toEqual({ defaultBranch: "main", openPrs: 2, ciState: "pending" });

    // deriveCiStateFromChecks edge matrix
    expect(deriveCiStateFromChecks([{ status: "in_progress", conclusion: null }], null)).toBe(
      "pending",
    );
    expect(
      deriveCiStateFromChecks(
        [
          { status: "completed", conclusion: "timed_out" },
          { status: "in_progress", conclusion: null },
        ],
        "success",
      ),
    ).toBe("failure");
    expect(deriveCiStateFromChecks([], "error")).toBe("failure");
    expect(deriveCiStateFromChecks([], null)).toBe("none");

    // searchRepos multi-page cap
    const searched = await gh.searchRepos("topic:cli", 125);
    expect(searched).toHaveLength(125);

    // createRepo user, org, and 409 conflict
    expect((await gh.createRepo("personal-tool", { private: false })).owner).toBe("me");
    expect((await gh.createRepo("org-tool", { org: "acme", private: true })).owner).toBe("acme");
    await expect(gh.createRepo("taken", { org: "acme", private: true })).rejects.toThrow(
      "name already exists on GitHub",
    );
    expect((await gh.archiveRepo("acme", "api")).isArchived).toBe(true);

    // Query & membership helpers
    expect(
      buildDiscoverQuery("cli", {
        org: "acme",
        lang: "TypeScript",
        minStars: 10,
        topics: ["tui", " "],
      }),
    ).toBe("cli org:acme language:TypeScript stars:>=10 topic:tui archived:false fork:false");
    expect(
      orgLoginsFromMemberships([
        null,
        { organization: { login: "acme" } },
        { organization: { login: "acme" } },
        { organization: null },
      ]),
    ).toEqual(["acme"]);
    expect(orgLoginsFromMemberships("not-an-array")).toEqual([]);
    expect(toRepoInfo(null).owner).toBe("unknown");
  });
});

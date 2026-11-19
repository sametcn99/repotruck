/**
 * Deterministic screenshot fixtures: a temp workspace that looks like a
 * real one (real git repos, commits, a linked worktree, trash entries)
 * plus fully mocked store deps — no network, stable dates, repeatable
 * runs of scripts/capture-screens.ts.
 *
 * ALL identifiers are fictional placeholder data — no real accounts,
 * organizations or repositories are referenced.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store, type StoreDeps } from "../src/components/store.ts";
import type { CodeSearchMatch, CodeSearchResult } from "../src/services/codeSearch.ts";
import type { RepoInfo } from "../src/services/github.ts";
import type { RepoStatusLine } from "../src/services/lifecycle.ts";
import type { RunInReposResult } from "../src/services/runner.ts";

/** Fixed path so the header's root: line is stable across runs. */
export const FIXTURE_ROOT = path.join(tmpdir(), "repotruck-shots-ws");

const COMMIT_DATE = "2026-11-12T14:00:00+00:00";
const COMMIT_ENV = {
  GIT_AUTHOR_NAME: "dev",
  GIT_AUTHOR_EMAIL: "dev@example.com",
  GIT_AUTHOR_DATE: COMMIT_DATE,
  GIT_COMMITTER_NAME: "dev",
  GIT_COMMITTER_EMAIL: "dev@example.com",
  GIT_COMMITTER_DATE: COMMIT_DATE,
};

// ---- fictional identities ------------------------------------------------------

const USER = "devuser";
const ORG_A = "acme-labs";
const ORG_B = "vertex-soft";
const ALIAS_MAIN = "main"; // alias for the "primary" repo
const ALIAS_API = "api"; // alias for the api repo

interface FixtureRepo {
  owner: string;
  name: string;
  dir: string;
  language: string;
  category: "source" | "forks" | "archived";
}

const REPOS: readonly FixtureRepo[] = [
  {
    owner: USER,
    name: "primary",
    dir: "devuser/source/primary",
    language: "TypeScript",
    category: "source",
  },
  { owner: USER, name: "worker", dir: "devuser/source/worker", language: "Go", category: "source" },
  {
    owner: USER,
    name: "tui-tool",
    dir: "devuser/source/tui-tool",
    language: "Rust",
    category: "source",
  },
  {
    owner: USER,
    name: "widgets",
    dir: "devuser/source/widgets",
    language: "TypeScript",
    category: "source",
  },
  { owner: USER, name: "site", dir: "devuser/source/site", language: "MDX", category: "source" },
  {
    owner: USER,
    name: "scripts-py",
    dir: "devuser/source/scripts-py",
    language: "Python",
    category: "source",
  },
  {
    owner: ORG_A,
    name: "dashboard",
    dir: "acme-labs/source/dashboard",
    language: "TypeScript",
    category: "source",
  },
  {
    owner: ORG_A,
    name: "core-api",
    dir: "acme-labs/source/core-api",
    language: "TypeScript",
    category: "source",
  },
  {
    owner: ORG_B,
    name: "docs-site",
    dir: "vertex-soft/source/docs-site",
    language: "TypeScript",
    category: "source",
  },
  {
    owner: USER,
    name: "forked-lib",
    dir: "forks/forked-lib",
    language: "TypeScript",
    category: "forks",
  },
  { owner: USER, name: "mirror-svc", dir: "forks/mirror-svc", language: "Go", category: "forks" },
  {
    owner: ORG_A,
    name: "legacy-php",
    dir: "archived/legacy-php",
    language: "CSS",
    category: "archived",
  },
];

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { env: { ...process.env, ...COMMIT_ENV } });
}

export function buildFixtureWorkspace(): string {
  const root = FIXTURE_ROOT;
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  process.env.REPOTRUCK_CONFIG_DIR = path.join(root, ".config");

  for (const repo of REPOS) {
    mkdirSync(path.join(root, repo.dir), { recursive: true });
    writeFileSync(path.join(root, repo.dir, "README.md"), `# ${repo.name}\n`, "utf8");
  }
  // A missing-on-disk entry for the status matrix [missing] row.
  mkdirSync(path.join(root, ORG_A, "archived"), { recursive: true });

  // Two real git repositories with fixed-date commits feed the inspector,
  // changelog and worktree surfaces.
  const primary = path.join(root, "devuser/source/primary");
  git(primary, ["init", "-q", "-b", "main"]);
  mkdirSync(path.join(primary, "src"), { recursive: true });
  writeFileSync(path.join(primary, "src", "main.ts"), "export const version = 2;\n", "utf8");
  git(primary, ["add", "."]);
  git(primary, ["commit", "-q", "-m", "feat: view layer + registry"]);
  writeFileSync(path.join(primary, "src", "main.ts"), "export const version = 3;\n", "utf8");
  git(primary, ["add", "."]);
  git(primary, ["commit", "-q", "-m", "fix: scoring adjustments"]);
  writeFileSync(path.join(primary, "NOTES.md"), "scratch notes\n", "utf8"); // dirty tree
  git(primary, ["worktree", "add", "-q", "../primary+feat-branch", "-b", "feat-branch"]);

  const worker = path.join(root, "devuser/source/worker");
  git(worker, ["init", "-q", "-b", "main"]);
  git(worker, ["add", "."]);
  git(worker, ["commit", "-q", "-m", "chore: initial crawler"]);

  // An unregistered clone for the Scan page.
  const stray = path.join(root, "stray", "orphan-tool");
  mkdirSync(stray, { recursive: true });
  writeFileSync(path.join(stray, "go.mod"), "module example.com/orphan-tool\n", "utf8");
  git(stray, ["init", "-q", "-b", "main"]);
  git(stray, ["add", "."]);
  git(stray, ["commit", "-q", "-m", "fork"]);
  git(stray, ["remote", "add", "origin", `https://github.com/${USER}/orphan-tool.git`]);

  // Soft-deleted entries for the Trash page (with realistic sizes).
  const trash = path.join(root, ".repotruck", "trash");
  const filler = "x".repeat(1024);
  for (const entry of [
    { dir: `${USER}-old-notes-1763000000000`, file: "notes.md", kb: 4 },
    { dir: `${USER}-test-app-1761000000000`, file: "main.ts", kb: 1024 },
  ]) {
    const dir = path.join(trash, entry.dir);
    mkdirSync(dir, { recursive: true });
    const chunk = `${filler}\n`.repeat(entry.kb);
    writeFileSync(path.join(dir, entry.file), chunk, "utf8");
  }

  writeFileSync(
    path.join(root, "repotruck.json"),
    JSON.stringify(
      {
        version: 1,
        root,
        preset: "categorized",
        lastSync: "2026-11-18T09:41:00.000Z",
        repos: [
          ...REPOS.map((repo) => ({
            owner: repo.owner,
            name: repo.name,
            relativePath: repo.dir,
            category:
              repo.category === "forks"
                ? "forks"
                : repo.category === "archived"
                  ? "archived"
                  : "source",
            internal: repo.owner === USER,
            language: repo.language,
            updatedAt: "2026-11-15T10:00:00.000Z",
          })),
          {
            owner: ORG_A,
            name: "retired-docs",
            relativePath: `${ORG_A}/archived/retired-docs`,
            category: "archived",
            internal: false,
            language: "MD",
            updatedAt: "2026-06-01T10:00:00.000Z",
          },
        ],
        aliases: {
          [ALIAS_MAIN]: "devuser/source/primary",
          [ALIAS_API]: "acme-labs/source/core-api",
        },
        pinned: [`${USER}/primary`, `${USER}/worker`],
        profiles: {
          backend: [`${USER}/primary`, `${USER}/worker`, `${ORG_A}/core-api`],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return root;
}

/** Register the fixture in the central registry (loadWorkspace reads it from there). */
export async function registerFixtureWorkspace(root: string): Promise<void> {
  const { writeWorkspaceConfig } = await import("../src/services/workspaceRegistry.ts");
  const config = JSON.parse(await Bun.file(path.join(root, "repotruck.json")).text()) as Parameters<
    typeof writeWorkspaceConfig
  >[1];
  await writeWorkspaceConfig(root, config, process.env);
}

function repoInfo(repo: FixtureRepo, stars: number): RepoInfo {
  return {
    owner: repo.owner,
    name: repo.name,
    description: `${repo.name} — ${repo.language.toLowerCase()} project`,
    isPrivate: repo.owner !== USER,
    isFork: repo.category === "forks",
    isArchived: repo.category === "archived",
    language: repo.language,
    httpsUrl: `https://github.com/${repo.owner}/${repo.name}.git`,
    sshUrl: `git@github.com:${repo.owner}/${repo.name}.git`,
    updatedAt: "2026-11-15T10:00:00.000Z",
    stars,
  };
}

const PERSONAL = REPOS.filter((r) => r.owner === USER && r.category === "source");
const ACME = REPOS.filter((r) => r.owner === ORG_A && r.category === "source");
const VERTEX = REPOS.filter((r) => r.owner === ORG_B);

function statusLines(): RepoStatusLine[] {
  const line = (key: string, extra: Partial<RepoStatusLine> = {}): RepoStatusLine => ({
    key,
    line: key,
    ...extra,
  });
  return [
    line(`${USER}/primary`, {
      dirty: true,
      ahead: 2,
      worktree: true,
      details: {
        branch: "main",
        upstream: "origin/main",
        ahead: 2,
        behind: 0,
        isClean: false,
        modifiedFiles: [
          { path: "src/components/App.tsx", added: 142, removed: 18 },
          { path: "src/store/registry.ts", added: 38, removed: 4 },
        ],
        untrackedFiles: ["NOTES.md"],
        outgoingCommits: [
          { hash: "a1b2c3d4e5", subject: "feat: view layer + command registry" },
          { hash: "e4f5a6b7c8", subject: "fix: scoring adjustments" },
        ],
      },
      remote: { defaultBranch: "main", openPrs: 3, ciState: "success" },
    }),
    line(`${USER}/worker`, { remote: { defaultBranch: "main", openPrs: 0, ciState: "success" } }),
    line(`${USER}/tui-tool`, { ahead: 1 }),
    line(`${USER}/widgets`),
    line(`${USER}/site`),
    line(`${USER}/scripts-py`),
    line(`${ORG_A}/dashboard`, {
      dirty: true,
      behind: 3,
      remote: { defaultBranch: "main", openPrs: 1, ciState: "failure" },
    }),
    line(`${ORG_A}/core-api`, { behind: 1 }),
    line(`${ORG_B}/docs-site`),
    line(`${USER}/forked-lib`),
    line(`${USER}/mirror-svc`),
    line(`${ORG_A}/legacy-php`),
    line(`${ORG_A}/retired-docs`, { missing: true }),
  ];
}

function codeSearchMatches(): CodeSearchMatch[] {
  const match = (
    repo: string,
    file: string,
    line: number,
    kind: string,
    name: string,
  ): CodeSearchMatch =>
    ({
      repo,
      path: file,
      line,
      kind,
      name,
      formatted: `${repo} ${file}:${line} ${kind} ${name}`,
    }) as CodeSearchMatch;
  return [
    match(`${USER}/primary`, "src/store/StoreCore.ts", 12, "class", "StoreCore"),
    match(`${USER}/primary`, "src/store/StoreBase.ts", 8, "class", "StoreBase"),
    match(`${USER}/primary`, "src/store/palette.ts", 88, "function", "buildCommandItems"),
    match(`${USER}/primary`, "src/services/auth.ts", 93, "function", "requireAuth"),
    match(`${USER}/primary`, "src/store/types.ts", 9, "interface", "StoreSnapshot"),
    match(`${USER}/widgets`, "src/hooks.ts", 5, "function", "useTerminal"),
  ];
}

export function makeScreenshotStore(root: string): Store {
  const deps: StoreDeps = {
    auth: async () => ({ token: "shot-token", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => USER,
      getActiveOrgs: async () => [ORG_A, ORG_B],
      listUserRepos: async () => PERSONAL.map((repo, i) => repoInfo(repo, 40 - i)),
      listOrgRepos: async (org: string) =>
        (org === ORG_A ? ACME : VERTEX).map((repo) => repoInfo(repo, 12)),
      getRepo: async (owner: string, name: string) =>
        repoInfo(REPOS.find((r) => r.owner === owner && r.name === name) ?? REPOS[0]!, 24),
      createRepo: async (name: string) =>
        repoInfo(PERSONAL[0]!, 0) && repoInfo({ ...PERSONAL[0]!, name }, 0),
      getRepoRemoteHealth: async (owner: string, name: string) => {
        const found = statusLines().find((line) => line.key === `${owner}/${name}`);
        return found?.remote ?? { defaultBranch: "main", openPrs: 0, ciState: "success" as const };
      },
      searchRepos: async () => [
        repoInfo(
          {
            owner: "open-tools",
            name: "mcp-servers",
            dir: "x",
            language: "TypeScript",
            category: "source",
          },
          28400,
        ),
        repoInfo(
          {
            owner: "community",
            name: "awesome-mcp",
            dir: "x",
            language: "MDX",
            category: "source",
          },
          19100,
        ),
        repoInfo(
          { owner: "platform", name: "official-mcp", dir: "x", language: "Go", category: "source" },
          6200,
        ),
        repoInfo(
          {
            owner: "indie-dev",
            name: "mcp-runner",
            dir: "x",
            language: "TypeScript",
            category: "source",
          },
          210,
        ),
        repoInfo(
          {
            owner: "tiny-labs",
            name: "mcp-fetch",
            dir: "x",
            language: "Python",
            category: "source",
          },
          410,
        ),
      ],
    }),
    workspaceStatusFn: async () => ({ lastSync: "2026-11-18T09:41:00.000Z", repos: statusLines() }),
    searchCodeFn: async () =>
      ({
        matches: codeSearchMatches(),
        filesIndexed: 1284,
        symbols: 9412,
        durationMs: 214,
      }) as unknown as CodeSearchResult,
    runInReposFn: async (): Promise<RunInReposResult> => ({
      results: [
        {
          key: `${USER}/primary`,
          relativePath: "devuser/source/primary",
          ok: true,
          exitCode: 0,
          durationMs: 1240,
          stdout: "42 pass\n",
          stderr: "",
        },
        {
          key: `${USER}/worker`,
          relativePath: "devuser/source/worker",
          ok: true,
          exitCode: 0,
          durationMs: 890,
          stdout: "ok\n",
          stderr: "",
        },
        {
          key: `${USER}/widgets`,
          relativePath: "devuser/source/widgets",
          ok: false,
          exitCode: 1,
          durationMs: 640,
          stdout: "",
          stderr: "error: cannot find module 'x'\n",
        },
      ],
      skipped: [{ key: `${ORG_A}/retired-docs`, message: "clone missing on disk" }],
    }),
    beginDeviceLoginFn: async () => ({
      verificationUri: "https://github.com/login/device",
      userCode: "XLQW-TRHD",
      completion: new Promise(() => {}),
    }),
    updater: async () => ({ currentVersion: "0.4.1", latestVersion: null, updateAvailable: false }),
    readUpdateStateFn: async () => ({
      lastCheck: null,
      latestVersion: null,
      dismissedVersion: null,
    }),
    detectAppsFn: async () => [
      { name: "claude", command: "claude", detected: true },
      { name: "cursor", command: "cursor", detected: true },
      { name: "vscode", command: "code", detected: true },
      { name: "codex", command: "codex", detected: true },
    ],
    resolveAppFn: async () => null,
    listWorkspacesFn: async () => [
      {
        root,
        path: root,
        preset: "categorized",
        repoCount: 13,
        lastSync: "2026-11-18T09:41:00.000Z",
        lastUsed: "2026-11-19T08:00:00.000Z",
        aliases: {},
        missing: false,
      } as never,
      {
        root: "/mnt/data/projects",
        path: "/mnt/data/projects",
        preset: "language-first",
        repoCount: 23,
        lastSync: null,
        lastUsed: "2026-10-02T08:00:00.000Z",
        aliases: {},
        missing: true,
      } as never,
    ],
  };
  return new Store(root, deps);
}

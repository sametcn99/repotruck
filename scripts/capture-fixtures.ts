/**
 * Deterministic screenshot fixtures: a temp workspace that looks like a
 * real one (real git repos, commits, a linked worktree, trash entries)
 * plus fully mocked store deps — no network, stable dates, repeatable
 * runs of scripts/capture-screens.ts.
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
  GIT_AUTHOR_NAME: "sametcn99",
  GIT_AUTHOR_EMAIL: "sametcn99@gmail.com",
  GIT_AUTHOR_DATE: COMMIT_DATE,
  GIT_COMMITTER_NAME: "sametcn99",
  GIT_COMMITTER_EMAIL: "sametcn99@gmail.com",
  GIT_COMMITTER_DATE: COMMIT_DATE,
};

interface FixtureRepo {
  owner: string;
  name: string;
  dir: string;
  language: string;
  category: "source" | "forks" | "archived";
}

const REPOS: readonly FixtureRepo[] = [
  {
    owner: "sametcn99",
    name: "repotruck",
    dir: "sametcn99/source/repotruck",
    language: "TypeScript",
    category: "source",
  },
  {
    owner: "sametcn99",
    name: "golter",
    dir: "sametcn99/source/golter",
    language: "Go",
    category: "source",
  },
  {
    owner: "sametcn99",
    name: "tcptui",
    dir: "sametcn99/source/tcptui",
    language: "Rust",
    category: "source",
  },
  {
    owner: "sametcn99",
    name: "dreamtui",
    dir: "sametcn99/source/dreamtui",
    language: "TypeScript",
    category: "source",
  },
  {
    owner: "sametcn99",
    name: "hiretea",
    dir: "sametcn99/source/hiretea",
    language: "TypeScript",
    category: "source",
  },
  {
    owner: "sametcn99",
    name: "maalesef-tr",
    dir: "sametcn99/source/maalesef-tr",
    language: "TypeScript",
    category: "source",
  },
  {
    owner: "sametcn99",
    name: "personal-website",
    dir: "sametcn99/source/personal-website",
    language: "MDX",
    category: "source",
  },
  {
    owner: "sametcn99",
    name: "case-fx-tool",
    dir: "sametcn99/source/case-fx-tool",
    language: "Python",
    category: "source",
  },
  {
    owner: "Mekanet-Energy",
    name: "hmi",
    dir: "Mekanet-Energy/source/hmi",
    language: "TypeScript",
    category: "source",
  },
  {
    owner: "Mekanet-Energy",
    name: "opcua-server",
    dir: "Mekanet-Energy/source/opcua-server",
    language: "TypeScript",
    category: "source",
  },
  {
    owner: "Hiretea",
    name: "hiretea",
    dir: "Hiretea/source/hiretea",
    language: "TypeScript",
    category: "source",
  },
  {
    owner: "sametcn99",
    name: "RepoHub",
    dir: "forks/RepoHub",
    language: "TypeScript",
    category: "forks",
  },
  { owner: "sametcn99", name: "server", dir: "forks/server", language: "Go", category: "forks" },
  {
    owner: "Mekanet-Energy",
    name: "web-tr-php",
    dir: "archived/web-tr-php",
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
  mkdirSync(path.join(root, "Mekanet-Energy", "archived"), { recursive: true });

  // Two real git repositories with fixed-date commits feed the inspector,
  // changelog and worktree surfaces.
  const rt = path.join(root, "sametcn99/source/repotruck");
  git(rt, ["init", "-q", "-b", "main"]);
  mkdirSync(path.join(rt, "src"), { recursive: true });
  writeFileSync(path.join(rt, "src", "main.ts"), "export const version = 2;\n", "utf8");
  git(rt, ["add", "."]);
  git(rt, ["commit", "-q", "-m", "feat: view layer + registry"]);
  writeFileSync(path.join(rt, "src", "main.ts"), "export const version = 3;\n", "utf8");
  git(rt, ["add", "."]);
  git(rt, ["commit", "-q", "-m", "fix: palette fuzzy scoring"]);
  writeFileSync(path.join(rt, "NOTES.md"), "scratch notes\n", "utf8"); // dirty tree
  git(rt, ["worktree", "add", "-q", "../repotruck+feat-views", "-b", "feat-views"]);

  const golter = path.join(root, "sametcn99/source/golter");
  git(golter, ["init", "-q", "-b", "main"]);
  git(golter, ["add", "."]);
  git(golter, ["commit", "-q", "-m", "chore: seed crawler"]);

  // An unregistered clone for the Scan page.
  const stray = path.join(root, "stray", "rcptx-fork");
  mkdirSync(stray, { recursive: true });
  writeFileSync(path.join(stray, "go.mod"), "module example.com/rcptx-fork\n", "utf8");
  git(stray, ["init", "-q", "-b", "main"]);
  git(stray, ["add", "."]);
  git(stray, ["commit", "-q", "-m", "fork"]);
  git(stray, ["remote", "add", "origin", "https://github.com/sametcn99/rcptx-fork.git"]);

  // Soft-deleted entries for the Trash page.
  const trash = path.join(root, ".repotruck", "trash");
  for (const entry of [
    { dir: "sametcn99-rock-paper-scissors-1763000000000", file: "main.py" },
    { dir: "sametcn99-tic-tac-toe-1761000000000", file: "index.ts" },
  ]) {
    const dir = path.join(trash, entry.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, entry.file), "# soft-deleted\n", "utf8");
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
                ? "fork"
                : repo.category === "archived"
                  ? "archived"
                  : "source",
            internal: repo.owner === "sametcn99",
            language: repo.language,
            updatedAt: "2026-11-15T10:00:00.000Z",
          })),
          {
            owner: "Mekanet-Energy",
            name: "prdocs",
            relativePath: "Mekanet-Energy/archived/prdocs",
            category: "archived",
            internal: false,
            language: "MD",
            updatedAt: "2026-06-01T10:00:00.000Z",
          },
        ],
        aliases: { rt: "sametcn99/source/repotruck", opc: "Mekanet-Energy/source/opcua-server" },
        pinned: ["sametcn99/repotruck", "sametcn99/golter"],
        profiles: {
          backend: ["sametcn99/repotruck", "sametcn99/golter", "Mekanet-Energy/opcua-server"],
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
    description: `${repo.name} — ${repo.language.toLowerCase()} workspace repository`,
    isPrivate: repo.owner !== "sametcn99",
    isFork: repo.category === "forks",
    isArchived: repo.category === "archived",
    language: repo.language,
    httpsUrl: `https://github.com/${repo.owner}/${repo.name}.git`,
    sshUrl: `git@github.com:${repo.owner}/${repo.name}.git`,
    updatedAt: "2026-11-15T10:00:00.000Z",
    stars,
  };
}

const PERSONAL = REPOS.filter((r) => r.owner === "sametcn99" && r.category === "source");
const MEKANET = REPOS.filter((r) => r.owner === "Mekanet-Energy" && r.category === "source");
const HIRETEA = REPOS.filter((r) => r.owner === "Hiretea");

function statusLines(): RepoStatusLine[] {
  const line = (key: string, extra: Partial<RepoStatusLine> = {}): RepoStatusLine => ({
    key,
    line: key,
    ...extra,
  });
  return [
    line("sametcn99/repotruck", {
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
          { path: "src/components/Dashboard.tsx", added: 142, removed: 18 },
          { path: "src/commands/registry.ts", added: 38, removed: 4 },
        ],
        untrackedFiles: ["NOTES.md"],
        outgoingCommits: [
          { hash: "a1b2c3d4e5", subject: "feat: view layer + command registry" },
          { hash: "e4f5a6b7c8", subject: "fix: palette fuzzy scoring" },
        ],
      },
      remote: { defaultBranch: "main", openPrs: 3, ciState: "success" },
    }),
    line("sametcn99/golter", { remote: { defaultBranch: "main", openPrs: 0, ciState: "success" } }),
    line("sametcn99/tcptui", { ahead: 1 }),
    line("sametcn99/dreamtui"),
    line("sametcn99/hiretea", { dirty: true }),
    line("sametcn99/maalesef-tr"),
    line("sametcn99/personal-website"),
    line("sametcn99/case-fx-tool"),
    line("Mekanet-Energy/hmi", {
      dirty: true,
      behind: 3,
      remote: { defaultBranch: "main", openPrs: 1, ciState: "failure" },
    }),
    line("Mekanet-Energy/opcua-server", { behind: 1 }),
    line("Hiretea/hiretea"),
    line("sametcn99/RepoHub"),
    line("sametcn99/server"),
    line("Mekanet-Energy/web-tr-php"),
    line("Mekanet-Energy/prdocs", { missing: true }),
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
    match("sametcn99/repotruck", "src/components/store/StoreCore.ts", 12, "class", "StoreCore"),
    match("sametcn99/repotruck", "src/components/store/StoreBase.ts", 8, "class", "StoreBase"),
    match(
      "sametcn99/repotruck",
      "src/components/store/omnibar.ts",
      88,
      "function",
      "buildCommandPaletteItems",
    ),
    match("sametcn99/repotruck", "src/services/auth.ts", 93, "function", "requireAuth"),
    match("sametcn99/repotruck", "src/components/store/types.ts", 9, "interface", "StoreSnapshot"),
    match("sametcn99/dreamtui", "src/hooks.ts", 5, "function", "useTerminal"),
  ];
}

export function makeScreenshotStore(root: string): Store {
  const deps: StoreDeps = {
    auth: async () => ({ token: "shot-token", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "sametcn99",
      getActiveOrgs: async () => ["Mekanet-Energy", "Hiretea"],
      listUserRepos: async () => PERSONAL.map((repo, i) => repoInfo(repo, 40 - i)),
      listOrgRepos: async (org: string) =>
        (org === "Mekanet-Energy" ? MEKANET : HIRETEA).map((repo) => repoInfo(repo, 12)),
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
            owner: "modelcontextprotocol",
            name: "servers",
            dir: "x",
            language: "TypeScript",
            category: "source",
          },
          28400,
        ),
        repoInfo(
          {
            owner: "punkpeye",
            name: "awesome-mcp-servers",
            dir: "x",
            language: "MDX",
            category: "source",
          },
          19100,
        ),
        repoInfo(
          {
            owner: "github",
            name: "github-mcp-server",
            dir: "x",
            language: "Go",
            category: "source",
          },
          6200,
        ),
        repoInfo(
          {
            owner: "wong2",
            name: "mcp-runner",
            dir: "x",
            language: "TypeScript",
            category: "source",
          },
          210,
        ),
        repoInfo(
          {
            owner: "glama-ai",
            name: "mcp-server-fetch",
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
          key: "sametcn99/repotruck",
          relativePath: "sametcn99/source/repotruck",
          ok: true,
          exitCode: 0,
          durationMs: 1240,
          stdout: "42 pass\n",
          stderr: "",
        },
        {
          key: "sametcn99/golter",
          relativePath: "sametcn99/source/golter",
          ok: true,
          exitCode: 0,
          durationMs: 890,
          stdout: "ok\n",
          stderr: "",
        },
        {
          key: "sametcn99/hiretea",
          relativePath: "sametcn99/source/hiretea",
          ok: false,
          exitCode: 1,
          durationMs: 640,
          stdout: "",
          stderr: "error: cannot find module 'x'\n",
        },
      ],
      skipped: [{ key: "Mekanet-Energy/prdocs", message: "clone missing on disk" }],
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
        repoCount: 15,
        lastSync: "2026-11-18T09:41:00.000Z",
        lastUsed: "2026-11-19T08:00:00.000Z",
        aliases: {},
        missing: false,
      } as never,
      {
        root: "/mnt/data/code",
        path: "/mnt/data/code",
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

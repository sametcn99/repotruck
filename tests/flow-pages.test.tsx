import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { simpleGit } from "simple-git";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { syncCenterCliLine } from "../src/components/store/StoreWorkspacePages.ts";
import { Store, type StoreDeps } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import { PlaceholderView } from "../src/components/views/PlaceholderView.tsx";
import { VIEW_SPECS } from "../src/components/views/viewRegistry.ts";
import type { RepoInfo } from "../src/services/github.ts";
import type { RunInReposResult } from "../src/services/runner.ts";

const tempDirs: string[] = [];
let savedConfigDir: string | undefined;

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  activateTheme("default");
});

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

function makeRepo(owner: string, name: string, extra: Partial<RepoInfo> = {}): RepoInfo {
  return {
    owner,
    name,
    description: "test repo description",
    isPrivate: false,
    isFork: false,
    isArchived: false,
    language: "TypeScript",
    httpsUrl: `https://github.com/${owner}/${name}.git`,
    sshUrl: "",
    updatedAt: "2026-11-19T00:00:00.000Z",
    stars: 42,
    ...extra,
  };
}

function makeWorkspace(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const cfg = mkdtempSync(path.join(tmpdir(), `${prefix}-cfg-`));
  tempDirs.push(root, cfg);
  process.env.REPOTRUCK_CONFIG_DIR = cfg;
  mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
  writeFileSync(
    path.join(root, "repotruck.json"),
    JSON.stringify({
      version: 1,
      root,
      preset: "categorized",
      lastSync: null,
      repos: [
        {
          owner: "acme",
          name: "api",
          relativePath: "acme/source/api",
          category: "source",
          internal: true,
          language: "TypeScript",
          updatedAt: null,
        },
      ],
      aliases: {},
    }),
    "utf8",
  );
  return root;
}

let syncCalls = 0;
function makeStore(wsRoot: string, extraRepos: RepoInfo[] = []): Store {
  syncCalls = 0;
  const deps: StoreDeps = {
    auth: async () => ({ token: "t", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "acme-user",
      getActiveOrgs: async () => [],
      listUserRepos: async () => [makeRepo("acme", "api"), ...extraRepos],
      listOrgRepos: async () => [],
      getRepo: async (owner: string, name: string) => makeRepo(owner, name),
      createRepo: async (name: string) => makeRepo("acme-user", name),
      searchRepos: async (query: string) => [
        makeRepo("example", query.replace(/[^a-z]/gi, "") || "mcp-server"),
        makeRepo("other", "helper"),
      ],
    }),
    sync: async () => {
      syncCalls += 1;
      return {
        synced: [],
        skipped: [],
        failed: [],
        summary: { synced: 1, skipped: 0, failed: 0 },
      } as never;
    },
    cloneSingle: async () =>
      ({ ok: true, action: "cloned", repo: makeRepo("example", "mcp-server") }) as never,
    runInReposFn: async (): Promise<RunInReposResult> => ({ results: [], skipped: [] }),
    updater: async () => ({ currentVersion: "0.1.0", latestVersion: null, updateAvailable: false }),
    readUpdateStateFn: async () => ({
      lastCheck: null,
      latestVersion: null,
      dismissedVersion: null,
    }),
    detectAppsFn: async () => [],
    resolveAppFn: async () => null,
    listWorkspacesFn: async () => [],
  };
  return new Store(wsRoot, deps);
}

async function settle(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
  await setup.flush({ maxPasses: 4 });
}

async function waitReady(store: Store): Promise<void> {
  for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitUntil(
  predicate: () => boolean,
  setup: Awaited<ReturnType<typeof testRender>>,
): Promise<void> {
  for (let i = 0; i < 60 && !predicate(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await setup.flush({ maxPasses: 4 });
}

async function capture(setup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  try {
    return setup.captureCharFrame();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return setup.captureCharFrame();
  }
}

function norm(frame: string): string {
  return frame.replace(
    /[\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c]/g,
    " ",
  );
}

describe("t14 sync center", () => {
  test("CLI line reflects every flag and start routes through deps.sync", async () => {
    const store = makeStore(makeWorkspace("rt-sync-view-"));
    await store.ensureInit();

    store.updateSyncCenter({
      scope: "all",
      stash: true,
      exclude: "fork/*",
      concurrency: 5,
      depth: 1,
      divergence: "rebase",
    });
    const state = store.getSnapshot().syncCenter!;
    const cli = syncCenterCliLine(state);
    expect(cli).toContain("--scope all");
    expect(cli).toContain("--stash");
    expect(cli).toContain("--exclude fork/*");
    expect(cli).toContain("-c 5");
    expect(cli).toContain("--depth 1");
    expect(cli).toContain("--divergence rebase");
    expect(cli).not.toContain("--blobless");

    await store.startSyncCenter();
    expect(syncCalls).toBe(1);
    const messages = store.getSnapshot().statuses.map((entry) => entry.message ?? "");
    expect(messages.some((message) => message.includes("started repotruck sync --scope all"))).toBe(
      true,
    );
    expect(messages.some((message) => message.includes("— done"))).toBe(true);
  });

  test("view renders the option rows and live CLI strip", async () => {
    const store = makeStore(makeWorkspace("rt-sync-view2-"));
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    await waitReady(store);
    await settle(setup);
    store.setView("sync");
    await settle(setup);
    const frame = norm(await capture(setup));
    expect(frame).toContain("scope:");
    expect(frame).toContain("divergence:");
    expect(frame).toContain("$ repotruck sync");
    await setup.dispose();
  });
});

describe("t16 discover", () => {
  test("search fills results, selection feeds bulk clone", async () => {
    const store = makeStore(makeWorkspace("rt-disc-view-"));
    await store.ensureInit();

    store.updateDiscoverPage({ query: "mcp" });
    await store.discoverSearch();
    const page = store.getSnapshot().discoverPage!;
    expect(page.results.length).toBe(2);
    expect(page.results[0]!.name).toContain("mcp");

    store.updateDiscoverPage({
      selected: new Set([`${page.results[0]!.owner}/${page.results[0]!.name}`]),
    });
    await store.discoverCloneSelected();
    const last = store.getSnapshot().statuses.at(-1);
    expect(last?.message).toContain("clone summary: 1 synced");
  });

  test("DiscoverView renders search input, keyboard toggles, selection, and clone", async () => {
    const store = makeStore(makeWorkspace("rt-disc-render-"));
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 140, height: 40, exitOnCtrlC: false },
    );
    await waitReady(store);
    await settle(setup);

    store.setView("discover");
    await settle(setup);
    let frame = norm(await capture(setup));
    expect(frame).toContain("query:");
    expect(frame).toContain("[s] search");

    // Type query & submit (exits editing mode and searches)
    await setup.mockInput.typeText("mcp");
    setup.mockInput.pressEnter();
    await waitUntil(() => (store.getSnapshot().discoverPage?.results.length ?? 0) > 0, setup);
    frame = norm(await capture(setup));
    expect(frame).toContain("example/mcp");
    expect(frame).toContain("2 results");

    // Cycle limit (l), toggle blobless (b), select all (a), clone (c)
    setup.mockInput.pressKey("l");
    await settle(setup);
    expect(store.getSnapshot().discoverPage?.limit).toBe(50);

    setup.mockInput.pressKey("b");
    await settle(setup);
    expect(store.getSnapshot().discoverPage?.blobless).toBe(true);

    setup.mockInput.pressKey("a");
    await settle(setup);
    expect(store.getSnapshot().discoverPage?.selected.size).toBe(2);
    frame = norm(await capture(setup));
    expect(frame).toContain("[x] example/mcp");

    setup.mockInput.pressKey("c");
    await settle(setup);

    // Re-search with 's', enter edit mode with Return, Escape returns to cockpit
    setup.mockInput.pressKey("s");
    await settle(setup);
    setup.mockInput.pressEnter();
    await settle(setup);
    setup.mockInput.pressEscape();
    await settle(setup);
    expect(store.getSnapshot().view).toBe("cockpit");

    await setup.dispose();
  });
});

describe("t17 changelog + scan + prune guard", () => {
  test("changelog generates markdown; scan lists unregistered; prune is guarded", async () => {
    const root = makeWorkspace("rt-flow-view-");
    mkdirSync(path.join(root, "stray"), { recursive: true });
    const store = makeStore(root);
    await store.ensureInit();

    await store.generateChangelog({ since: "7 days ago" });
    expect(store.getSnapshot().changelogPage).not.toBeNull();

    await store.scanAndAdopt(false);
    const scanStatus = store.getSnapshot().statuses.at(-1);
    expect(scanStatus?.message).toContain("scanned");

    store.pruneWorkspaceConfirm();
    expect(store.getSnapshot().dialog?.title).toContain("Prune");
    store.resolveDialog(false);
    expect(store.getSnapshot().statuses.at(-1)?.key).not.toBe("[prune]");
  });

  test("ChangelogView renders range controls, keyboard g/m, and overflow truncation", async () => {
    const root = makeWorkspace("rt-changelog-render-");
    const repoDir = path.join(root, "acme", "source", "api");
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig("user.name", "Test User");
    await git.addConfig("user.email", "test@example.com");
    for (let i = 1; i <= 32; i += 1) {
      writeFileSync(path.join(repoDir, `file-${i}.txt`), `line ${i}\n`, "utf8");
      await git.add(".");
      await git.commit(`feat: commit ${i}`);
    }

    const store = makeStore(root);
    // Warm the changelog before rendering: 32 git commits make the first
    // generateChangelog slow, which can exceed the render wait budget on
    // slower Windows runners.
    await store.generateChangelog({});
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 130, height: 42, exitOnCtrlC: false },
    );
    await waitReady(store);
    await settle(setup);

    store.setView("changelog");
    await waitUntil(() => store.getSnapshot().changelogPage !== null, setup);
    const frame = norm(await capture(setup));
    expect(frame).toContain("[7d]");
    expect(frame).toContain("[g · 14d]");
    expect(frame).toContain("more lines (full markdown via copy)");

    setup.mockInput.pressKey("g");
    await settle(setup);
    setup.mockInput.pressKey("m");
    await settle(setup);
    expect(store.getSnapshot().statuses.some((s) => s.key === "[changelog]")).toBe(true);
    await setup.dispose();
  });

  test("ScanAdoptView renders unregistered repos and handles s/a/p keys", async () => {
    const root = makeWorkspace("rt-scan-render-");
    const strayRepo = path.join(root, "stray-owner", "orphan");
    mkdirSync(strayRepo, { recursive: true });
    const git = simpleGit(strayRepo);
    await git.init();
    await git.addRemote("origin", "https://github.com/stray-owner/orphan.git");

    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 130, height: 40, exitOnCtrlC: false },
    );
    await waitReady(store);
    await settle(setup);

    store.setView("scan");
    await settle(setup);
    let frame = norm(await capture(setup));
    expect(frame).toContain("[s] scan");
    expect(frame).toContain("none discovered yet");

    setup.mockInput.pressKey("s");
    await waitUntil(() => (store.getSnapshot().scanPage?.unregistered.length ?? 0) > 0, setup);
    frame = norm(await capture(setup));
    expect(frame).toContain("stray-owner/orphan");

    setup.mockInput.pressKey("p");
    await settle(setup);
    expect(store.getSnapshot().dialog?.title).toContain("Prune");
    store.resolveDialog(false);
    await settle(setup);

    setup.mockInput.pressKey("a");
    await settle(setup);
    expect(store.getSnapshot().statuses.some((s) => s.key === "[scan]")).toBe(true);

    await setup.dispose();
  });
});

describe("t18 worktree scan + resolve + placeholder", () => {
  test("scan runs and reports zero worktrees for a plain workspace", async () => {
    const store = makeStore(makeWorkspace("rt-wt-view-"));
    await store.ensureInit();
    await store.scanWorkspaceWorktrees();
    const last = store.getSnapshot().statuses.at(-1);
    expect(last?.key).toBe("[worktree]");
    expect(last?.message).toContain("worktree");
  });

  test("WorktreesView renders linked worktrees and handles s key", async () => {
    const root = makeWorkspace("rt-wt-render-");
    const repoDir = path.join(root, "acme", "source", "api");
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig("user.name", "Test User");
    await git.addConfig("user.email", "test@example.com");
    writeFileSync(path.join(repoDir, "README.md"), "# api\n", "utf8");
    await git.add(".");
    await git.commit("init");
    const wtDir = path.join(root, "acme", "source", "api+feat");
    await git.raw(["worktree", "add", "-b", "feat", wtDir]);

    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 130, height: 40, exitOnCtrlC: false },
    );
    await waitReady(store);
    await settle(setup);

    store.setView("worktree");
    await waitUntil(() => (store.getSnapshot().worktreePage?.rows.length ?? 0) > 0, setup);
    let frame = norm(await capture(setup));
    expect(frame).toContain("1 linked worktree(s)");
    expect(frame).toContain("acme/api");
    expect(frame).toContain("feat");

    setup.mockInput.pressKey("s");
    await settle(setup);
    frame = norm(await capture(setup));
    expect(frame).toContain("[s] scan workspace worktrees");
    await setup.dispose();
  });

  test("ConflictResolverView renders failures and triggers g/a rebase actions", async () => {
    const root = makeWorkspace("rt-resolve-render-");
    const repoDir = path.join(root, "acme", "source", "api");
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig("user.name", "Test User");
    await git.addConfig("user.email", "test@example.com");
    writeFileSync(path.join(repoDir, "README.md"), "# api\n", "utf8");
    await git.add(".");
    await git.commit("init");

    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 130, height: 40, exitOnCtrlC: false },
    );
    await waitReady(store);
    await settle(setup);

    // First render cleanly with zero failures
    store.setView("resolve");
    await settle(setup);
    let frame = norm(await capture(setup));
    expect(frame).toContain("none — last sync was clean");

    // Push a failed sync entry with an existing local repo and one missing local health
    store.pushStatus("FAILED", "acme/api", "rebase conflict in README.md");
    store.pushStatus("FAILED", "missing/repo", "missing path");
    await settle(setup);
    frame = norm(await capture(setup));
    expect(frame).toContain("acme/api");
    expect(frame).toContain("[g] git rebase --continue");
    expect(frame).toContain("[a] git rebase --abort");

    setup.mockInput.pressKey("g");
    await settle(setup);
    setup.mockInput.pressKey("a");
    await settle(setup);
    expect(store.getSnapshot().statuses.some((s) => s.key === "[resolve]")).toBe(true);
    await setup.dispose();
  });

  test("PlaceholderView renders title, summary and ticket notice", async () => {
    const spec = VIEW_SPECS[0]!;
    const setup = await testRender(<PlaceholderView spec={spec} width={80} />, {
      width: 80,
      height: 16,
      exitOnCtrlC: false,
    });
    await settle(setup);
    const frame = norm(await capture(setup));
    expect(frame).toContain(spec.title);
    expect(frame).toContain(spec.ticket);
    await setup.dispose();
  });
});

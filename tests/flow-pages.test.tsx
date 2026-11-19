import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { syncCenterCliLine } from "../src/components/store/StoreCore.ts";
import { Store, type StoreDeps } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
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

function makeRepo(owner: string, name: string): RepoInfo {
  return {
    owner,
    name,
    description: null,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    language: "TypeScript",
    httpsUrl: `https://github.com/${owner}/${name}.git`,
    sshUrl: "",
    updatedAt: "2026-11-19T00:00:00.000Z",
  };
}

function makeWorkspace(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  process.env.REPOTRUCK_CONFIG_DIR = mkdtempSync(path.join(tmpdir(), `${prefix}-cfg-`));
  mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
  return root;
}

let syncCalls = 0;
function makeStore(wsRoot: string): Store {
  syncCalls = 0;
  const deps: StoreDeps = {
    auth: async () => ({ token: "t", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "acme-user",
      getActiveOrgs: async () => [],
      listUserRepos: async () => [makeRepo("acme", "api")],
      listOrgRepos: async () => [],
      getRepo: async (owner: string, name: string) => makeRepo(owner, name),
      createRepo: async (name: string) => makeRepo("acme-user", name),
      searchRepos: async (query: string) => [
        makeRepo("example", query.replace(/[^a-z]/gi, "") || "mcp-server"),
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
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
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
    expect(page.results.length).toBe(1);
    expect(page.results[0]!.name).toContain("mcp");

    store.updateDiscoverPage({
      selected: new Set([`${page.results[0]!.owner}/${page.results[0]!.name}`]),
    });
    await store.discoverCloneSelected();
    const last = store.getSnapshot().statuses.at(-1);
    expect(last?.message).toContain("clone summary: 1 synced");
  });
});

describe("t17 changelog + scan + prune guard", () => {
  test("changelog generates markdown; scan lists unregistered; prune is guarded", async () => {
    const root = makeWorkspace("rt-flow-view-");
    // plain non-git dir with a git repo inside (unregistered)
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
});

describe("t18 worktree scan", () => {
  test("scan runs and reports zero worktrees for a plain workspace", async () => {
    const store = makeStore(makeWorkspace("rt-wt-view-"));
    await store.ensureInit();
    await store.scanWorkspaceWorktrees();
    const last = store.getSnapshot().statuses.at(-1);
    expect(last?.key).toBe("[worktree]");
    expect(last?.message).toContain("worktree");
  });
});

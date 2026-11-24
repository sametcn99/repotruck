import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store, type StoreDeps } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import type { CodeSearchMatch } from "../src/services/codeSearch.ts";
import type { RunInReposResult } from "../src/services/runner.ts";
import { settleRender, testRender } from "./helpers/render.tsx";

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

function makeWorkspace(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
  mkdirSync(path.join(root, ".repotruck"), { recursive: true });
  writeFileSync(
    path.join(root, "repotruck.json"),
    JSON.stringify({
      version: 1,
      root,
      preset: "categorized",
      lastSync: "2026-11-19T00:00:00.000Z",
      repos: [
        {
          owner: "acme",
          name: "api",
          relativePath: "acme/source/api",
          category: "source",
          internal: true,
          language: "TypeScript",
          updatedAt: "2026-11-19T00:00:00.000Z",
        },
      ],
      aliases: {},
    }),
    "utf8",
  );
  return root;
}

const MATCHES: readonly CodeSearchMatch[] = [
  {
    repo: "acme/api",
    path: "src/store.ts",
    line: 12,
    kind: "class",
    name: "Store",
    formatted: "acme/api src/store.ts:12 class Store",
  } as unknown as CodeSearchMatch,
];

function makeStore(wsRoot: string, extra: Partial<StoreDeps> = {}): Store {
  const deps: StoreDeps = {
    auth: async () => ({ token: "t", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "u",
      getActiveOrgs: async () => [],
      listUserRepos: async () => [],
      listOrgRepos: async () => [],
      getRepo: async (owner: string, name: string) => ({
        owner,
        name,
        description: null,
        isPrivate: false,
        isFork: false,
        isArchived: false,
        language: "TypeScript",
        httpsUrl: "",
        sshUrl: "",
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
      createRepo: async (name: string) => ({
        owner: "u",
        name,
        description: null,
        isPrivate: false,
        isFork: false,
        isArchived: false,
        language: "TypeScript",
        httpsUrl: "",
        sshUrl: "",
        updatedAt: "2026-10-01T00:00:00.000Z",
      }),
    }),
    updater: async () => ({ currentVersion: "0.1.0", latestVersion: null, updateAvailable: false }),
    readUpdateStateFn: async () => ({
      lastCheck: null,
      latestVersion: null,
      dismissedVersion: null,
    }),
    detectAppsFn: async () => [],
    resolveAppFn: async () => null,
    listWorkspacesFn: async () => [],
    searchCodeFn: async (options) =>
      ({
        matches: options.pattern === "Store" ? [...MATCHES] : [],
        filesIndexed: 3,
        symbols: 7,
        durationMs: 12,
      }) as never,
    runInReposFn: async (): Promise<RunInReposResult> => ({
      results: [
        {
          key: "acme/api",
          relativePath: "acme/source/api",
          ok: true,
          exitCode: 0,
          durationMs: 120,
          stdout: "3 passed",
          stderr: "",
        },
      ],
      skipped: [],
    }),
    ...extra,
  };
  return new Store(wsRoot, deps);
}

async function settle(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await settleRender(setup);
}

function norm(frame: string): string {
  return frame.replace(
    /[\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c]/g,
    " ",
  );
}

describe("t06 code search page", () => {
  test("search routes through the service and groups by repo", async () => {
    const root = makeWorkspace("rt-cs-view-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    store.setView("search");
    await settle(setup);
    store.updateCodeSearchForm({ pattern: "Store" });
    await store.runCodeSearchPage();
    await settle(setup);
    const frame = norm(setup.captureCharFrame());
    expect(frame).toContain("mode: symbol");
    expect(frame).toContain("acme/api");
    expect(frame).toContain("class Store");
    expect(store.getSnapshot().codeSearchPage?.matches.length).toBe(1);
    await setup.dispose();
  });
});

describe("t07 run console page", () => {
  test("runs the tokenized command through runInRepos and reports results", async () => {
    const root = makeWorkspace("rt-run-view-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    store.setView("run");
    await settle(setup);
    store.updateRunConsole({ command: "bun test" });
    await store.runConsoleStart();
    await settle(setup);
    const snap = store.getSnapshot();
    expect(snap.runConsole?.running).toBe(false);
    expect(snap.runConsole?.results[0]?.key).toBe("acme/api");
    expect(snap.runConsole?.results[0]?.exitCode).toBe(0);
    const frame = norm(setup.captureCharFrame());
    expect(frame).toContain("acme/api");
    expect(frame).toContain("exit 0");
    expect(frame).toContain("repotruck run");
    await setup.dispose();
  });
});

describe("t08 stats page", () => {
  test("loads stats, health score and doctor checks", async () => {
    const root = makeWorkspace("rt-stats-view-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    store.setView("stats");
    await store.refreshStatsPage();
    await settle(setup);
    let frame = norm(setup.captureCharFrame());
    expect(frame).toContain("grade:");
    expect(frame).toContain("cleanliness");
    expect(frame).toContain("Languages");
    expect(store.getSnapshot().statsPage?.stats).not.toBeNull();

    // J copy mirrors into the transient toast line above the footer.
    store.pushStatus("DONE", "[stats]", "stats JSON copied to clipboard");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[stats] — stats JSON copied to clipboard");
    expect(store.getSnapshot().toast?.phase).toBe("DONE");
    await setup.dispose();
  }, 30000);
});

describe("t09 trash & backups page", () => {
  test("lists trash and backups, restore guarded by dialog", async () => {
    const root = makeWorkspace("rt-trash-view-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    store.setView("trash");
    await store.refreshTrashPage();
    await settle(setup);
    let frame = norm(setup.captureCharFrame());
    expect(frame).toContain("Trash");
    expect(frame).toContain("Backups");
    expect(frame).toContain("no snapshots yet");

    // backup snapshot now → list refreshes with one entry
    await store.backupSnapshotNow();
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("1 repos");

    // restore opens the guarded dialog
    const backup = store.getSnapshot().trashPage?.backups[0];
    expect(backup).toBeDefined();
    store.backupRestoreConfirm(backup!.file);
    expect(store.getSnapshot().dialog?.title).toBe("Restore snapshot");
    store.resolveDialog(false);
    expect(store.getSnapshot().dialog).toBeNull();
    await setup.dispose();
  });
});

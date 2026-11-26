import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store, type StoreDeps } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import type { RepotruckConfig } from "../src/services/config.ts";
import type { RepoStatusLine } from "../src/services/lifecycle.ts";
import { readSettings } from "../src/services/settings.ts";
import { writeWorkspaceConfig } from "../src/services/workspaceRegistry.ts";
import { settleRender, testRender, waitForDashboardReady } from "./helpers/render.tsx";

const tempDirs: string[] = [];
let savedConfigDir: string | undefined;

function makeTempDir(prefix: string): string {
  const dir = (realpathSync.native ?? realpathSync)(mkdtempSync(path.join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  activateTheme("default");
});

afterAll(() => {
  if (savedConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

async function makeWorkspace(prefix: string): Promise<string> {
  const cfgDir = makeTempDir(`${prefix}-cfg-`);
  process.env.REPOTRUCK_CONFIG_DIR = cfgDir;
  const root = makeTempDir(prefix);
  mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
  mkdirSync(path.join(root, "acme", "source", "web"), { recursive: true });
  const cfg: RepotruckConfig = {
    version: 1,
    root,
    preset: "categorized",
    lastSync: "2026-11-19T00:00:00.000Z",
    pinned: ["acme/api"],
    profiles: {
      core: ["acme/api", "acme/web", "acme/cli", "acme/docs"],
    },
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
      {
        owner: "acme",
        name: "web",
        relativePath: "acme/source/web",
        category: "source",
        internal: true,
        language: "TypeScript",
        updatedAt: "2026-11-19T00:00:00.000Z",
      },
    ],
    aliases: {},
  };
  writeFileSync(path.join(root, "repotruck.json"), JSON.stringify(cfg), "utf8");
  await writeWorkspaceConfig(root, cfg, { REPOTRUCK_CONFIG_DIR: cfgDir });
  return root;
}

const RICH_STATUS_LINES: readonly RepoStatusLine[] = [
  {
    key: "acme/api",
    line: "acme/api — dirty",
    dirty: true,
    ahead: 2,
    behind: 1,
    worktree: true,
    remote: { defaultBranch: "main", openPrs: 3, ciState: "success" },
    details: {
      branch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      isClean: false,
      outgoingCommits: [{ hash: "1234567890abcdef", subject: "feat: wip change" }],
      modifiedFiles: [{ path: "src/index.ts", added: 10, removed: 2 }],
      untrackedFiles: ["notes.tmp"],
    },
  },
  {
    key: "acme/web",
    line: "acme/web — missing",
    missing: true,
    remote: { defaultBranch: "main", openPrs: 1, ciState: "failure" },
  },
];

function makeStore(wsRoot: string, extra: Partial<StoreDeps> = {}): Store {
  const deps: StoreDeps = {
    auth: async () => ({ token: "t", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "acme",
      getActiveOrgs: async () => ["acme-org"],
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
        updatedAt: null,
      }),
      createRepo: async (name: string) => ({
        owner: "acme",
        name,
        description: null,
        isPrivate: false,
        isFork: false,
        isArchived: false,
        language: "TypeScript",
        httpsUrl: "",
        sshUrl: "",
        updatedAt: null,
      }),
      searchRepos: async (query: string) => [
        {
          owner: "acme",
          name: `${query || "one"}`,
          description: "first repo",
          isPrivate: false,
          isFork: false,
          isArchived: false,
          language: "TypeScript",
          httpsUrl: "",
          sshUrl: "",
          updatedAt: null,
          stars: 10,
        },
        {
          owner: "acme",
          name: "two",
          description: "second repo",
          isPrivate: false,
          isFork: false,
          isArchived: false,
          language: "TypeScript",
          httpsUrl: "",
          sshUrl: "",
          updatedAt: null,
          stars: 20,
        },
      ],
    }),
    updater: async () => ({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
    }),
    readUpdateStateFn: async () => ({
      lastCheck: null,
      latestVersion: "0.2.0",
      dismissedVersion: null,
    }),
    detectAppsFn: async () => [],
    resolveAppFn: async () => null,
    listWorkspacesFn: async () => [],
    workspaceStatusFn: async () => ({
      lastSync: "2026-11-19T00:00:00.000Z",
      repos: [...RICH_STATUS_LINES],
    }),
    searchCodeFn: async (opts) =>
      ({
        matches: [
          {
            repo: "acme/api",
            path: "src/app.ts",
            line: 5,
            kind: "function",
            name: "boot",
            formatted: `acme/api src/app.ts:5 function boot (${opts.pattern})`,
          },
        ],
        filesIndexed: 2,
        symbols: 4,
        durationMs: 5,
      }) as never,
    runInReposFn: async () => ({
      results: [
        {
          key: "acme/api",
          relativePath: "acme/source/api",
          ok: true,
          exitCode: 0,
          durationMs: 18,
          stdout: "ok",
          stderr: "",
        },
        {
          key: "acme/web",
          relativePath: "acme/source/web",
          ok: false,
          exitCode: 2,
          durationMs: 9,
          stdout: "",
          stderr: "boom",
        },
      ],
      skipped: [{ key: "acme/skip", message: "missing" }],
    }),
    ...extra,
  };
  return new Store(wsRoot, deps);
}

async function settle(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await settleRender(setup);
}

async function waitForState(predicate: () => boolean, description: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function norm(frame: string): string {
  return frame.replace(
    /[\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c]/g,
    " ",
  );
}

async function capture(setup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  try {
    return norm(setup.captureCharFrame());
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return norm(setup.captureCharFrame());
  }
}

describe("Phase 3 interactive view coverage", () => {
  test("StatusMatrixView keyboard navigation, detail expand, filter cycle, remote & JSON copy", async () => {
    const root = await makeWorkspace("rt-v3-status-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    await waitForDashboardReady(setup, store);

    store.setView("status");
    await settle(setup);
    await settle(setup);

    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressEnter();
    await settle(setup);
    const frame = await capture(setup);
    expect(frame).toContain("branch: main");
    expect(frame).toContain("feat: wip change");

    setup.mockInput.pressKey("u");
    await settle(setup);
    expect(store.getSnapshot().statusMatrix?.remote).toBe(true);

    setup.mockInput.pressKey("f");
    await settle(setup);
    expect(await capture(setup)).toContain("[x] dirty");
    setup.mockInput.pressKey("f");
    setup.mockInput.pressKey("f");
    setup.mockInput.pressKey("f");
    await settle(setup);
    expect(await capture(setup)).toContain("[x] pinned");

    setup.mockInput.pressKey("r");
    setup.mockInput.pressKey("J");
    await settle(setup);

    await setup.dispose();
  });

  test("RunConsoleView & CodeSearchView keyboard editing, modes, submit and JSON copy", async () => {
    const root = await makeWorkspace("rt-v3-runcs-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    await waitForDashboardReady(setup, store);

    store.setView("run");
    await settle(setup);
    await setup.mockInput.typeText("git status");
    setup.mockInput.pressEnter();
    await settle(setup);
    let frame = await capture(setup);
    expect(frame).toContain("2 results");
    expect(frame).toContain("1 failed");

    // Keyboard cursor navigation & Space expand on RunConsoleView results
    setup.mockInput.pressKey("j");
    await settle(setup);
    setup.mockInput.pressKey(" ");
    await settle(setup);
    expect(await capture(setup)).toContain("boom");

    setup.mockInput.pressKey("s");
    setup.mockInput.pressKey("s");
    setup.mockInput.pressKey("s");
    setup.mockInput.pressKey("c");
    setup.mockInput.pressKey("J");
    setup.mockInput.pressKey("e");
    setup.mockInput.pressEnter();
    setup.mockInput.pressEscape();
    await settle(setup);

    store.setView("search");
    await settle(setup);
    await setup.mockInput.typeText("boot");
    setup.mockInput.pressEnter();
    await settle(setup);
    frame = await capture(setup);
    expect(frame).toContain("function boot");

    // Keyboard cursor down & Space opens DetailModal for highlighted match's repo
    setup.mockInput.pressKey("j");
    await settle(setup);
    setup.mockInput.pressKey(" ");
    await settle(setup);
    expect(store.getSnapshot().modal?.type).toBe("detail");
    setup.mockInput.pressEscape();
    await settle(setup);

    setup.mockInput.pressKey("m");
    setup.mockInput.pressKey("m");
    setup.mockInput.pressKey("r");
    setup.mockInput.pressKey("J");
    setup.mockInput.pressEnter();
    setup.mockInput.pressEscape();
    await settle(setup);

    await setup.dispose();
  });

  test("PresetsView builder, ProfilesView editing, SyncCenterView toggles, Agents & Settings", async () => {
    const root = await makeWorkspace("rt-v3-views-");
    const store = makeStore(root);
    let startedMcpPort = 0;
    store.startMcpServer = async (port: number) => {
      startedMcpPort = port;
    };
    await store.addCustomPreset("custom-one", ["owner", "name"]);

    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 130, height: 60, exitOnCtrlC: false },
    );
    await waitForDashboardReady(setup, store);

    // PresetsView: press 'a' to open builder, type id, Enter, then 'a' + Escape
    store.setView("presets");
    await settle(setup);
    setup.mockInput.pressKey("a");
    await settle(setup);
    await setup.mockInput.typeText("my-layout");
    setup.mockInput.pressEnter();
    await settle(setup);
    const presetFrame = await capture(setup);
    expect(presetFrame).toContain("my-layout");
    expect(presetFrame).toContain("[1] owner");
    setup.mockInput.pressKey("a");
    setup.mockInput.pressEscape();
    await settle(setup);

    // ProfilesView: shows seeded 'core' profile, press 'n' -> type -> Enter, press 'p', 'n' + Escape
    store.setView("profiles");
    await settle(setup);
    expect(await capture(setup)).toContain("core");
    setup.mockInput.pressKey("n");
    await settle(setup);
    await setup.mockInput.typeText("backend");
    setup.mockInput.pressEnter();
    setup.mockInput.pressKey("p");
    setup.mockInput.pressKey("n");
    await settle(setup);
    setup.mockInput.pressEscape();
    await settle(setup);

    // SyncCenterView: toggle flags s, d, b, t, c, p, l, edit include ('i' + Enter), exclude ('E' + Enter), start ('e'), stop ('x')
    store.setView("sync");
    await settle(setup);
    setup.mockInput.pressKey("s");
    await settle(setup);
    setup.mockInput.pressKey("d");
    await settle(setup);
    setup.mockInput.pressKey("d");
    await settle(setup);
    expect(await capture(setup)).toContain("divergence=reset discards local commits");
    setup.mockInput.pressKey("b");
    setup.mockInput.pressKey("t");
    setup.mockInput.pressKey("c");
    setup.mockInput.pressKey("p");
    setup.mockInput.pressKey("l");
    setup.mockInput.pressKey("i");
    await settle(setup);
    await setup.mockInput.typeText("acme/*");
    setup.mockInput.pressEnter();
    await settle(setup);
    setup.mockInput.pressKey("E");
    await settle(setup);
    await setup.mockInput.typeText("fork/*");
    setup.mockInput.pressEnter();
    await settle(setup);
    expect(store.getSnapshot().syncCenter?.exclude).toBe("fork/*");
    setup.mockInput.pressKey("e");
    setup.mockInput.pressKey("x");
    await settle(setup);

    // SettingsView: press 'r' and verify non-default settings & update badge render
    await store.setSetting("sync.concurrency", 6);
    store.setView("settings");
    await store.refreshSettingsPage();
    setup.mockInput.pressKey("r");
    await settle(setup);
    expect(await capture(setup)).toContain("Configuration");

    // AgentsView: press 'f', 'm', 's'
    store.setView("agents");
    await settle(setup);
    setup.mockInput.pressKey("f");
    setup.mockInput.pressKey("m");
    setup.mockInput.pressKey("s");
    await settle(setup);
    expect(startedMcpPort).toBe(3000);

    // TrashBackupsView: press 'b' and 'r'
    store.setView("trash");
    await settle(setup);
    setup.mockInput.pressKey("b");
    setup.mockInput.pressKey("r");
    await settle(setup);

    await setup.dispose();
  });

  test("Keyboard-only cursor and action controls across Discover, Presets, Profiles, Agents, Settings & Conflicts", async () => {
    const root = await makeWorkspace("rt-v3-kbd-views-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 140, height: 42, exitOnCtrlC: false },
    );
    await waitForDashboardReady(setup, store);

    // DiscoverView: search then move cursor down & Space to select second repo
    store.setView("discover");
    await settle(setup);
    await setup.mockInput.typeText("mcp");
    setup.mockInput.pressEnter();
    await settle(setup);
    setup.mockInput.pressKey("j");
    await settle(setup);
    setup.mockInput.pressKey(" ");
    await settle(setup);
    expect(store.getSnapshot().discoverPage?.selected.has("acme/two")).toBe(true);

    // PresetsView: arrow/Enter opens apply confirm dialog
    store.setView("presets");
    await settle(setup);
    setup.mockInput.pressArrow("right");
    await settle(setup);
    setup.mockInput.pressEnter();
    await settle(setup);
    expect(store.getSnapshot().dialog?.title).toContain("Reorganize");
    store.resolveDialog(false);
    await settle(setup);

    // ProfilesView: Right moves to Named profiles pane, 'r' launches RunConsole with profile scope
    store.setView("profiles");
    await settle(setup);
    setup.mockInput.pressArrow("right");
    await settle(setup);
    setup.mockInput.pressKey("r");
    await settle(setup);
    expect(store.getSnapshot().view).toBe("run");
    expect(store.getSnapshot().runConsole?.scope).toBe("profile");

    // SettingsView: j moves to sync.blobless (index 2), Enter toggles it via setSetting
    store.setView("settings");
    await store.refreshSettingsPage();
    await waitForState(
      () => store.getSnapshot().settingsPage?.settings != null,
      "settings page settings to load",
    );
    await settle(setup);
    expect(await capture(setup)).toContain("sync blobless");
    setup.mockInput.pressKey("j");
    setup.mockInput.pressKey("j");
    await settle(setup);
    expect(await capture(setup)).toContain(">sync blobless");
    setup.mockInput.pressEnter();
    await waitForState(
      () =>
        (store.getSnapshot().settingsPage?.settings?.sync as { blobless?: boolean } | undefined)
          ?.blobless === true,
      "sync.blobless update to persist and refresh into Store state",
    );
    const persistedSettings = await readSettings(process.env);
    expect(persistedSettings.sync?.blobless).toBe(true);

    // AgentsView: p cycles port, Enter applies first template
    store.setView("agents");
    await settle(setup);
    setup.mockInput.pressKey("p");
    setup.mockInput.pressEnter();
    await settle(setup);
    expect(await capture(setup)).toContain("3100");

    // ConflictResolverView: Enter on failed repo opens DetailModal
    store.pushStatus("FAILED", "acme/api", "conflict");
    store.setView("resolve");
    await settle(setup);
    setup.mockInput.pressEnter();
    await settle(setup);
    expect(store.getSnapshot().modal?.type).toBe("detail");
    store.closeModal();
    await settle(setup);

    await setup.dispose();
  });
});

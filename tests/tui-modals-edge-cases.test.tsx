import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { simpleGit } from "simple-git";
import { AliasModal } from "../src/components/AliasModal.tsx";
import { CloneModal } from "../src/components/CloneModal.tsx";
import { CommandFormModal } from "../src/components/CommandFormModal.tsx";
import { CreateModal } from "../src/components/CreateModal.tsx";
import { DialogBox } from "../src/components/DialogBox.tsx";
import { MoveModal } from "../src/components/MoveModal.tsx";
import { OmnibarModal } from "../src/components/OmnibarModal.tsx";
import { SearchModal } from "../src/components/SearchModal.tsx";
import { StatusPanel } from "../src/components/StatusPanel.tsx";
import {
  buildCommandPaletteItems,
  buildViewPaletteItems,
  cycleOmnibarMode,
  Store,
  type StoreDeps,
} from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import { VIEW_SPECS } from "../src/components/views/viewRegistry.ts";
import { WorktreeModal } from "../src/components/WorktreeModal.tsx";
import type { RepoInfo } from "../src/services/github.ts";

type RendererSetup = Awaited<ReturnType<typeof testRender>>;

async function settle(setup: RendererSetup): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
  await setup.flush({ maxPasses: 4 });
}

function norm(frame: string): string {
  return frame.replace(
    /[\u2500\u2502\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c]/g,
    " ",
  );
}

const tempDirs: string[] = [];
let savedConfigDir: string | undefined;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
});

afterAll(() => {
  activateTheme("default");
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
    description: "Repo summary",
    isPrivate: false,
    isFork: false,
    isArchived: false,
    language: "TypeScript",
    httpsUrl: `https://github.com/${owner}/${name}.git`,
    sshUrl: `git@github.com:${owner}/${name}.git`,
    updatedAt: "2026-10-01T00:00:00.000Z",
    stars: 12,
    ...extra,
  };
}

function makeStore(wsRoot: string, repos: RepoInfo[] = []): Store {
  const deps: StoreDeps = {
    auth: async () => ({ token: "fake-token", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "acme-user",
      getActiveOrgs: async () => ["acme-org"],
      listUserRepos: async () => repos,
      listOrgRepos: async () => [],
      getRepo: async (owner: string, name: string) => makeRepo(owner, name),
      createRepo: async (name: string) => makeRepo("acme-user", name),
      searchRepos: async (query: string) => [makeRepo("octo", query.trim() || "demo")],
    }),
    runInReposFn: async () => ({
      results: [
        {
          key: "acme/api",
          relativePath: "acme/source/api",
          ok: true,
          exitCode: 0,
          durationMs: 5,
          stdout: "ok",
          stderr: "",
        },
      ],
      skipped: [],
    }),
    searchCodeFn: async () =>
      ({
        matches: [
          {
            repo: "acme/api",
            path: "src/index.ts",
            line: 10,
            name: "bootstrap",
            kind: "function",
            lang: "ts",
            formatted: "acme/api:10 fn bootstrap",
          },
        ],
        stats: { indexedRepos: 1, matchedRepos: 1, totalMatches: 1, durationMs: 5 },
      }) as never,
    updater: async () => ({
      currentVersion: "0.1.0",
      latestVersion: null,
      updateAvailable: false,
    }),
    readUpdateStateFn: async () => ({
      lastCheck: null,
      latestVersion: null,
      dismissedVersion: null,
    }),
    detectAppsFn: async () => [{ name: "code", command: "code", detected: true }],
    resolveAppFn: async (app: string) =>
      app === "code" ? { name: "code", command: "code", args: [], detected: true } : null,
    listWorkspacesFn: async () => [
      {
        root: wsRoot,
        path: wsRoot,
        preset: "categorized",
        repoCount: repos.length,
        lastSync: null,
        lastUsed: "2026-10-23T00:00:00.000Z",
        aliases: {},
        missing: false,
      } as never,
    ],
  };

  return new Store(wsRoot, deps);
}

describe("TUI Modals Edge Cases & Omni-actions", () => {
  test("Omnibar mode cycling and command palette items filtering", () => {
    expect(cycleOmnibarMode("commands")).toBe("symbols");
    expect(cycleOmnibarMode("symbols")).toBe("github");
    expect(cycleOmnibarMode("github")).toBe("runner");
    expect(cycleOmnibarMode("runner")).toBe("commands");

    const ws = tempDir("rt-tui-edge-ws-");
    const store = makeStore(ws);
    const snap = store.getSnapshot();

    const allItems = buildCommandPaletteItems("", snap);
    expect(allItems.length).toBeGreaterThanOrEqual(40);

    const themeItem = allItems.find((i) => i.id === "theme");
    expect(themeItem).toBeDefined();

    const filtered = buildCommandPaletteItems("theme", snap);
    expect(filtered.some((i) => i.id === "theme")).toBe(true);

    const noMatch = buildCommandPaletteItems("nonexistent_command_xyz_123", snap);
    expect(noMatch.length).toBe(0);
  });

  test("Command palette exposes every view and navigates to it", () => {
    const ws = tempDir("rt-tui-edge-views-");
    const store = makeStore(ws);
    const snap = store.getSnapshot();

    // Completeness: one Go entry per registry view, current view marked active.
    const viewItems = buildViewPaletteItems(snap);
    expect(viewItems.map((item) => item.id)).toEqual(VIEW_SPECS.map((spec) => `view:${spec.id}`));
    expect(viewItems.every((item) => item.category === "Go")).toBe(true);
    expect(viewItems.find((item) => item.id === "view:cockpit")?.detail).toBe("active");
    expect(viewItems.find((item) => item.id === "view:stats")?.detail).toBeUndefined();

    // The merged palette carries them and fuzzy search finds them.
    const allItems = buildCommandPaletteItems("", snap);
    for (const spec of VIEW_SPECS) {
      expect(allItems.some((item) => item.id === `view:${spec.id}`)).toBe(true);
    }
    expect(buildCommandPaletteItems("go to stats", snap).some((i) => i.id === "view:stats")).toBe(
      true,
    );

    // Executing a view entry closes the omnibar and switches the page.
    store.openOmnibar("commands");
    store.executeOmnibarCommand("view:stats");
    const after = store.getSnapshot();
    expect(after.modal).toBeNull();
    expect(after.view).toBe("stats");
    store.executeOmnibarCommand("view:cockpit");
    expect(store.getSnapshot().view).toBe("cockpit");
  });

  test("Omnibar execution shifts tabs, sorts, filters, and handles missing repos safely", async () => {
    const ws = tempDir("rt-tui-edge-ws-");
    const store = makeStore(ws);

    expect(store.getSnapshot().rightPaneTab).toBe("activity");

    store.executeOmnibarCommand("tab-inspector");
    expect(store.getSnapshot().rightPaneTab).toBe("inspector");

    store.executeOmnibarCommand("tab-health");
    expect(store.getSnapshot().rightPaneTab).toBe("health");

    store.executeOmnibarCommand("sort-name");
    expect(store.getSnapshot().sortKey).toBe("name");
    store.executeOmnibarCommand("sort-reverse");
    expect(store.getSnapshot().sortDescending).toBe(true);

    store.executeOmnibarCommand("health-dirty");
    expect(store.getSnapshot().healthFilter).toBe("dirty");

    store.executeOmnibarCommand("mode-symbols");
    expect(store.getSnapshot().modal?.type).toBe("omnibar");
    expect((store.getSnapshot().modal as { mode?: string })?.mode).toBe("symbols");

    store.executeOmnibarCommand("move");
    expect(store.getSnapshot().statuses.some((s) => s.key === "[move]")).toBe(true);

    store.executeOmnibarCommand("alias");
    expect(store.getSnapshot().statuses.some((s) => s.key === "[alias]")).toBe(true);
  });

  test("CreateModal walks through all 6 steps with validation and keyboard navigation", async () => {
    const ws = tempDir("rt-tui-create-walk-");
    process.env.REPOTRUCK_CONFIG_DIR = tempDir("rt-tui-create-cfg-");
    const store = makeStore(ws);
    await store.init();
    store.openCreateModal();

    const setup = await testRender(<CreateModal store={store} />, { width: 100, height: 30 });
    await settle(setup);

    // Step 1: empty submit triggers validation error, then valid name advances
    setup.mockInput.pressEnter();
    await settle(setup);
    expect(store.getSnapshot().modalError).toContain("invalid repository name");

    await setup.mockInput.typeText("brand-new-repo");
    await settle(setup);
    setup.mockInput.pressEnter();
    await settle(setup);
    expect(norm(setup.captureCharFrame())).toContain("[2/6] source");

    // Step 2: toggle --from import on and hit Enter with empty dir (error), toggle back off, advance
    setup.mockInput.pressKey(" ");
    await settle(setup);
    expect(norm(setup.captureCharFrame())).toContain("[x] Import from a local directory");
    setup.mockInput.pressEnter();
    await settle(setup);
    expect(store.getSnapshot().modalError).toContain("source directory path is required");

    setup.mockInput.pressKey(" ");
    await settle(setup);
    setup.mockInput.pressEnter();
    await settle(setup);
    expect(norm(setup.captureCharFrame())).toContain("[3/6] owner");

    // Step 3: org selection down -> up -> Enter
    setup.mockInput.pressArrow("down");
    await settle(setup);
    setup.mockInput.pressArrow("up");
    await settle(setup);
    setup.mockInput.pressEnter();
    await settle(setup);
    expect(norm(setup.captureCharFrame())).toContain("[4/6] path");

    // Step 4: path -> advance
    setup.mockInput.pressEnter();
    await settle(setup);
    expect(norm(setup.captureCharFrame())).toContain("[5/6] description");

    // Step 5: description -> advance
    await setup.mockInput.typeText("Demo service");
    await settle(setup);
    setup.mockInput.pressEnter();
    await settle(setup);
    expect(norm(setup.captureCharFrame())).toContain("[6/6] visibility");

    // Step 6: flip visibility with Space, step Left back to description, Enter back to visibility, Enter to create
    setup.mockInput.pressKey(" ");
    await settle(setup);
    expect(norm(setup.captureCharFrame())).toContain("[x] Public");

    setup.mockInput.pressArrow("left");
    await settle(setup);
    expect(norm(setup.captureCharFrame())).toContain("[5/6] description");

    setup.mockInput.pressEnter();
    await settle(setup);
    expect(norm(setup.captureCharFrame())).toContain("[6/6] visibility");

    setup.mockInput.pressEnter();
    await settle(setup);
    await settle(setup);
    await setup.dispose();
  });

  test("CloneModal, MoveModal, AliasModal render cleanly", async () => {
    const ws = tempDir("rt-tui-edge-ws-");
    const store = makeStore(ws);

    store.openCloneModal();
    const cloneSetup = await testRender(<CloneModal store={store} />, { width: 90, height: 28 });
    await settle(cloneSetup);
    expect(norm(cloneSetup.captureCharFrame())).toContain("Clone repository");
    expect(norm(cloneSetup.captureCharFrame())).toContain("URL or owner/name");
    await cloneSetup.dispose();

    store.openModal({ type: "move", key: "acme/api" });
    const moveSetup = await testRender(<MoveModal store={store} />, { width: 90, height: 28 });
    await settle(moveSetup);
    expect(norm(moveSetup.captureCharFrame())).toContain("Move repository");
    expect(norm(moveSetup.captureCharFrame())).toContain("acme/api");
    await moveSetup.dispose();

    store.openModal({ type: "alias", key: "acme/api", prefill: "api" });
    const aliasSetup = await testRender(<AliasModal store={store} />, { width: 90, height: 28 });
    await settle(aliasSetup);
    expect(norm(aliasSetup.captureCharFrame())).toContain("Set alias");
    expect(norm(aliasSetup.captureCharFrame())).toContain("acme/api");
    await aliasSetup.dispose();
  });

  test("OmnibarModal renders all 4 modes, keyboard navigation, and submission", async () => {
    const ws = tempDir("rt-tui-omni-");
    const store = makeStore(ws, [makeRepo("acme", "api")]);
    await store.init();
    store.openOmnibar("commands", "");

    const setup = await testRender(<OmnibarModal store={store} />, { width: 100, height: 28 });
    await settle(setup);

    let frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[:] Commands");
    // View navigation (Go) leads the palette; other commands surface via filter.
    expect(frame).toContain("[Go] Go to Cockpit");
    await store.updateOmnibarQuery("sync");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("Sync selected repositories");
    await store.updateOmnibarQuery("");
    await settle(setup);

    // Navigate commands list with down, up, pagedown, pageup, end, home
    setup.mockInput.pressArrow("down");
    await settle(setup);
    setup.mockInput.pressArrow("up");
    await settle(setup);
    setup.mockInput.pressKey("PAGE_DOWN");
    setup.mockInput.pressKey("HOME");
    await settle(setup);

    // Tab cycles commands -> symbols -> github -> runner
    setup.mockInput.pressKey("\t");
    await settle(setup);
    const currentModal = store.getSnapshot().modal;
    if (currentModal?.type === "omnibar" && currentModal.mode === "commands") {
      store.cycleOmnibarTab();
      await settle(setup);
    }
    expect(norm(setup.captureCharFrame())).toContain("[@] Code Search");
    await store.updateOmnibarQuery("bootstrap");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("acme/api");

    // Switch to github mode and search
    store.cycleOmnibarTab();
    await settle(setup);
    await store.updateOmnibarQuery("octo");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("octo/");

    // Switch to runner mode and submit
    store.openOmnibar("runner", "git status");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[!] Run Command");
    expect(frame).toContain("Target scope:");
    setup.mockInput.pressEnter();
    await settle(setup);
    await setup.dispose();
  });

  test("WorktreeModal renders loading, worktrees with states, and error state", async () => {
    const ws = tempDir("rt-tui-wt-modal-");
    const store = makeStore(ws);
    store.openModal({
      type: "worktree",
      key: "acme/api",
      worktrees: [],
      loading: true,
      error: null,
    });
    const setup = await testRender(<WorktreeModal store={store} />, { width: 100, height: 28 });
    await settle(setup);
    expect(norm(setup.captureCharFrame())).toContain("Loading worktrees...");

    store.openModal({
      type: "worktree",
      key: "acme/api",
      loading: false,
      error: "minor warning",
      worktrees: [
        {
          path: "/tmp/acme/api",
          head: "111",
          branch: "main",
          bare: false,
          locked: false,
          isMain: true,
        },
        {
          path: "/tmp/acme/api+feat",
          head: "222",
          branch: null,
          bare: false,
          locked: true,
          isMain: false,
        },
      ],
    });
    await settle(setup);
    const frame = norm(setup.captureCharFrame());
    expect(frame).toContain("Active Worktrees (2):");
    expect(frame).toContain("[main] (main)");
    expect(frame).toContain("[detached] [locked]");
    expect(frame).toContain("[ Remove ]");
    expect(frame).toContain("[ Add Worktree ]");
    expect(frame).toContain("minor warning");
    await setup.dispose();
  });

  test("SearchModal & DialogBox handle typing, y/n/Enter/Escape confirmations", async () => {
    const ws = tempDir("rt-tui-search-dlg-");
    const store = makeStore(ws, [makeRepo("acme", "api"), makeRepo("acme", "web")]);
    await store.init();
    store.openSearchModal();

    const searchSetup = await testRender(<SearchModal store={store} />, { width: 90, height: 20 });
    await settle(searchSetup);
    expect(norm(searchSetup.captureCharFrame())).toContain("Search");
    await searchSetup.mockInput.typeText("api");
    await settle(searchSetup);
    expect(store.getSnapshot().search).toBe("api");
    searchSetup.mockInput.pressEscape();
    await settle(searchSetup);
    expect(store.getSnapshot().search).toBeNull();
    expect(store.getSnapshot().modal).toBeNull();
    await searchSetup.dispose();

    // DialogBox confirmations (danger & non-danger)
    let confirmed = 0;
    store.confirmDialog(
      { title: "Confirm Danger", message: "Delete things?", confirmLabel: "Proceed", danger: true },
      () => {
        confirmed += 1;
      },
    );
    const dlgSetup = await testRender(<DialogBox store={store} />, { width: 90, height: 20 });
    await settle(dlgSetup);
    expect(norm(dlgSetup.captureCharFrame())).toContain("[y] Proceed");
    dlgSetup.mockInput.pressKey("y");
    await settle(dlgSetup);
    expect(confirmed).toBe(1);
    expect(store.getSnapshot().dialog).toBeNull();

    store.confirmDialog({ title: "Cancel Test", message: "Continue?", confirmLabel: "Yes" }, () => {
      confirmed += 10;
    });
    await settle(dlgSetup);
    dlgSetup.mockInput.pressKey("n");
    await settle(dlgSetup);
    expect(confirmed).toBe(1);

    store.confirmDialog({ title: "Enter Test", message: "Accept?", confirmLabel: "Go" }, () => {
      confirmed += 2;
    });
    await settle(dlgSetup);
    dlgSetup.mockInput.pressEnter();
    await settle(dlgSetup);
    expect(confirmed).toBe(3);

    await dlgSetup.dispose();
  });

  test("CommandFormModal renders args, flags, wired command info", async () => {
    const ws = tempDir("rt-tui-cform-extra-");
    const store = makeStore(ws);
    store.openCommandForm("create");
    const setup = await testRender(<CommandFormModal store={store} />, { width: 100, height: 32 });
    await settle(setup);
    let frame = norm(setup.captureCharFrame());
    expect(frame).toContain("create — Create repository");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressKey(" ");
    await settle(setup);
    expect(norm(setup.captureCharFrame())).toContain("--public");
    expect(frame).toContain("requires:");

    store.openCommandForm("scan");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[ Run ]");
    expect(frame).toContain("[ Copy ]");
    expect(frame).toContain("[ Open page ]");
    await setup.dispose();
  });

  test("StatusPanel renders Activity (running+progress), Inspector (dirty+commits+missing+untracked), and Health tabs", async () => {
    const ws = tempDir("rt-tui-status-panel-");
    const cfg = tempDir("rt-tui-status-cfg-");
    process.env.REPOTRUCK_CONFIG_DIR = cfg;
    const repoDir = path.join(ws, "acme", "source", "api");
    mkdirSync(repoDir, { recursive: true });
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig("user.name", "Tester");
    await git.addConfig("user.email", "tester@example.com");
    writeFileSync(path.join(repoDir, "README.md"), "hello\n", "utf8");
    await git.add(".");
    await git.commit("init");
    writeFileSync(path.join(repoDir, "README.md"), "hello\nworld\n", "utf8");
    writeFileSync(path.join(repoDir, "untracked.txt"), "new\n", "utf8");

    writeFileSync(
      path.join(ws, "repotruck.json"),
      JSON.stringify({
        version: 1,
        root: ws,
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
            updatedAt: null,
          },
          {
            owner: "acme",
            name: "gone",
            relativePath: "acme/source/gone",
            category: "source",
            internal: true,
            language: "TypeScript",
            updatedAt: null,
          },
        ],
        pinned: ["acme/api"],
        aliases: { "acme/api": "a" },
      }),
      "utf8",
    );

    const store = makeStore(ws, [
      makeRepo("acme", "api"),
      makeRepo("acme", "gone"),
      makeRepo("acme", "uncloned"),
    ]);
    await store.init();
    store.pushStatus("CLONING", "acme/new");
    store.pushStatus("DONE", "acme/api", "synced cleanly");
    store.pushStatus("FAILED", "acme/gone", "missing");

    // 1. Activity Tab with narrow compact width (<34) & wide width
    store.setRightPaneTab("activity");
    const setup = await testRender(<StatusPanel store={store} width={54} />, {
      width: 54,
      height: 28,
    });
    await settle(setup);
    let frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[1]Activity");
    expect(frame).toContain("synced cleanly");

    // 2. Inspector Tab on tracked dirty repo
    store.setRightPaneTab("inspector");
    await store.refreshInspector();
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("acme/api");
    expect(frame).toContain("README.md");

    // Inspector on missing repo
    store.setCursor(1);
    await store.refreshInspector();
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("acme/gone [MISSING]");

    // Inspector on uncloned repo
    store.setCursor(2);
    await store.refreshInspector();
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("not cloned locally");

    // 3. Health Tab
    store.setRightPaneTab("health");
    await store.refreshHealthTab();
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[F] Run Doctor Auto-Fix");

    await setup.dispose();
  });
});

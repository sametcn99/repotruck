import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store, type StoreDeps, type ViewId } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import {
  nextViewId,
  VIEW_GO_KEYS,
  VIEW_MENU_GROUPS,
  VIEW_ORDER,
  VIEW_SPECS,
} from "../src/components/views/viewRegistry.ts";
import type { RepoInfo } from "../src/services/github.ts";
import { settleRender, testRender } from "./helpers/render.tsx";

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
    sshUrl: `git@github.com:${owner}/${name}.git`,
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function makeWorkspace(prefix: string): string {
  const root = tempDir(prefix);
  mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
  writeFileSync(
    path.join(root, "repotruck.json"),
    JSON.stringify({
      version: 1,
      root,
      preset: "categorized",
      lastSync: "2026-10-25T00:00:00.000Z",
      repos: [],
      aliases: {},
    }),
    "utf8",
  );
  return root;
}

function makeStore(wsRoot: string, repos: RepoInfo[] = []): Store {
  const deps: StoreDeps = {
    auth: async () => ({ token: "fake-token", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "acme-user",
      getActiveOrgs: async () => [],
      listUserRepos: async () => repos,
      listOrgRepos: async () => [],
      getRepo: async (owner: string, name: string) => makeRepo(owner, name),
      createRepo: async (name: string) => makeRepo("acme-user", name),
    }),
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
    detectAppsFn: async () => [],
    resolveAppFn: async () => null,
    listWorkspacesFn: async () => [],
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

describe("t01 view layer — registry & windowing", () => {
  test("view registry covers every view id exactly once with unique go letters", () => {
    const ids = VIEW_SPECS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(VIEW_SPECS.length);
    expect(VIEW_ORDER).toContain("cockpit");
    const letters = VIEW_SPECS.map((s) => s.go);
    expect(new Set(letters).size).toBe(letters.length);
    for (const [letter, view] of VIEW_GO_KEYS) {
      expect(VIEW_ORDER).toContain(view);
      expect(letter.length).toBe(1);
    }
  });

  test("nextViewId cycles with wrap-around in both directions", () => {
    const first = VIEW_ORDER[0]!;
    const last = VIEW_ORDER[VIEW_ORDER.length - 1]!;
    expect(nextViewId(last, 1)).toBe(first);
    expect(nextViewId(first, -1)).toBe(last);
    expect(nextViewId("cockpit", 1)).not.toBe("cockpit");
  });

  test("the top menu includes every view exactly once", () => {
    const menuViews = VIEW_MENU_GROUPS.flatMap(({ views }) => views.map(({ id }) => id));
    expect(menuViews.toSorted()).toEqual([...VIEW_ORDER].toSorted());
  });
});

describe("t01 view layer — store actions", () => {
  test("initial view is the cockpit; setView and cycleView navigate", () => {
    const store = makeStore(makeWorkspace("rt-view-store-ws-"));
    expect(store.getSnapshot().view).toBe("cockpit");

    store.setView("sync" as ViewId);
    expect(store.getSnapshot().view).toBe("sync");

    // setView to the same view is a no-op snapshot-wise
    const before = store.getSnapshot();
    store.setView("sync" as ViewId);
    expect(store.getSnapshot()).toBe(before);

    store.cycleView(1);
    expect(store.getSnapshot().view).toBe(nextViewId("sync", 1));
    store.cycleView(-1);
    expect(store.getSnapshot().view).toBe("sync");
    store.setView("cockpit");
    expect(store.getSnapshot().view).toBe("cockpit");
  });
});

describe("t01 view layer — dashboard render", () => {
  test("top bar displays groups and pages use the full content width", async () => {
    const root = makeWorkspace("rt-view-render-ws-");
    const store = makeStore(root, [makeRepo("acme", "api")]);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 140, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(store.getSnapshot().phase).toBe("ready");
    await settle(setup);

    let frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[F10] Views");
    expect(frame).toContain("Workspace ▾");
    expect(frame).toContain("System ▾");
    expect(frame).toContain("[ ] api");

    store.setView("settings");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("Settings");
    expect(frame).toContain("Configuration");
    expect(frame).toContain("sync concurrency");
    expect(frame).toContain("[Esc] Cockpit");

    store.setView("cockpit");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[ ] api");
    await setup.dispose();
  });

  test("v-prefix opens views, Escape returns to cockpit, [ ] cycles", async () => {
    const root = makeWorkspace("rt-view-keys-ws-");
    const store = makeStore(root, [makeRepo("acme", "api")]);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 140, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    setup.mockInput.pressKey("v");
    await settle(setup);
    setup.mockInput.pressKey("a");
    await settle(setup);
    expect(store.getSnapshot().view).toBe("settings");
    expect(norm(setup.captureCharFrame())).toContain("Settings");

    setup.mockInput.pressEscape();
    await settle(setup);
    expect(store.getSnapshot().view).toBe("cockpit");

    setup.mockInput.pressKey("]");
    await settle(setup);
    expect(store.getSnapshot().view).toBe(nextViewId("cockpit", 1));
    setup.mockInput.pressKey("[");
    await settle(setup);
    expect(store.getSnapshot().view).toBe("cockpit");

    // While a page is open, cockpit list keys (like sort cycling) stay inert.
    store.setView("run");
    await settle(setup);
    const sortBefore = store.getSnapshot().sortKey;
    setup.mockInput.pressKey("s");
    await settle(setup);
    expect(store.getSnapshot().sortKey).toBe(sortBefore);
    await setup.dispose();
  });

  test("the top menu opens with F10, navigates groups, and restores the text field on Escape", async () => {
    const root = makeWorkspace("rt-view-menu-focus-");
    const store = makeStore(root, [makeRepo("acme", "api")]);
    await store.ensureInit();
    store.setView("discover");
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 58, height: 18, exitOnCtrlC: false },
    );
    try {
      await settle(setup);
      setup.mockInput.pressKey("F10");
      await settle(setup);
      expect(store.getSnapshot().navFocused).toBe(true);
      expect(norm(setup.captureCharFrame())).toContain("Sync Center");
      expect(norm(setup.captureCharFrame())).toContain("Enter Open");

      setup.mockInput.pressKey("j");
      await settle(setup);
      expect(VIEW_ORDER[store.getSnapshot().navCursor]).toBe("scan");
      expect(store.getSnapshot().discoverPage?.query).toBe("");

      setup.mockInput.pressEscape();
      await settle(setup);
      expect(store.getSnapshot().view).toBe("discover");
      expect(store.getSnapshot().navFocused).toBe(false);
      for (const char of "repo:acme/api [test] #tag @me !fork ?") setup.mockInput.pressKey(char);
      await settle(setup);
      expect(store.getSnapshot().discoverPage?.query).toBe("repo:acme/api [test] #tag @me !fork ?");
      expect(store.getSnapshot().modal).toBeNull();

      setup.mockInput.pressKey("F1");
      await settle(setup);
      const help = norm(setup.captureCharFrame());
      expect(help).toContain("Discover");
      expect(help).toContain("Edit query");
      setup.mockInput.pressEscape();
      await settle(setup);
      setup.mockInput.pressEscape();
      await settle(setup);
      expect(store.getSnapshot().view).toBe("discover");

      setup.mockInput.pressKey("F10");
      await settle(setup);
      setup.mockInput.pressArrow("right");
      await settle(setup);
      expect(VIEW_ORDER[store.getSnapshot().navCursor]).toBe("status");
      setup.mockInput.pressArrow("down");
      await settle(setup);
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().view).toBe("search");
      expect(store.getSnapshot().navFocused).toBe(false);
    } finally {
      await setup.dispose();
    }
  });

  test("Code Search filters and the Run Console profile field work without a mouse", async () => {
    const store = makeStore(makeWorkspace("rt-view-actions-"));
    await store.ensureInit();
    store.setView("search");
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 76, height: 26, exitOnCtrlC: false },
    );
    try {
      await settle(setup);
      setup.mockInput.pressEscape();
      await settle(setup);
      await setup.mockInput.pressKeys(["t", "l", "n"]);
      await settle(setup);
      expect(store.getSnapshot().codeSearchPage).toMatchObject({
        kind: "function",
        lang: "ts",
        limit: 100,
      });
      expect(norm(setup.captureCharFrame())).toContain("[t] kind: function");

      store.setView("run");
      await settle(setup);
      setup.mockInput.pressEscape();
      await settle(setup);
      setup.mockInput.pressKey("s");
      await settle(setup);
      setup.mockInput.pressKey("s");
      await settle(setup);
      expect(norm(setup.captureCharFrame())).toContain("[p] profile");
      setup.mockInput.pressKey("p");
      await settle(setup);
      await setup.mockInput.typeText("core@work");
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().runConsole).toMatchObject({
        scope: "profile",
        profile: "core@work",
        running: false,
      });
    } finally {
      await setup.dispose();
    }
  });

  test.each([
    { width: 58, height: 18 },
    { width: 120, height: 36 },
  ])(
    "every view opens and shows help using only keys ($width × $height)",
    async ({ width, height }) => {
      process.env.REPOTRUCK_CONFIG_DIR = tempDir("rt-keys-all-config-");
      const store = makeStore(makeWorkspace("rt-keys-all-"), [makeRepo("acme", "api")]);
      await store.ensureInit();
      const setup = await testRender(
        <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
        { width, height, exitOnCtrlC: false },
      );
      try {
        await settle(setup);
        let previousGroup = 0;
        for (const [groupIndex, group] of VIEW_MENU_GROUPS.entries()) {
          for (const [index, view] of group.views.entries()) {
            setup.mockInput.pressKey("F10");
            await setup.flush();
            for (let step = previousGroup; step < groupIndex; step++)
              setup.mockInput.pressArrow("right");
            setup.mockInput.pressKey("HOME");
            for (let row = 0; row < index; row++) setup.mockInput.pressArrow("down");
            setup.mockInput.pressEnter();
            await settle(setup);
            expect(store.getSnapshot().view).toBe(view.id);
            expect(norm(setup.captureCharFrame())).toContain("[F1] Help");
            setup.mockInput.pressKey("F1");
            await settle(setup);
            const frame = norm(setup.captureCharFrame());
            expect(frame).toContain("Keyboard shortcuts");
            expect(frame).toContain(view.id === "cockpit" ? "Navigation" : view.title);
            setup.mockInput.pressEscape();
            await settle(setup);
            expect(store.getSnapshot().modal).toBeNull();
            const visible = () => norm(setup.captureCharFrame());
            const press = async (key: string) => {
              setup.mockInput.pressKey(key);
              await settle(setup);
            };
            switch (view.id) {
              case "cockpit":
                await press("TAB");
                expect(store.getSnapshot().focus).toBe("status");
                break;
              case "sync": {
                expect(visible()).toContain("[e] Start Sync");
                const before = store.getSnapshot().syncCenter?.blobless;
                await press("b");
                expect(store.getSnapshot().syncCenter?.blobless).toBe(!before);
                break;
              }
              case "discover":
                await press(":");
                expect(store.getSnapshot().discoverPage?.query).toBe(":");
                break;
              case "scan":
                await press("a");
                expect(store.getSnapshot().dialog?.title).toContain("Adopt");
                setup.mockInput.pressEscape();
                await settle(setup);
                break;
              case "status":
                await press("f");
                expect(visible()).toContain("[x] dirty");
                break;
              case "search":
                setup.mockInput.pressEscape();
                await settle(setup);
                await press("t");
                expect(store.getSnapshot().codeSearchPage?.kind).toBe("function");
                break;
              case "stats":
                await press("TAB");
                expect(visible()).toContain("Doctor checks");
                await press("END");
                break;
              case "changelog":
                await press("7");
                expect(visible()).toContain("[7 · 7d]");
                break;
              case "run":
                setup.mockInput.pressEscape();
                await settle(setup);
                await press("s");
                expect(store.getSnapshot().runConsole?.scope).toBe("pinned");
                break;
              case "presets":
                await press("a");
                expect(visible()).toContain("Add custom preset");
                break;
              case "profiles":
                await press("n");
                expect(visible()).toContain("Enter save profile");
                break;
              case "trash":
                await press("E");
                expect(store.getSnapshot().dialog?.title).toBe("Empty trash");
                setup.mockInput.pressEscape();
                await settle(setup);
                break;
              case "worktree":
                await press("s");
                expect(visible()).toContain("[Enter] Manage worktrees");
                break;
              case "agents":
                if (width < 64) await press("TAB");
                await press("p");
                expect(visible()).toContain("3100");
                break;
              case "settings":
                if (width < 64) await press("TAB");
                expect(visible()).toContain("[l] Login".slice(0, 3));
                await press("r");
                break;
              case "resolve":
                await press("TAB");
                expect(visible()).toContain("Resolution output");
                await press("END");
                break;
              case "log":
                await press("END");
                expect(visible()).toContain("[c] Clear");
                break;
            }
            previousGroup = groupIndex;
          }
        }
      } finally {
        await setup.dispose();
      }
    },
    20_000,
  );

  test("all cockpit windows open with keys and return focus to the repo list", async () => {
    process.env.REPOTRUCK_CONFIG_DIR = tempDir("rt-keyboard-modal-config-");
    const root = makeWorkspace("rt-keyboard-modal-tour-");
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
    );
    const store = makeStore(root, [makeRepo("acme", "api")]);
    await store.ensureInit();
    store.startDeviceFlow = async () => store.openModal({ type: "deviceFlow" });
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 100, height: 28, exitOnCtrlC: false },
    );
    const open = async (
      key: string,
      type: NonNullable<ReturnType<Store["getSnapshot"]>["modal"]>["type"],
    ) => {
      setup.mockInput.pressKey(key);
      await settle(setup);
      expect(store.getSnapshot().modal?.type).toBe(type);
    };
    const close = async () => {
      setup.mockInput.pressEscape();
      await settle(setup);
      expect(store.getSnapshot().modal).toBeNull();
    };
    try {
      await settle(setup);
      for (const [key, type] of [
        ["c", "clone"],
        ["n", "create"],
        ["d", "root"],
        ["w", "workspaces"],
        ["o", "open"],
        ["r", "alias"],
        ["m", "move"],
        ["i", "detail"],
        ["u", "confirmUntrack"],
        ["D", "confirmDelete"],
        ["A", "confirmArchive"],
        ["R", "reorganize"],
        ["W", "worktree"],
        ["/", "search"],
        ["F1", "help"],
      ] as const) {
        await open(key!, type!);
        await close();
      }
      setup.mockInput.pressKey(" ");
      await settle(setup);
      await open("RETURN", "preview");
      await close();

      setup.mockInput.pressArrow("right");
      await settle(setup);
      expect(store.getSnapshot().contextMenu).not.toBeNull();
      setup.mockInput.pressKey("END");
      await settle(setup);
      expect(norm(setup.captureCharFrame())).toContain("Delete permanently");
      await open("RETURN", "confirmPermanentDelete");
      await close();

      await open(":", "omnibar");
      await setup.mockInput.typeText("backup — Backups");
      await settle(setup);
      await open("RETURN", "commandForm");
      setup.mockInput.pressEnter();
      await settle(setup);
      setup.mockInput.pressEscape();
      await settle(setup);
      expect(store.getSnapshot().modal?.type).toBe("commandForm");
      await close();

      await setup.mockInput.pressKeys(["v", "a"]);
      await settle(setup);
      expect(store.getSnapshot().view).toBe("settings");
      await open("l", "deviceFlow");
      await close();
    } finally {
      await setup.dispose();
    }
  }, 20_000);

  test("clicking a group and a dropdown item opens that view", async () => {
    const store = makeStore(makeWorkspace("rt-view-menu-mouse-"));
    await store.ensureInit();
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 36, exitOnCtrlC: false },
    );
    try {
      await settle(setup);
      const click = async (label: string) => {
        const rows = setup.captureCharFrame().split("\n");
        const y = rows.findIndex((row) => row.includes(label));
        expect(y).toBeGreaterThanOrEqual(0);
        await setup.mockMouse.click(rows[y]!.indexOf(label), y);
        await settle(setup);
      };
      await click("Organize ▾");
      expect(store.getSnapshot().navFocused).toBe(true);
      await click("Profiles");
      expect(store.getSnapshot().view).toBe("profiles");
      expect(store.getSnapshot().navFocused).toBe(false);
    } finally {
      await setup.dispose();
    }
  });

  test("narrow and short terminal adapts cockpit to single-pane switcher and stacks views cleanly", async () => {
    const root = makeWorkspace("rt-view-narrow-ws-");
    const store = makeStore(root, [makeRepo("acme", "api")]);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 58, height: 18, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    // In single-pane mode (width=58 < 64), compact pane switcher strip is shown
    let frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[Scope]");
    expect(frame).toContain("[Repos (1)]");
    expect(frame).toContain("[Status]");
    expect(frame).toContain("[ ] api");

    // Tab cycles focus to Status panel in single-pane mode
    store.setFocus("status");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[1]Act");

    // Two-column views stack vertically on narrow terminals without clipping the second panel
    store.setView("trash");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("Trash");
    expect(frame).toContain("Backups");

    await setup.dispose();
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHeaderLine, buildRunningSummary, Dashboard } from "../src/components/Dashboard.tsx";
import { Store, type StoreDeps } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import type { RepoInfo } from "../src/services/github.ts";
import type { UpdateCheckResult, UpdateState } from "../src/services/updater.ts";
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

function makeWorkspace(prefix: string, tracked = true): string {
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
      repos: tracked
        ? [
            {
              owner: "acme",
              name: "api",
              relativePath: "acme/source/api",
              category: "source",
              internal: true,
              language: "TypeScript",
              updatedAt: null,
            },
          ]
        : [],
      aliases: {},
    }),
    "utf8",
  );
  return root;
}

function makeRepo(owner: string, name: string): RepoInfo {
  return {
    owner,
    name,
    description: "repo",
    isPrivate: false,
    isFork: false,
    isArchived: false,
    language: "TypeScript",
    httpsUrl: `https://github.com/${owner}/${name}.git`,
    sshUrl: "",
    updatedAt: "2026-11-19T00:00:00.000Z",
    stars: 3,
  };
}

function makeStore(wsRoot: string, failAuth = false, overrides: StoreDeps = {}): Store {
  const deps: StoreDeps = {
    auth: async () => {
      if (failAuth) throw new Error("no auth configured");
      return { token: "t", method: "gh-cli" };
    },
    github: () => ({
      getUserLogin: async () => "acme",
      getActiveOrgs: async () => ["acme-org"],
      listUserRepos: async () => [makeRepo("acme", "api"), makeRepo("acme", "web")],
      listOrgRepos: async () => [],
      getRepo: async (o, n) => makeRepo(o, n),
      createRepo: async (n) => makeRepo("acme", n),
    }),
    updater: async () => ({
      currentVersion: "0.1.0",
      latestVersion: "9.9.9",
      updateAvailable: true,
    }),
    readUpdateStateFn: async () => ({
      lastCheck: null,
      latestVersion: null,
      dismissedVersion: null,
    }),
    detectAppsFn: async () => [],
    resolveAppFn: async () => null,
    listWorkspacesFn: async () => [],
    ...overrides,
  };
  return new Store(wsRoot, deps);
}

async function settle(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await settleRender(setup);
}

describe("Dashboard helpers and full keyboard surface", () => {
  test("buildHeaderLine and buildRunningSummary", () => {
    expect(buildHeaderLine(40, "a".repeat(80)).endsWith("…")).toBe(true);
    expect(buildRunningSummary([], true)).toContain("press q again to quit");
    expect(
      buildRunningSummary([{ phase: "CLONING" }, { phase: "DONE" }, { phase: "FAILED" }], false),
    ).toContain("1 cloning/pulling · 1 done · 1 failed");
  });

  test.each([
    { width: 40, height: 18 },
    { width: 120, height: 36 },
  ])(
    "checks for updates in the background and shows the whole command ($width × $height)",
    async ({ width, height }) => {
      const ws = makeWorkspace("rt-dash-update-");
      const cached = Promise.withResolvers<UpdateState>();
      const release = Promise.withResolvers<UpdateCheckResult>();
      const store = makeStore(ws, false, {
        readUpdateStateFn: () => cached.promise,
        updater: () => release.promise,
        persistDismissedVersion: async () => {},
      });
      const setup = await testRender(
        <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
        { width, height, exitOnCtrlC: false },
      );
      try {
        for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(store.getSnapshot().phase).toBe("ready");
        expect(store.getSnapshot().updateToast).toBeNull();

        cached.resolve({ lastCheck: null, latestVersion: null, dismissedVersion: null });
        release.resolve({ currentVersion: "1.0.0", latestVersion: "9.9.9", updateAvailable: true });
        await settle(setup);
        const notice = setup
          .captureCharFrame()
          .split("\n")
          .find((line) => line.includes("repotruck update"));
        expect(notice).toContain("9.9.9");
        expect(store.getSnapshot().phase).toBe("ready");

        setup.mockInput.pressKey("x");
        await settle(setup);
        expect(setup.captureCharFrame()).not.toContain("repotruck update");
      } finally {
        await setup.dispose();
      }
    },
  );

  test("error phase supports r retry, o offline, and q quit", async () => {
    const ws = makeWorkspace("rt-dash-err-", false);
    rmSync(path.join(ws, "repotruck.json"));
    const store = makeStore(ws, true);
    let quitCount = 0;
    const setup = await testRender(
      <Dashboard
        store={store}
        onQuit={() => {
          quitCount += 1;
        }}
        onSuspendAndRun={async () => {}}
      />,
      { width: 120, height: 36, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase === "loading"; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await settle(setup);
    expect(store.getSnapshot().phase).toBe("error");

    setup.mockInput.pressKey("q");
    await settle(setup);
    expect(quitCount).toBe(1);

    setup.mockInput.pressKey("r");
    await settle(setup);
    setup.mockInput.pressKey("o");
    for (let i = 0; i < 30 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await settle(setup);
    expect(store.getSnapshot().offline).toBe(true);
    await setup.dispose();
  });

  test("cockpit shortcuts, view prefix (v+key, [, ]), modals, tabs, and double-q quit while running", async () => {
    const ws = makeWorkspace("rt-dash-keys-");
    const store = makeStore(ws, false);
    let quitCount = 0;
    const setup = await testRender(
      <Dashboard
        store={store}
        onQuit={() => {
          quitCount += 1;
        }}
        onSuspendAndRun={async () => {}}
      />,
      { width: 140, height: 42, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await settle(setup);

    // Dismiss update toast with x, cycle tabs 1/2/3, focus cycle
    setup.mockInput.pressKey("x");
    await settle(setup);
    expect(store.getSnapshot().updateToast).toBeNull();

    setup.mockInput.pressKey("2");
    setup.mockInput.pressKey("3");
    setup.mockInput.pressKey("1");
    await settle(setup);
    expect(store.getSnapshot().rightPaneTab).toBe("activity");

    // View cycling [ / ] and v-prefix navigation
    setup.mockInput.pressKey("]");
    await settle(setup);
    expect(store.getSnapshot().view).not.toBe("cockpit");
    setup.mockInput.pressEscape();
    await settle(setup);
    expect(store.getSnapshot().view).toBe("cockpit");

    setup.mockInput.pressKey("[");
    await settle(setup);
    setup.mockInput.pressEscape();
    await settle(setup);

    setup.mockInput.pressKey("v");
    setup.mockInput.pressKey("c");
    await settle(setup);
    expect(store.getSnapshot().view).toBe("changelog");
    setup.mockInput.pressEscape();
    await settle(setup);

    // Omnibar triggers (:, @, #, !) + Escape close
    for (const trigger of [":", "@", "#", "!"]) {
      setup.mockInput.pressKey(trigger);
      await settle(setup);
      expect(store.getSnapshot().modal?.type).toBe("omnibar");
      setup.mockInput.pressEscape();
      await settle(setup);
      expect(store.getSnapshot().modal).toBeNull();
    }

    // Search & Help modal + Escape
    setup.mockInput.pressKey("/");
    await settle(setup);
    expect(store.getSnapshot().modal?.type).toBe("search");
    setup.mockInput.pressEscape();
    await settle(setup);

    setup.mockInput.pressKey("?");
    await settle(setup);
    expect(store.getSnapshot().modal?.type).toBe("help");
    setup.mockInput.pressEscape();
    await settle(setup);

    // List navigation & Shift shortcuts (G, g, j, k, Space, a, right -> ContextMenu -> Escape, i, r, m, o, u, D, A, W)
    setup.mockInput.pressKey("G");
    setup.mockInput.pressKey("g");
    setup.mockInput.pressKey("j");
    setup.mockInput.pressKey("k");
    setup.mockInput.pressKey(" ");
    setup.mockInput.pressKey("a");
    await settle(setup);

    setup.mockInput.pressArrow("right");
    await settle(setup);
    expect(store.getSnapshot().contextMenu).not.toBeNull();
    setup.mockInput.pressEscape();
    await settle(setup);

    setup.mockInput.pressKey("S");
    setup.mockInput.pressKey("P");
    setup.mockInput.pressKey("s");
    setup.mockInput.pressKey("f");
    setup.mockInput.pressKey("t");
    await settle(setup);

    for (const k of ["i", "c", "n", "d", "w", "m", "r", "o", "R", "W"]) {
      setup.mockInput.pressKey(k);
      await settle(setup);
      setup.mockInput.pressEscape();
      await settle(setup);
    }

    // Confirm dialogs from D, A, u
    for (const k of ["D", "A", "u"]) {
      setup.mockInput.pressKey(k);
      await settle(setup);
      setup.mockInput.pressEscape();
      store.resolveDialog(false);
      store.closeModal();
      await settle(setup);
    }

    // Tab focus to status & sidebar
    setup.mockInput.pressKey("\t");
    await settle(setup);
    setup.mockInput.pressKey("j");
    setup.mockInput.pressKey("k");
    setup.mockInput.pressKey("\t");
    await settle(setup);
    setup.mockInput.pressKey("j");
    setup.mockInput.pressKey(" ");
    await settle(setup);

    // Normal q quits once not running
    setup.mockInput.pressKey("q");
    await settle(setup);
    expect(quitCount).toBe(1);
    await setup.dispose();
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store, type StoreDeps, type ViewId } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import {
  nextViewId,
  VIEW_GO_KEYS,
  VIEW_ORDER,
  VIEW_SPECS,
} from "../src/components/views/viewRegistry.ts";
import {
  contentWidth,
  NAV_RAIL_MIN_TERMINAL,
  NAV_RAIL_WIDTH,
  navRailVisible,
} from "../src/components/windowing.ts";
import type { RepoInfo } from "../src/services/github.ts";

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
  await new Promise((resolve) => setTimeout(resolve, 60));
  await setup.flush({ maxPasses: 4 });
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
    const letters = VIEW_SPECS.filter((s) => s.id !== "cockpit").map((s) => s.go);
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

  test("nav rail visibility and content width budget", () => {
    expect(navRailVisible(NAV_RAIL_MIN_TERMINAL)).toBe(true);
    expect(navRailVisible(NAV_RAIL_MIN_TERMINAL - 1)).toBe(false);
    expect(contentWidth(200)).toBe(200 - NAV_RAIL_WIDTH);
    expect(contentWidth(60)).toBe(60);
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
  test("nav rail renders view titles and opens a placeholder page", async () => {
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
    expect(frame).toContain("views");
    expect(frame).toContain("Sync Center");
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
});

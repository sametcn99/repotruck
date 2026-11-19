import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store, type StoreDeps } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import type { RepoStatusLine } from "../src/services/lifecycle.ts";

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
  mkdirSync(path.join(root, "acme", "source", "web"), { recursive: true });
  writeFileSync(
    path.join(root, "repotruck.json"),
    JSON.stringify({
      version: 1,
      root,
      preset: "categorized",
      repos: [
        {
          owner: "acme",
          name: "api",
          relativePath: "acme/source/api",
          category: "source",
          internal: true,
        },
        {
          owner: "acme",
          name: "web",
          relativePath: "acme/source/web",
          category: "source",
          internal: true,
        },
      ],
      aliases: {},
    }),
    "utf8",
  );
  return root;
}

const STATUS_LINES: readonly RepoStatusLine[] = [
  { key: "acme/api", line: "acme/api — dirty", dirty: true, ahead: 2, behind: 0 },
  { key: "acme/web", line: "acme/web — clean", dirty: false, ahead: 0, behind: 3, worktree: true },
];

function makeStore(wsRoot: string): Store {
  const deps: StoreDeps = {
    auth: async () => ({ token: "t", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "u",
      getActiveOrgs: async () => [],
      listUserRepos: async () => [],
      listOrgRepos: async () => [],
      getRepo: async (owner: string, name: string) => ({
        owner, name, description: null, isPrivate: false, isFork: false, isArchived: false,
        language: "TypeScript", httpsUrl: "", sshUrl: "", updatedAt: "2026-10-01T00:00:00.000Z",
      }),
      createRepo: async (name: string) => ({
        owner: "u", name, description: null, isPrivate: false, isFork: false, isArchived: false,
        language: "TypeScript", httpsUrl: "", sshUrl: "", updatedAt: "2026-10-01T00:00:00.000Z",
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
    workspaceStatusFn: async () => ({
      lastSync: "2026-11-19T00:00:00.000Z",
      repos: [...STATUS_LINES],
    }),
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

describe("t05 status matrix", () => {
  test("loads via the service, filters, expands detail, remote toggle adds columns", async () => {
    const root = makeWorkspace("rt-status-view-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    store.setView("status");
    await settle(setup);
    await settle(setup);
    let frame = norm(setup.captureCharFrame());
    expect(frame).toContain("acme/api");
    expect(frame).toContain("dirty");
    expect(frame).toContain("↑2 ↓0");
    expect(frame).toContain("need attention");

    // remote toggle adds PR/CI columns
    store.refreshStatusMatrix(true);
    await settle(setup);
    expect(store.getSnapshot().statusMatrix?.remote).toBe(true);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("PR");
    expect(frame).toContain("CI");

    // filter: dirty narrows to one repo
    setup.mockInput.pressKey("f");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[x] dirty");
    expect(frame).toContain("1 repos");

    await setup.dispose();
  });
});

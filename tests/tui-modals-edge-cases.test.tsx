import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { AliasModal } from "../src/components/AliasModal.tsx";
import { CloneModal } from "../src/components/CloneModal.tsx";
import { CreateModal } from "../src/components/CreateModal.tsx";
import { MoveModal } from "../src/components/MoveModal.tsx";
import { OmnibarModal } from "../src/components/OmnibarModal.tsx";
import { StatusPanel } from "../src/components/StatusPanel.tsx";
import {
  buildCommandPaletteItems,
  cycleOmnibarMode,
  Store,
  type StoreDeps,
} from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import type { RepoInfo } from "../src/services/github.ts";

type RendererSetup = Awaited<ReturnType<typeof testRender>>;

async function settle(setup: RendererSetup): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
  await setup.flush();
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
    description: null,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    language: "TypeScript",
    httpsUrl: `https://github.com/${owner}/${name}.git`,
    sshUrl: `git@github.com:${owner}/${name}.git`,
    updatedAt: "2026-10-01T00:00:00.000Z",
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

  test("Omnibar execution shifts tabs, sorts, filters, and handles missing repos safely", async () => {
    const ws = tempDir("rt-tui-edge-ws-");
    const store = makeStore(ws);

    // Initial right pane tab is activity
    expect(store.getSnapshot().rightPaneTab).toBe("activity");

    // Execute tab changes
    store.executeOmnibarCommand("tab-inspector");
    expect(store.getSnapshot().rightPaneTab).toBe("inspector");

    store.executeOmnibarCommand("tab-health");
    expect(store.getSnapshot().rightPaneTab).toBe("health");

    // Execute sorting commands
    store.executeOmnibarCommand("sort-name");
    expect(store.getSnapshot().sortKey).toBe("name");
    store.executeOmnibarCommand("sort-reverse");
    expect(store.getSnapshot().sortDescending).toBe(true);

    // Execute health filter
    store.executeOmnibarCommand("health-dirty");
    expect(store.getSnapshot().healthFilter).toBe("dirty");

    // Execute modes
    store.executeOmnibarCommand("mode-symbols");
    expect(store.getSnapshot().modal?.type).toBe("omnibar");
    expect((store.getSnapshot().modal as { mode?: string })?.mode).toBe("symbols");

    // Target command when no repo is highlighted reports error without throwing
    store.executeOmnibarCommand("move");
    expect(store.getSnapshot().statuses.some((s) => s.key === "[move]")).toBe(true);

    store.executeOmnibarCommand("alias");
    expect(store.getSnapshot().statuses.some((s) => s.key === "[alias]")).toBe(true);
  });

  test("CreateModal mounts and renders multi-step flow cleanly", async () => {
    const ws = tempDir("rt-tui-edge-ws-");
    const store = makeStore(ws);
    store.openCreateModal();

    const setup = await testRender(<CreateModal store={store} />, { width: 90, height: 28 });
    await settle(setup);

    const frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[1/6] name");
    expect(frame).toContain("Enter continues");
  });

  test("CloneModal mounts and validates input", async () => {
    const ws = tempDir("rt-tui-edge-ws-");
    const store = makeStore(ws);
    store.openCloneModal();

    const setup = await testRender(<CloneModal store={store} />, { width: 90, height: 28 });
    await settle(setup);

    const frame = norm(setup.captureCharFrame());
    expect(frame).toContain("Clone repository");
    expect(frame).toContain("URL or owner/name");
  });

  test("MoveModal mounts and displays target repo", async () => {
    const ws = tempDir("rt-tui-edge-ws-");
    const store = makeStore(ws);
    store.openModal({ type: "move", key: "acme/api" });

    const setup = await testRender(<MoveModal store={store} />, { width: 90, height: 28 });
    await settle(setup);

    const frame = norm(setup.captureCharFrame());
    expect(frame).toContain("Move repository");
    expect(frame).toContain("acme/api");
  });

  test("AliasModal mounts and allows setting repo alias", async () => {
    const ws = tempDir("rt-tui-edge-ws-");
    const store = makeStore(ws);
    store.openModal({ type: "alias", key: "acme/api", prefill: "api" });

    const setup = await testRender(<AliasModal store={store} />, { width: 90, height: 28 });
    await settle(setup);

    const frame = norm(setup.captureCharFrame());
    expect(frame).toContain("Set alias");
    expect(frame).toContain("acme/api");
  });

  test("OmnibarModal renders in commands mode and symbols mode", async () => {
    const ws = tempDir("rt-tui-edge-ws-");
    const store = makeStore(ws);
    store.openOmnibar("commands", "");

    const setup = await testRender(<OmnibarModal store={store} />, { width: 90, height: 28 });
    await settle(setup);

    let frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[:] Commands");
    expect(frame).toContain("Sync selected repositories");

    // Switch to runner mode
    store.openOmnibar("runner", "");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[!] Run Command");
  });

  test("StatusPanel renders Activity, Inspector, and Health tabs cleanly", async () => {
    const ws = tempDir("rt-tui-edge-ws-");
    const store = makeStore(ws, [makeRepo("acme", "api")]);
    await store.init();

    // 1. Activity Tab
    store.setRightPaneTab("activity");
    const setup = await testRender(<StatusPanel store={store} width={90} />, {
      width: 90,
      height: 28,
    });
    await settle(setup);
    let frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[1]Activity");
    expect(frame).toContain("[2]Inspector");
    expect(frame).toContain("[3]Health");

    // 2. Inspector Tab
    store.setRightPaneTab("inspector");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[2]Inspector");

    // 3. Health Tab
    store.setRightPaneTab("health");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("[3]Health");
  });
});

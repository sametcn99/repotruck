import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { clampPanelLine, StatusPanel } from "../src/components/StatusPanel.tsx";
import {
  buildCommandPaletteItems,
  Store,
  type StoreDeps,
  type StoreSnapshot,
} from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import { repoRowLabel } from "../src/components/windowing.ts";
import type { DoctorCheck } from "../src/services/doctor.ts";
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
    description: "repo desc",
    isPrivate: false,
    isFork: false,
    isArchived: false,
    language: "TypeScript",
    httpsUrl: `https://github.com/${owner}/${name}.git`,
    sshUrl: `git@github.com:${owner}/${name}.git`,
    updatedAt: "2026-10-01T00:00:00.000Z",
    stars: 10,
    ...extra,
  };
}

function makeWorkspace(prefix: string): string {
  const root = tempDir(prefix);
  mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
  mkdirSync(path.join(root, "acme", "source", "web"), { recursive: true });
  writeFileSync(
    path.join(root, "repotruck.json"),
    JSON.stringify({
      version: 1,
      root,
      preset: "categorized",
      lastSync: "2026-10-25T00:00:00.000Z",
      repos: [
        {
          owner: "acme",
          name: "api",
          relativePath: "acme/source/api",
          category: "source",
          internal: true,
          language: "TypeScript",
          updatedAt: "2026-10-25T00:00:00.000Z",
        },
        {
          owner: "acme",
          name: "web",
          relativePath: "acme/source/web",
          category: "source",
          internal: true,
          language: "TypeScript",
          updatedAt: "2026-10-25T00:00:00.000Z",
        },
      ],
      aliases: { api: "acme/source/api" },
    }),
    "utf8",
  );
  return root;
}

describe("TUI v2 Store & Cockpit capabilities", () => {
  test("repoRowLabel formats git health, pin, alias, missing, and worktree badges", () => {
    const r = makeRepo("acme", "api", { isFork: true });
    const label = repoRowLabel(r, {
      alias: "api",
      pinned: true,
      missing: false,
      worktree: true,
      dirty: true,
      ahead: 2,
      behind: 1,
    });
    expect(label).toContain("[Fork]");
    expect(label).toContain("[\u2605]");
    expect(label).toContain("[@api]");
    expect(label).toContain("[\u25cf dirty]");
    expect(label).toContain("[\u21912 \u21931]");
    expect(label).toContain("[WT]");

    const missingLabel = repoRowLabel(r, {
      alias: null,
      pinned: false,
      missing: true,
      worktree: false,
      dirty: false,
      ahead: 0,
      behind: 0,
    });
    expect(missingLabel).toContain("[MISSING]");
  });

  test("StatusPanel Health tab clamps ultra-long diagnostics and budgets rows without overlapping header or footer", async () => {
    process.env.REPOTRUCK_CONFIG_DIR = tempDir("rt-v2-health-cfg-");
    const root = makeWorkspace("rt-v2-health-ws-");
    const baseStore = new Store(root);
    const baseSnap = baseStore.getSnapshot();

    expect(clampPanelLine("abcdef", 6)).toBe("abcdef");
    expect(clampPanelLine("abcdefghij", 6)).toBe("abcde\u2026");

    const hugePaths = Array.from(
      { length: 40 },
      (_, idx) => `C:\\Users\\samet\\AppData\\Local\\Temp\\repotruck-reorg-suite-${idx}`,
    ).join(", ");

    const checks: DoctorCheck[] = [
      { check: "git", status: "ok", detail: "git version 2.45.0", formatted: "[ok] git" },
      { check: "gh", status: "ok", detail: "gh version 2.50.0", formatted: "[ok] gh" },
      { check: "token", status: "ok", detail: "authenticated via cached", formatted: "[ok] token" },
      {
        check: "config",
        status: "ok",
        detail: "40 workspace(s) registered",
        formatted: "[ok] config",
      },
      {
        check: "disk",
        status: "warn",
        detail: `missing workspace root(s): ${hugePaths}`,
        formatted: "[warn] disk",
      },
      ...Array.from(
        { length: 10 },
        (_, idx): DoctorCheck => ({
          check: "reorganize",
          status: "fail",
          workspaceRoot: `C:\\Temp\\ws-${idx}`,
          detail: `unfinished reorganize in progress: C:\\Users\\samet\\AppData\\Local\\Temp\\repotruck-doctor-c20-${idx}`,
          formatted: "[fail] reorganize",
        }),
      ),
    ];

    const customSnap: StoreSnapshot = {
      ...baseSnap,
      phase: "ready",
      rightPaneTab: "health",
      statusScroll: 0,
      healthData: {
        loading: false,
        stats: {
          languages: [{ language: "TypeScript", count: 2 }],
          categories: { source: 2, forks: 0, archived: 0, custom: 0 },
          disk: { repoCount: 2, totalSizeBytes: 2048 },
          stale: { totalStale: 0, topStalest: [] },
          formatted: "stats",
        },
        trashCount: 0,
        trashBytes: 0,
        checks,
      },
    };

    const fakeStore = {
      subscribe: () => () => {},
      getSnapshot: () => customSnap,
      setFocus: () => {},
      setRightPaneTab: () => {},
      moveStatusScroll: () => {},
      runHealthDoctorFix: async () => {},
    } as unknown as Store;

    const setup = await testRender(<StatusPanel store={fakeStore} width={38} />, {
      width: 38,
      height: 18,
      exitOnCtrlC: false,
    });
    try {
      await settle(setup);
      const rawLines = norm(setup.captureCharFrame()).split("\n");
      const tabLine = rawLines.find((l) => l.includes("[3]Health"));
      const autoFixLine = rawLines.find((l) => l.includes("[F] Run Doctor Auto-Fix"));
      const diskWarnLine = rawLines.find((l) => l.includes("[warn] disk:"));

      expect(tabLine).toBeDefined();
      expect(tabLine).not.toContain("[warn]");
      expect(diskWarnLine).toBeDefined();
      expect(diskWarnLine).toContain("\u2026");
      expect(autoFixLine).toBeDefined();
      expect(autoFixLine).not.toContain("reorganize");
    } finally {
      await setup.dispose();
    }
  });

  test("Omnibar modes (commands, symbols, github, runner), bulk actions, pinning, tabs, and theme cycle", async () => {
    process.env.REPOTRUCK_CONFIG_DIR = tempDir("rt-v2-cfg-");
    const root = makeWorkspace("rt-v2-ws-");
    const archivedKeys: string[] = [];
    const runnerCalls: Array<{
      command: string;
      args: readonly string[];
      refs: readonly string[];
    }> = [];

    const deps: StoreDeps = {
      auth: async () => ({ token: "tok", method: "gh-cli" }),
      github: () => ({
        getUserLogin: async () => "acme",
        getActiveOrgs: async () => [],
        listUserRepos: async () => [
          makeRepo("acme", "api", { stars: 50 }),
          makeRepo("acme", "web", { stars: 5 }),
        ],
        listOrgRepos: async () => [],
        getRepo: async (o, n) => makeRepo(o, n),
        createRepo: async (n) => makeRepo("acme", n),
        searchRepos: async (q) => [makeRepo("octo", `found-${q}`, { stars: 99 })],
        archiveRepo: async (o, n) => {
          archivedKeys.push(`${o}/${n}`);
          return makeRepo(o, n, { isArchived: true });
        },
      }),
      updater: async () => ({
        currentVersion: "0.3.0",
        latestVersion: null,
        updateAvailable: false,
      }),
      readUpdateStateFn: async () => ({
        lastCheck: null,
        latestVersion: null,
        dismissedVersion: null,
      }),
      searchCodeFn: async ({ pattern, text }) => ({
        matches: [
          {
            repo: "acme/api",
            path: "acme/source/api/src/index.ts",
            line: 12,
            kind: text ? "text" : "function",
            name: `match_${pattern}`,
            exported: true,
            formatted: `acme/api:acme/source/api/src/index.ts:12: ${pattern}`,
          },
        ],
        index: {
          built: false,
          filesIndexed: 1,
          filesReused: 1,
          filesSkippedLarge: 0,
          filesSkippedUnknown: 0,
          symbols: 1,
          durationMs: 1,
        },
      }),
      runInReposFn: async (opts) => {
        runnerCalls.push({ command: opts.command, args: opts.args ?? [], refs: opts.refs });
        return {
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
        };
      },
      archiveRepoFn: async (_r, _c, ref) => {
        archivedKeys.push(ref);
        return { ok: true, message: `archived ${ref}` };
      },
    };

    const store = new Store(root, deps);
    await store.ensureInit();
    // Calling ensureInit again does not reset state (B4 fix)
    store.moveCursor(1);
    await store.ensureInit();
    expect(store.getSnapshot().cursor).toBe(1);
    store.setCursor(0);

    // Pinning & health filter
    await store.togglePinSelection();
    expect(store.getSnapshot().pinnedCount).toBe(1);
    for (let i = 0; i < 6; i += 1) {
      store.cycleHealthFilter();
      if (store.getSnapshot().healthFilter === "pinned") {
        expect(store.getSnapshot().filteredRepos.map((r) => r.name)).toEqual(["api"]);
      }
    }
    while (store.getSnapshot().healthFilter !== "all") {
      store.cycleHealthFilter();
    }

    // Theme & sort direction
    const initialTheme = store.getSnapshot().themeName;
    await store.cycleTheme();
    expect(store.getSnapshot().themeName).not.toBe(initialTheme);
    activateTheme("default");
    store.setSortKey("stars");
    expect(store.getSnapshot().filteredRepos[0]!.name).toBe("api");
    store.toggleSortDirection();
    expect(store.getSnapshot().sortDescending).toBe(true);
    expect(store.getSnapshot().filteredRepos[0]!.name).toBe("web");

    // Right pane tabs (Activity -> Inspector -> Health)
    store.setRightPaneTab("inspector");
    await new Promise((r) => setTimeout(r, 40));
    expect(store.getSnapshot().inspector?.key).toBe("acme/web");

    store.setRightPaneTab("health");
    await new Promise((r) => setTimeout(r, 80));
    expect(store.getSnapshot().healthData).not.toBeNull();
    store.setRightPaneTab("activity");

    // Omnibar modes
    store.openOmnibar("commands");
    expect(store.getSnapshot().modal?.type).toBe("omnibar");
    store.executeOmnibarCommand("sort-stars");
    expect(store.getSnapshot().sortKey).toBe("stars");

    store.openOmnibar("symbols");
    await store.updateOmnibarQuery("handleAuth");
    expect(store.getSnapshot().omnibarSymbols.length).toBe(1);
    expect(store.getSnapshot().omnibarSymbols[0]!.line).toBe(12);

    store.cycleOmnibarTab();
    expect(store.getSnapshot().modal).toEqual({ type: "omnibar", mode: "github", query: "" });
    await store.updateOmnibarQuery("router");
    expect(store.getSnapshot().omnibarGithubRepos[0]!.name).toBe("found-router");

    store.openOmnibar("runner");
    await store.submitOmnibarRunner("git status -s");
    expect(runnerCalls.length).toBe(1);
    expect(runnerCalls[0]!.command).toBe("git");
    expect(runnerCalls[0]!.args).toEqual(["status", "-s"]);

    // Bulk archive confirmation
    store.selectAll();
    store.openSelectionArchiveConfirm();
    const modal = store.getSnapshot().modal;
    expect(modal?.type).toBe("confirmArchive");
    if (modal?.type === "confirmArchive") {
      await store.confirmArchive(modal.key, modal.keys);
    }
    expect(archivedKeys.sort()).toEqual(["acme/api", "acme/web"]);
  });

  test("Offline fallback screen (o) and CreateModal step-1 immediate name validation (B7)", async () => {
    process.env.REPOTRUCK_CONFIG_DIR = tempDir("rt-v2-err-cfg-");
    const root = makeWorkspace("rt-v2-err-ws-");
    const store = new Store(root, {
      auth: async () => {
        throw new Error("no GitHub token");
      },
      updater: async () => ({
        currentVersion: "0.3.0",
        latestVersion: null,
        updateAvailable: false,
      }),
      readUpdateStateFn: async () => ({
        lastCheck: null,
        latestVersion: null,
        dismissedVersion: null,
      }),
    });

    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 28, exitOnCtrlC: false },
    );
    try {
      for (let i = 0; i < 30 && store.getSnapshot().phase === "loading"; i += 1) {
        await new Promise((r) => setTimeout(r, 25));
      }
      await settle(setup);
      expect(store.getSnapshot().phase).toBe("error");
      expect(norm(setup.captureCharFrame())).toContain("Offline Mode");

      // Press o to enter offline mode with local workspace inventory
      setup.mockInput.pressKey("o");
      await settle(setup);
      for (let i = 0; i < 30 && store.getSnapshot().phase !== "ready"; i += 1) {
        await new Promise((r) => setTimeout(r, 25));
      }
      await settle(setup);
      expect(store.getSnapshot().phase).toBe("ready");
      expect(store.getSnapshot().offline).toBe(true);
      expect(store.getSnapshot().repos.length).toBe(2);

      // Test CreateModal step 1 rejects invalid name "-bad" before advancing to step 2 (B7)
      setup.mockInput.pressKey("n");
      await settle(setup);
      await setup.mockInput.typeText("-bad");
      await settle(setup);
      setup.mockInput.pressEnter();
      await settle(setup);
      const modal = store.getSnapshot().modal;
      expect(modal?.type).toBe("create");
      if (modal?.type === "create") {
        expect(modal.step).toBe("name");
      }
      expect(store.getSnapshot().modalError).toContain("invalid repository name");
      setup.mockInput.pressEscape();
      await settle(setup);

      // Test ':' opens Omnibar and lets user browse ALL commands without typing anything
      const totalCmds = buildCommandPaletteItems("", store.getSnapshot()).length;
      expect(totalCmds).toBeGreaterThanOrEqual(45);

      setup.mockInput.pressKey(":");
      await settle(setup);
      expect(store.getSnapshot().modal?.type).toBe("omnibar");
      const initialOmnibarFrame = norm(setup.captureCharFrame());
      expect(initialOmnibarFrame).toContain("Omnibar");
      expect(initialOmnibarFrame).toContain(`1/${totalCmds} commands`);
      expect(initialOmnibarFrame).not.toContain("\\u00b7");
      expect(initialOmnibarFrame).toContain("Tab switches mode \u00b7");

      // Press Up once (no typing!) to wrap around to the very last command and verify windowing scrolls
      setup.mockInput.pressArrow("up");
      await settle(setup);
      const bottomOmnibarFrame = norm(setup.captureCharFrame());
      expect(bottomOmnibarFrame).toContain(`${totalCmds}/${totalCmds} commands`);
      expect(bottomOmnibarFrame).toContain("Show all keyboard shortcuts");
      expect(bottomOmnibarFrame).toContain("Empty workspace .repotruck/trash");

      // Press Enter on the bottom command ("help") without typing anything
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().modal?.type).toBe("help");
      setup.mockInput.pressEscape();
      await settle(setup);
    } finally {
      await setup.dispose();
    }
  }, 20_000);
});

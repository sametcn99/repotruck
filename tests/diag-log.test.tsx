import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { buildCommandPaletteItems, Store, type StoreDeps } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import { VIEW_GO_KEYS } from "../src/components/views/viewRegistry.ts";
import {
  DIAG_LOG_CAP,
  diagClear,
  diagResetForTest,
  diagSnapshot,
  diagSubscribe,
  logDiag,
  warnQuiet,
} from "../src/services/diagnostics.ts";
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
  activateTheme("default");
  diagResetForTest();
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
  diagResetForTest();
});

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

function makeStore(wsRoot: string): Store {
  const repos: RepoInfo[] = [];
  const deps: StoreDeps = {
    auth: async () => ({ token: "fake-token", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "acme-user",
      getActiveOrgs: async () => [],
      listUserRepos: async () => repos,
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
        owner: "acme-user",
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

describe("diagnostics log sink", () => {
  test("records entries, notifies subscribers, caps the buffer and clears", () => {
    let notifications = 0;
    const unsubscribe = diagSubscribe(() => {
      notifications += 1;
    });
    const entry = logDiag("error", "[runtime]", "boom");
    expect(entry.level).toBe("error");
    expect(diagSnapshot().at(-1)?.message).toBe("boom");
    expect(notifications).toBe(1);

    diagResetForTest();
    for (let i = 0; i < DIAG_LOG_CAP + 50; i += 1) logDiag("info", "[t]", `e${i}`);
    expect(diagSnapshot().length).toBe(DIAG_LOG_CAP);
    expect(diagSnapshot()[0]?.message).toBe("e50");

    diagClear();
    expect(diagSnapshot().length).toBe(0);
    unsubscribe();
  });

  test("warnQuiet captures every swallowed warning even when not verbose", () => {
    delete process.env.REPOTRUCK_VERBOSE;
    const before = diagSnapshot().length;
    warnQuiet("auth: cached login read failed", new Error("nope"));
    const last = diagSnapshot().at(-1);
    expect(last?.level).toBe("warn");
    expect(last?.source).toBe("auth: cached login read failed");
    expect(last?.message).toBe("nope");
    expect(diagSnapshot().length).toBe(before + 1);
  });

  test("logDiag flattens error objects and tolerates empty payloads", () => {
    const entry = logDiag("error", "[x]", new Error("line one\nline two"));
    expect(entry.message).toBe("line one");
    expect(logDiag("warn", "[x]", undefined).message).toBe("");
  });
});

describe("diag toasts & Log view", () => {
  test("background diag errors raise a toast on every view, cockpit included", async () => {
    const store = makeStore(makeWorkspace("rt-diag-toast-"));
    await store.ensureInit();
    expect(store.getSnapshot().view).toBe("cockpit");

    logDiag("error", "[runtime]", "unhandled rejection: boom");
    const toast = store.getSnapshot().toast;
    expect(toast?.phase).toBe("FAILED");
    expect(toast?.message).toBe("[runtime] — unhandled rejection: boom");
    store.dismissToast();

    await store.ensureInit();
    store.setView("stats");
    logDiag("error", "[octokit]", "GET /repos/a/b - 500");
    expect(store.getSnapshot().toast?.message).toBe("[octokit] — GET /repos/a/b - 500");
    store.dismissToast();
  });

  test("FAILED statuses land in the log once, marked fromStatus, without a second toast", async () => {
    const store = makeStore(makeWorkspace("rt-diag-status-"));
    await store.ensureInit();
    store.setView("stats");
    store.pushStatus("FAILED", "[stats]", "copy failed");
    // The status mirror toasted it exactly once…
    expect(store.getSnapshot().toast?.message).toBe("[stats] — copy failed");
    store.dismissToast();
    // …and the diag log captured it once, flagged as status-born.
    const hits = diagSnapshot().filter(
      (entry) => entry.source === "[stats]" && entry.fromStatus === true,
    );
    expect(hits.length).toBe(1);
    expect(hits[0]?.level).toBe("error");
  });

  test("Log view lists entries newest-first, clears via c, and is reachable from the palette", async () => {
    diagResetForTest();
    logDiag("error", "[octokit]", "GET /repos/a/b/pulls - 404");
    logDiag("warn", "[auth]", "token refresh skipped");
    expect(VIEW_GO_KEYS.get("l")).toBe("log");

    const store = makeStore(makeWorkspace("rt-diag-view-"));
    await store.ensureInit();
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 100, height: 30, exitOnCtrlC: false },
    );
    await settle(setup);

    store.setView("log");
    await settle(setup);
    let frame = norm(setup.captureCharFrame());
    // Store init may also capture real warnQuiet entries (settings reads in
    // the isolated config dir), so assert on markers, not exact counts.
    expect(frame).toContain("diagnostics log ·");
    expect(frame).toContain("ERR [octokit] — GET /repos/a/b/pulls - 404");
    // Newest entry (the warning) renders above the older error.
    expect(frame.indexOf("WRN [auth] — token refresh skipped")).toBeLessThan(
      frame.indexOf("GET /repos/a/b/pulls - 404"),
    );

    setup.mockInput.pressKey("c");
    await settle(setup);
    frame = norm(setup.captureCharFrame());
    expect(frame).toContain("no diagnostics captured yet");

    expect(
      buildCommandPaletteItems("", store.getSnapshot()).some((item) => item.id === "view:log"),
    ).toBe(true);

    await setup.dispose();
    diagResetForTest();
  });
});

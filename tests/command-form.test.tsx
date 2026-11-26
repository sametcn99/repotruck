import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REGISTRY_BY_ID } from "../src/commands/registry.ts";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { executeRegistryCommand } from "../src/components/store/modalWorkflows.ts";
import { Store, type StoreDeps, type StoreSnapshot } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import { buildCliArguments, defaultFieldValues } from "../src/components/ui/FieldGroup.tsx";
import { settleRender, testRender, waitForDashboardReady } from "./helpers/render.tsx";

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
  mkdirSync(path.join(root, "acme", "source"), { recursive: true });
  writeFileSync(
    path.join(root, "repotruck.json"),
    JSON.stringify({ version: 1, root, preset: "categorized", repos: [], aliases: {} }),
    "utf8",
  );
  return root;
}

function makeStore(wsRoot: string): Store {
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
        httpsUrl: `https://github.com/${owner}/${name}.git`,
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

describe("t04 command form", () => {
  test("palette opens the form for flag-bearing commands, direct for the rest", () => {
    const store = makeStore(makeWorkspace("rt-cform-dispatch-"));
    executeRegistryCommand(store, "sync");
    const modal = store.getSnapshot().modal;
    expect(modal?.type).toBe("commandForm");
    if (modal?.type === "commandForm") expect(modal.specId).toBe("sync");

    // no-flag view command navigates directly
    executeRegistryCommand(store, "trash");
    expect(store.getSnapshot().modal).toBeNull();
    expect(store.getSnapshot().view).toBe("trash");

    // action surface dispatches directly (confirm flow)
    executeRegistryCommand(store, "doctor");
    const snap: StoreSnapshot = store.getSnapshot();
    expect(snap.modal).toBeNull();
  });

  test("form renders flags, live CLI line, and Run reports until the page lands", async () => {
    const root = makeWorkspace("rt-cform-render-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 44, exitOnCtrlC: false },
    );
    await waitForDashboardReady(setup, store);

    store.openCommandForm("sync");
    await settle(setup);
    const frame = norm(setup.captureCharFrame());
    expect(frame).toContain("sync — Sync Center");
    expect(frame).toContain("--divergence");
    expect(frame).toContain("$ repotruck sync");

    // Run on a page-ticket command logs the exact CLI line
    const before = store.getSnapshot().statuses.length;
    const spec = REGISTRY_BY_ID.get("sync")!;
    const values = defaultFieldValues(spec.flags);
    values["--stash"] = true;
    const cli = buildCliArguments("repotruck sync", spec.flags, values);
    expect(cli).toContain("--stash");
    expect(cli).not.toContain("--divergence");

    // Click Run via the store-level path used by the button
    store.beginTask("dbg", "sync");
    store.endTask("dbg", "done");
    const statuses = store.getSnapshot().statuses;
    expect(statuses.length).toBeGreaterThan(before);
    expect(store.getSnapshot().activeTaskCount).toBe(0);
    await setup.dispose();
  });

  test("task model tracks running count", () => {
    const store = makeStore(makeWorkspace("rt-cform-task-"));
    expect(store.getSnapshot().activeTaskCount).toBe(0);
    store.beginTask("mcp", "mcp --http");
    expect(store.getSnapshot().activeTaskCount).toBe(1);
    store.beginTask("run", "bun test");
    expect(store.getSnapshot().activeTaskCount).toBe(2);
    store.endTask("mcp", "stopped");
    expect(store.getSnapshot().activeTaskCount).toBe(1);
    store.cancelTask("run");
    expect(store.getSnapshot().activeTaskCount).toBe(0);
    const last = store.getSnapshot().statuses.at(-1);
    expect(last?.message).toContain("cancelled");
  });
});

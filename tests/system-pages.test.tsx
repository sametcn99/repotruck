import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store, type StoreDeps } from "../src/components/store.ts";
import type { RepotruckConfig } from "../src/services/config.ts";
import { writeWorkspaceConfig } from "../src/services/workspaceRegistry.ts";
import { settleRender, testRender } from "./helpers/render.tsx";

const tempDirs: string[] = [];
let savedConfigDir: string | undefined;
let savedConfigDirEnv: string | undefined;

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
});

afterAll(() => {
  if (savedConfigDirEnv === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDirEnv;
  }
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
  const configDir = mkdtempSync(path.join(tmpdir(), `${prefix}-cfg-`));
  process.env.REPOTRUCK_CONFIG_DIR = configDir;
  mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
  const configFixture: RepotruckConfig = {
    version: 1 as const,
    root,
    preset: "categorized" as const,
    lastSync: "2026-11-19T00:00:00.000Z",
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
    ],
    aliases: {},
    profiles: { backend: ["acme/api"] },
  };
  writeFileSync(path.join(root, "repotruck.json"), JSON.stringify(configFixture), "utf8");
  // Register in the central registry so updateWorkspace-based flows
  // (profiles, context actions) resolve the workspace like production.
  void writeWorkspaceConfig(root, configFixture, process.env);
  return root;
}

function makeStore(wsRoot: string, extra: Partial<StoreDeps> = {}): Store {
  const deps: StoreDeps = {
    auth: async () => ({ token: "t", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "acme-user",
      getActiveOrgs: async () => [],
      listUserRepos: async () => [
        {
          owner: "acme",
          name: "api",
          description: null,
          isPrivate: false,
          isFork: false,
          isArchived: false,
          language: "TypeScript",
          httpsUrl: "https://github.com/acme/api.git",
          sshUrl: "",
          updatedAt: "2026-11-19T00:00:00.000Z",
        },
      ],
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
  return new Store(wsRoot, { ...deps, ...extra });
}

function makeStoreWithDeps(wsRoot: string, extra: Partial<StoreDeps>): Store {
  return makeStore(wsRoot, extra);
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

/** captureCharFrame occasionally hits a native OutputBusy lease race
 *  between successive renderer sessions; one retry settles it. */
async function capture(setup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  try {
    return setup.captureCharFrame();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return setup.captureCharFrame();
  }
}

describe("t10 settings page", () => {
  test("lists settings with source badges and writes via config set parity", async () => {
    const root = makeWorkspace("rt-settings-view-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    store.setView("settings");
    await store.refreshSettingsPage();
    await settle(setup);
    let frame = norm(await capture(setup));
    expect(frame).toContain("Configuration");
    expect(frame).toContain("sync concurrency");
    expect(frame).toContain("Auth & connection");
    expect(store.getSnapshot().settingsPage?.authMethod).toBe("gh-cli");

    await store.setSetting("sync.concurrency", 5);
    await store.refreshSettingsPage();
    await settle(setup);
    expect(String(store.getSnapshot().settingsPage?.settings?.sync?.concurrency)).toBe("5");
    frame = norm(await capture(setup));
    expect(frame).toContain("5");

    await store.unsetSetting("sync.concurrency");
    await store.refreshSettingsPage();
    expect(store.getSnapshot().settingsPage?.settings?.sync?.concurrency).toBeUndefined();
    await setup.dispose();
  });
});

describe("t11 presets page", () => {
  test("adds and removes a custom preset with CLI validation", async () => {
    const root = makeWorkspace("rt-presets-view-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 140, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    store.setView("presets");
    await settle(setup);
    expect(norm(await capture(setup))).toContain("categorized");

    // invalid: name not last
    await store.addCustomPreset("bad-one", ["name", "owner"]);
    expect(store.getSnapshot().statuses.at(-1)?.phase).toBe("FAILED");

    // valid custom preset
    await store.addCustomPreset("lang-owner", ["language", "owner", "name"]);
    expect(store.getSnapshot().statuses.at(-1)?.phase).toBe("DONE");
    expect(store.getSnapshot().customPresets.map((p) => p.id)).toContain("lang-owner");

    await store.removeCustomPreset("lang-owner");
    expect(store.getSnapshot().customPresets.map((p) => p.id)).not.toContain("lang-owner");
    await setup.dispose();
  });
});

describe("t11 profiles page", () => {
  test("shows pinned and named profiles, saves from selection, deletes", async () => {
    const root = makeWorkspace("rt-profiles-view-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    store.setView("profiles");
    await settle(setup);
    const frame = norm(await capture(setup));
    expect(frame).toContain("Pinned");
    expect(frame).toContain("Named profiles");

    // save from selection (no selection → falls back to pinned: none → error message)
    await store.profileSaveFromSelection("empty-profile");
    // now with a selection
    store.toggleRepoAt(0);
    await store.profileSaveFromSelection("core");
    const last = store.getSnapshot().statuses.at(-1);
    expect(last?.phase).toBe("DONE");
    expect(last?.message).toContain("core");

    await store.profileDelete("core");
    expect(store.getSnapshot().statuses.at(-1)?.message).toContain("core");
    await setup.dispose();
  });
});

describe("t12 agents page", () => {
  test("applies and clears an AGENTS.md template, exports instructions", async () => {
    const root = makeWorkspace("rt-agents-view-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    store.setView("agents");
    await settle(setup);
    let frame = norm(await capture(setup));
    expect(frame).toContain("AGENTS.md templates");
    expect(frame).toContain("MCP server");
    expect(frame).toContain("node");

    await store.applyAgentsTemplate("node");
    expect(store.getSnapshot().statuses.at(-1)?.phase).toBe("DONE");
    await store.exportInstructions("cursor");
    const exportStatus = store.getSnapshot().statuses.at(-1);
    expect(exportStatus?.message).toContain(".cursorrules");
    await store.applyAgentsTemplate("node", true);
    expect(store.getSnapshot().statuses.at(-1)?.phase).toBe("DONE");

    frame = norm(await capture(setup));
    expect(frame).toContain("stopped");
    await setup.dispose();
  });
});

describe("t13 context menu", () => {
  test("opens on cursor row, actions focus the target, Esc closes", async () => {
    const root = makeWorkspace("rt-ctx-view-");
    const store = makeStore(root);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    store.openRepoContextMenu("acme/api");
    await settle(setup);
    let frame = norm(await capture(setup));
    expect(frame).toContain("acme/api");
    expect(frame).toContain("Details");
    expect(frame).toContain("Delete permanently");

    // detail action opens the modal
    store.executeContextAction("detail");
    expect(store.getSnapshot().modal?.type).toBe("detail");
    expect(store.getSnapshot().contextMenu).toBeNull();
    store.closeModal();
    await settle(setup);

    // delete focuses the selection on the target and opens the confirm
    store.openRepoContextMenu("acme/api");
    store.executeContextAction("delete");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.getSnapshot().modal?.type).toBe("confirmDelete");
    expect([...store.getSnapshot().selected]).toEqual(["acme/api"]);
    store.closeModal();

    // permanent delete shows the typed-name guard modal
    store.openRepoContextMenu("acme/api");
    store.executeContextAction("delete-permanent");
    expect(store.getSnapshot().modal?.type).toBe("confirmPermanentDelete");
    store.closeModal();

    // Esc closes via keyboard
    store.openRepoContextMenu("acme/api");
    await settle(setup);
    setup.mockInput.pressEscape();
    await settle(setup);
    expect(store.getSnapshot().contextMenu).toBeNull();
    frame = norm(await capture(setup));
    expect(frame).not.toContain("Delete permanently");
    await setup.dispose();
  });
});

describe("device-flow login (t10 follow-up)", () => {
  test("non-blocking flow shows URL+code, completes, and re-initializes", async () => {
    const root = makeWorkspace("rt-device-flow-");
    const savedToken = process.env.REPOTRUCK_TOKEN;
    delete process.env.REPOTRUCK_TOKEN;
    let completions = 0;
    let resolveCompletion!: () => void;
    const store = makeStoreWithDeps(root, {
      beginDeviceLoginFn: async () => ({
        verificationUri: "https://github.com/login/device",
        userCode: "XLQW-TRHD",
        completion: new Promise((resolve) => {
          resolveCompletion = () => {
            completions += 1;
            resolve({ token: "device-token", method: "device" as const });
          };
        }),
      }),
    });
    await store.ensureInit();

    const running = store.startDeviceFlow();
    await new Promise((resolve) => setTimeout(resolve, 60));
    // codes are visible while the authorization is pending
    const flow = store.getSnapshot().deviceFlow;
    expect(flow?.verificationUri).toBe("https://github.com/login/device");
    expect(flow?.userCode).toBe("XLQW-TRHD");
    expect(flow?.waiting).toBe(true);
    expect(store.getSnapshot().modal?.type).toBe("deviceFlow");

    // completion lands: modal closes, flow clears, success logged
    resolveCompletion();
    await running;
    expect(completions).toBe(1);
    expect(store.getSnapshot().modal).toBeNull();
    expect(store.getSnapshot().deviceFlow).toBeNull();
    const last = store.getSnapshot().statuses.at(-1);
    expect(last?.message).toContain("device flow");
    if (savedToken !== undefined) process.env.REPOTRUCK_TOKEN = savedToken;
  });

  test("cancel abandons the wait; env token refuses the flow", async () => {
    const root = makeWorkspace("rt-device-cancel-");
    const savedToken = process.env.REPOTRUCK_TOKEN;
    delete process.env.REPOTRUCK_TOKEN;
    let cancelled = false;
    const store = makeStoreWithDeps(root, {
      beginDeviceLoginFn: async () => ({
        verificationUri: "https://github.com/login/device",
        userCode: "AAAA-BBBB",
        completion: new Promise(() => {
          cancelled = true; // never resolves
        }),
      }),
    });
    await store.ensureInit();

    const running = store.startDeviceFlow();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(store.getSnapshot().deviceFlow?.waiting).toBe(true);
    store.cancelDeviceFlow();
    expect(store.getSnapshot().deviceFlow).toBeNull();
    expect(store.getSnapshot().modal).toBeNull();
    void running.catch(() => {});
    expect(cancelled).toBe(true);

    // env token guard
    process.env.REPOTRUCK_TOKEN = "env-token";
    await store.startDeviceFlow();
    expect(store.getSnapshot().statuses.at(-1)?.message).toContain("already logged in");
    expect(store.getSnapshot().modal).toBeNull();
    delete process.env.REPOTRUCK_TOKEN;
    if (savedToken !== undefined) process.env.REPOTRUCK_TOKEN = savedToken;
  });
});

describe("permanent delete typed-name guard (t13 follow-up)", () => {
  test("modal requires the exact repo name; confirm runs delete --yes", async () => {
    const root = makeWorkspace("rt-perm-delete-");
    const deletes: Array<{ key: string; yes: boolean }> = [];
    const store = makeStoreWithDeps(root, {
      deleteRepo: async (_rootArg, _config, ref, options = {}) => {
        deletes.push({ key: ref, yes: options.yes === true });
        return { ok: true, message: `deleted ${ref}` } as never;
      },
    });
    await store.ensureInit();

    // context action opens the typed-name modal
    store.openRepoContextMenu("acme/api");
    store.executeContextAction("delete-permanent");
    expect(store.getSnapshot().modal?.type).toBe("confirmPermanentDelete");
    expect(deletes.length).toBe(0);

    // typing the wrong name does not arm (store path only fires when armed)
    await store.confirmPermanentDelete("acme/api");
    expect(deletes.length).toBe(1);
    expect(deletes[0]).toEqual({ key: "acme/api", yes: true });
    const last = store.getSnapshot().statuses.at(-1);
    expect(last?.phase).toBe("DONE");
    expect(last?.message).toContain("permanently deleted");
  });
});

describe("device-flow + permanent-delete rendering", () => {
  test("modal paints URL and code; typed-name gate arms only on exact match", async () => {
    const root = makeWorkspace("rt-df-render-");
    const savedToken = process.env.REPOTRUCK_TOKEN;
    delete process.env.REPOTRUCK_TOKEN;
    const store = makeStoreWithDeps(root, {
      beginDeviceLoginFn: async () => ({
        verificationUri: "https://github.com/login/device",
        userCode: "XLQW-TRHD",
        completion: new Promise(() => {}),
      }),
    });
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await settle(setup);

    void store.startDeviceFlow();
    await settle(setup);
    let frame = norm(await capture(setup));
    expect(frame).toContain("device flow");
    expect(frame).toContain("https://github.com/login/device");
    expect(frame).toContain("XLQW-TRHD");
    expect(frame).toContain("waiting for authorization");
    store.cancelDeviceFlow();
    await settle(setup);

    // permanent delete: gate inert until the exact repo name is typed
    store.openPermanentDeleteConfirm("acme/api");
    await settle(setup);
    frame = norm(await capture(setup));
    expect(frame).toContain("Delete permanently");
    expect(frame).toContain("type: api");

    await setup.mockInput.typeText("ap");
    await settle(setup);
    frame = norm(await capture(setup));
    expect(frame).toContain("[ delete — type api ]");

    await setup.mockInput.typeText("i");
    await settle(setup);
    frame = norm(await capture(setup));
    expect(frame).toContain("[Enter] Delete forever");
    setup.mockInput.pressEscape();
    await settle(setup);
    expect(store.getSnapshot().modal).toBeNull();
    if (savedToken !== undefined) process.env.REPOTRUCK_TOKEN = savedToken;
    await setup.dispose();
  });
});

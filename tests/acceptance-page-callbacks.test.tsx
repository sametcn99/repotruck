import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store } from "../src/components/store.ts";
import { activateTheme } from "../src/components/theme.ts";
import { terminalWidth } from "../src/components/windowing.ts";
import { SETTINGS_FILENAME } from "../src/services/settings.ts";
import { readWorkspaceConfig } from "../src/services/workspaceRegistry.ts";
import { storeDeps, waitUntil, workspaceFixture } from "./helpers/hardening.ts";
import { settleRender, testRender, waitForDashboardReady } from "./helpers/render.tsx";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];
const stores: Store[] = [];
const pendingWriters = new WeakMap<Store, Set<Promise<unknown>>>();
const writerFailures = new WeakMap<Store, unknown[]>();
const priorConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
activateTheme("default");

const asyncWriterMethods = [
  "cycleTheme",
  "setSetting",
  "unsetSetting",
  "addCustomPreset",
  "removeCustomPreset",
  "profileSaveFromSelection",
  "profileDelete",
  "togglePinSelection",
  "applyAgentsTemplate",
  "exportInstructions",
  "backupSnapshotNow",
  "trashRestoreEntry",
  "restoreBackupSnapshot",
  "runWorkspaceMaintenance",
  "discoverCloneSelected",
] as const;

function trackPendingWriter<T>(store: Store, promise: Promise<T>): Promise<T> {
  const pending = pendingWriters.get(store);
  if (pending === undefined) throw new Error("writer tracking is not initialized for this store");
  pending.add(promise);
  void promise.then(
    () => pending.delete(promise),
    (error: unknown) => {
      writerFailures.get(store)?.push(error);
      pending.delete(promise);
    },
  );
  return promise;
}

function trackAsyncWriters(store: Store): void {
  pendingWriters.set(store, new Set());
  writerFailures.set(store, []);
  const target = store as unknown as Record<string, unknown>;
  for (const name of asyncWriterMethods) {
    const original = target[name];
    if (typeof original !== "function") continue;
    target[name] = (...args: unknown[]) => {
      const result = original.apply(store, args);
      if (
        result !== null &&
        typeof result === "object" &&
        typeof (result as { then?: unknown }).then === "function"
      ) {
        trackPendingWriter(store, Promise.resolve(result));
      }
      return result;
    };
  }
}

async function drainPendingWriters(store: Store): Promise<void> {
  const pending = pendingWriters.get(store);
  if (pending === undefined) return;
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

function fixture() {
  const value = workspaceFixture();
  fixtures.push(value);
  process.env.REPOTRUCK_CONFIG_DIR = value.configDir;
  return value;
}

function makeStore(f: ReturnType<typeof fixture>, extra: Parameters<typeof storeDeps>[0] = {}) {
  const value = new Store(f.root, storeDeps(extra));
  stores.push(value);
  trackAsyncWriters(value);
  return value;
}

async function mount(store: Store, width = 120, height = 42) {
  const setup = await testRender(
    <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
    { width, height, exitOnCtrlC: false },
  );
  await waitForDashboardReady(setup, store);
  return setup;
}

async function settle(setup: Awaited<ReturnType<typeof mount>>) {
  await settleRender(setup);
}

async function clickText(setup: Awaited<ReturnType<typeof mount>>, text: string, occurrence = 0) {
  await settle(setup);
  const frame = setup.captureCharFrame();
  let offset = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index++) {
    offset = frame.indexOf(text, from);
    if (offset < 0) break;
    from = offset + text.length;
  }
  expect(offset, `visible control ${text}`).toBeGreaterThanOrEqual(0);
  const before = frame.slice(0, offset);
  const y = before.split("\n").length - 1;
  const x = terminalWidth(
    before.includes("\n") ? before.slice(before.lastIndexOf("\n") + 1) : before,
  );
  await setup.mockMouse.click(x, y);
  await settle(setup);
}

afterEach(async () => {
  const testStores = stores.splice(0);
  const testFixtures = fixtures.splice(0);
  try {
    await Promise.all(testStores.map(drainPendingWriters));
  } finally {
    for (const store of testStores) store.dispose();
    if (priorConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
    else process.env.REPOTRUCK_CONFIG_DIR = priorConfigDir;
    for (const f of testFixtures) f.cleanup();
  }
  const failure = testStores.flatMap((store) => writerFailures.get(store) ?? [])[0];
  if (failure !== undefined) {
    throw failure instanceof Error ? failure : new Error(String(failure));
  }
});

describe("acceptance: page callbacks through TUI input", () => {
  test("presets build and persist a custom layout, then cancel apply/remove confirmations", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    const setup = await mount(store);
    try {
      store.setView("presets");
      await settle(setup);
      setup.mockInput.pressKey("a");
      await setup.mockInput.typeText("acceptance-layout");
      await settle(setup);
      setup.mockInput.pressEnter();
      await settle(setup);
      await clickText(setup, "[1] owner");
      await clickText(setup, "[4] name");
      await clickText(setup, "[s] Add");
      await waitUntil(() =>
        store.getSnapshot().customPresets.some((entry) => entry.id === "acceptance-layout"),
      );
      expect(store.getSnapshot().customPresets).toContainEqual({
        id: "acceptance-layout",
        segments: ["owner", "name"],
      });
      const saved = JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8"));
      expect(saved.presets["acceptance-layout"]).toEqual({ segments: ["owner", "name"] });

      await clickText(setup, "acceptance-layout");
      await clickText(setup, "[Enter] Apply", 16);
      expect(store.getSnapshot().dialog?.title).toContain("Reorganize to acceptance-layout");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      await clickText(setup, "[d] Remove");
      expect(store.getSnapshot().dialog?.title).toContain("Remove preset acceptance-layout");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);

      // Applying a built-in preset opens the reorganize preview only after confirmation.
      await clickText(setup, "flat-by-owner");
      setup.mockInput.pressEnter();
      expect(store.getSnapshot().dialog?.title).toContain("Reorganize to flat-by-owner");
      await clickText(setup, "[Enter] Confirm");
      await settle(setup);
      expect(store.getSnapshot().view).toBe("cockpit");
      expect(store.getSnapshot().modal?.type).toBe("reorganize");
      await clickText(setup, "[Esc] Close");
      store.setView("presets");
      await settle(setup);

      await clickText(setup, "acceptance-layout");
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().dialog?.title).toContain("Reorganize to acceptance-layout");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      expect(store.getSnapshot().modal).toBeNull();

      await clickText(setup, "acceptance-layout");
      setup.mockInput.pressKey("x");
      await settle(setup);
      expect(store.getSnapshot().dialog?.title).toContain("Remove preset acceptance-layout");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      expect(store.getSnapshot().customPresets).toContainEqual({
        id: "acceptance-layout",
        segments: ["owner", "name"],
      });
      await clickText(setup, "[a] add custom preset");
      await clickText(setup, "[b] Back");
      expect(store.getSnapshot().dialog).toBeNull();

      await clickText(setup, "[a] add custom preset");
      await setup.mockInput.typeText("acceptance-keys");
      setup.mockInput.pressEnter();
      setup.mockInput.pressKey("s");
      await settle(setup);
      expect(
        store.getSnapshot().customPresets.some((entry) => entry.id === "acceptance-keys"),
      ).toBe(false);
      setup.mockInput.pressKey("2");
      setup.mockInput.pressKey("2");
      setup.mockInput.pressKey("1");
      setup.mockInput.pressKey("4");
      setup.mockInput.pressKey("s");
      await waitUntil(() =>
        store.getSnapshot().customPresets.some((entry) => entry.id === "acceptance-keys"),
      );
      expect(store.getSnapshot().customPresets).toContainEqual({
        id: "acceptance-keys",
        segments: ["owner", "name"],
      });
    } finally {
      await setup.dispose();
    }
  });

  test("settings keyboard toggles and logout cancel preserve persisted configuration", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    const setup = await mount(store);
    try {
      store.setView("settings");
      await store.refreshSettingsPage();
      await settle(setup);
      setup.mockInput.pressKey("j");
      setup.mockInput.pressKey("j");
      setup.mockInput.pressEnter();
      await waitUntil(
        () =>
          (store.getSnapshot().settingsPage?.settings?.sync as { blobless?: boolean } | undefined)
            ?.blobless === true,
      );
      expect(
        (store.getSnapshot().settingsPage?.settings?.sync as { blobless?: boolean } | undefined)
          ?.blobless,
      ).toBe(true);
      const persisted = JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8"));
      expect(persisted.sync.blobless).toBe(true);
      await clickText(setup, "[Enter] Edit");
      await drainPendingWriters(store);
      expect(
        (store.getSnapshot().settingsPage?.settings?.sync as { concurrency?: number } | undefined)
          ?.concurrency,
      ).toBe(5);
      await clickText(setup, "[u] Unset");
      await waitUntil(
        () =>
          (store.getSnapshot().settingsPage?.settings?.sync as { concurrency?: number } | undefined)
            ?.concurrency === undefined,
      );
      const unsetConfig = JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8"));
      expect(unsetConfig.sync?.concurrency).toBeUndefined();
      await clickText(setup, "sync clone depth");
      setup.mockInput.pressEnter();
      await waitUntil(
        () =>
          (store.getSnapshot().settingsPage?.settings?.sync as { depth?: number } | undefined)
            ?.depth === 1 &&
          JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8")).sync.depth === 1,
      );
      expect(
        JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8")).sync.depth,
      ).toBe(1);
      await clickText(setup, "sync divergence");
      setup.mockInput.pressEnter();
      await waitUntil(
        () =>
          (store.getSnapshot().settingsPage?.settings?.sync as { divergence?: string } | undefined)
            ?.divergence === "rebase" &&
          JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8")).sync
            .divergence === "rebase",
      );
      expect(
        JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8")).sync.divergence,
      ).toBe("rebase");
      await clickText(setup, "sync stash");
      setup.mockInput.pressEnter();
      await waitUntil(
        () =>
          (store.getSnapshot().settingsPage?.settings?.sync as { stash?: boolean } | undefined)
            ?.stash === true &&
          JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8")).sync.stash,
      );
      expect(
        JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8")).sync.stash,
      ).toBe(true);
      await clickText(setup, "[y] Copy update command");
      await clickText(setup, "[3] fish");
      expect(store.getSnapshot().statuses.some((status) => status.key === "[update]")).toBe(true);
      expect(store.getSnapshot().statuses.some((status) => status.key === "[completions]")).toBe(
        true,
      );
      await clickText(setup, "[1] bash");
      await clickText(setup, "[2] zsh");
      await clickText(setup, "[4] powershell");
      const completionsStatus = store
        .getSnapshot()
        .statuses.filter((status) => status.key === "[completions]")
        .at(-1);
      const payloadPath = completionsStatus?.message?.match(/written to (.+) \(terminal/)?.[1];
      expect(payloadPath).toBeTruthy();
      expect(readFileSync(payloadPath!, "utf8")).toBe("repotruck completions powershell");

      // Mouse input reaches the visible tools/logout control, then cancel proves no credential action runs.
      await clickText(setup, "[x] Logout");
      expect(store.getSnapshot().dialog?.title).toBe("Logout");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      expect(
        store.getSnapshot().statuses.some((status) => status.message?.includes("auth logout")),
      ).toBe(false);

      await clickText(setup, "github base url");
      await clickText(setup, "[Enter] Edit", 5);
      await settle(setup);
      setup.mockInput.pressKey("END");
      for (let index = 0; index < 40; index++) setup.mockInput.pressKey("BACKSPACE");
      await setup.mockInput.typeText("http://invalid.example");
      setup.mockInput.pressEnter();
      await waitUntil(() =>
        store
          .getSnapshot()
          .statuses.some(
            (status) =>
              status.phase === "FAILED" &&
              status.key === "[config]" &&
              status.message?.includes("expected an https URL"),
          ),
      );
      expect(
        store
          .getSnapshot()
          .statuses.some(
            (status) =>
              status.phase === "FAILED" &&
              status.key === "[config]" &&
              status.message?.includes("expected an https URL"),
          ),
      ).toBe(true);
      setup.mockInput.pressEscape();
      await settle(setup);
      await clickText(setup, "github base url");
      await clickText(setup, "[Enter] Edit", 5);
      setup.mockInput.pressKey("END");
      for (let index = 0; index < 40; index++) setup.mockInput.pressKey("BACKSPACE");
      await setup.mockInput.typeText("https://ghe.example.com/api/v3");
      setup.mockInput.pressEnter();
      await waitUntil(
        () =>
          store.getSnapshot().settingsPage?.settings?.github?.baseUrl ===
          "https://ghe.example.com/api/v3",
      );
      expect(
        JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8")).github.baseUrl,
      ).toBe("https://ghe.example.com/api/v3");
    } finally {
      await setup.dispose();
    }
  });

  test("settings reject a relative root and cycle theme choices through the actual controls", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    let loginRequests = 0;
    store.startDeviceFlow = async () => {
      loginRequests++;
    };
    await store.init();
    const setup = await mount(store);
    try {
      store.setView("settings");
      await store.refreshSettingsPage();
      await settle(setup);
      const initialRoot = store.getSnapshot().settingsPage?.settings?.defaultRoot;
      await clickText(setup, "default root");
      await clickText(setup, "[Enter] Edit", 6);
      setup.mockInput.pressKey("END");
      for (let index = 0; index < 200; index++) setup.mockInput.pressKey("BACKSPACE");
      await setup.mockInput.typeText("relative-root");
      setup.mockInput.pressEnter();
      await waitUntil(() =>
        store
          .getSnapshot()
          .statuses.some(
            (status) =>
              status.phase === "FAILED" &&
              status.key === "[config]" &&
              status.message?.includes("path must be absolute"),
          ),
      );
      expect(
        store
          .getSnapshot()
          .statuses.some(
            (status) =>
              status.phase === "FAILED" &&
              status.key === "[config]" &&
              status.message?.includes("path must be absolute"),
          ),
      ).toBe(true);
      expect(store.getSnapshot().settingsPage?.settings?.defaultRoot).toBe(initialRoot);
      setup.mockInput.pressEscape();
      await settle(setup);

      await clickText(setup, "default root");
      await clickText(setup, "[Enter] Edit", 6);
      setup.mockInput.pressKey("END");
      for (let index = 0; index < 200; index++) setup.mockInput.pressKey("BACKSPACE");
      await setup.mockInput.typeText(f.root);
      setup.mockInput.pressEnter();
      await waitUntil(() => store.getSnapshot().settingsPage?.settings?.defaultRoot === f.root);
      expect(
        JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8")).defaultRoot,
      ).toBe(f.root);

      await clickText(setup, "theme");
      for (const theme of ["light", "contrast", "default"]) {
        setup.mockInput.pressEnter();
        await waitUntil(() => store.getSnapshot().settingsPage?.settings?.theme === theme);
      }
      expect(JSON.parse(readFileSync(`${f.configDir}/${SETTINGS_FILENAME}`, "utf8")).theme).toBe(
        "default",
      );

      await clickText(setup, "[l] login device flow");
      expect(loginRequests).toBe(1);
      await clickText(setup, "[x] Logout");
      expect(store.getSnapshot().dialog?.title).toBe("Logout");
      await clickText(setup, "[Enter] Confirm");
      expect(
        store
          .getSnapshot()
          .statuses.some((status) => status.message?.includes("run it in a terminal")),
      ).toBe(true);
    } finally {
      await setup.dispose();
    }
  });

  test("profiles save selected repositories, route to run, and cancel deletion", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    store.toggleRepoAt(0);
    const setup = await mount(store);
    try {
      store.setView("profiles");
      await settle(setup);
      setup.mockInput.pressKey("n");
      const editorFrame = await setup.waitForFrame((frame) =>
        frame.includes("Enter save profile · Esc actions · F1 help"),
      );
      expect(editorFrame).toContain("Enter save profile · Esc actions · F1 help");
      await setup.mockInput.typeText("acceptance-profile");
      await setup.flush();
      const inputLine = setup
        .captureCharFrame()
        .split("\n")
        .find((line) => line.includes("name:"));
      expect(inputLine).toContain("profile");
      setup.mockInput.pressEnter();
      await waitUntil(() => {
        const snapshot = store.getSnapshot();
        return (
          snapshot.profiles["acceptance-profile"]?.[0] === "acme/api" &&
          snapshot.statuses.some(
            (status) =>
              status.key === "[profile]" &&
              status.phase === "DONE" &&
              status.message?.includes("acceptance-profile saved (1 repositories)"),
          )
        );
      });
      expect(store.getSnapshot().profiles["acceptance-profile"]).toEqual(["acme/api"]);
      expect((await readWorkspaceConfig(f.root, f.env))?.profiles?.["acceptance-profile"]).toEqual([
        "acme/api",
      ]);
      await clickText(setup, "acceptance-profile · 1 repos");
      setup.mockInput.pressKey("s");
      expect(store.getSnapshot().view).toBe("sync");
      store.setView("profiles");
      await settle(setup);

      await clickText(setup, "[p] pin/unpin cockpit selection");
      await waitUntil(
        () =>
          store.getSnapshot().localHealth.get("acme/api")?.pinned === true &&
          store
            .getSnapshot()
            .statuses.some((status) => status.key === "[pin]" && status.phase === "DONE"),
      );
      expect(store.getSnapshot().localHealth.get("acme/api")?.pinned).toBe(true);
      expect((await readWorkspaceConfig(f.root, f.env))?.pinned).toContain("acme/api");
      await clickText(setup, "★ acme/api");
      expect(store.getSnapshot().modal?.type).toBe("detail");
      await clickText(setup, "[Esc] Close");
      await clickText(setup, "[⇅ s:sync]");
      expect(store.getSnapshot().view).toBe("sync");
      store.setView("profiles");
      await settle(setup);

      // The visible row action uses the mouse handler, and the state change is observable in routing.
      await clickText(setup, "[▶ r:run]");
      expect(store.getSnapshot().view).toBe("run");
      expect(store.getSnapshot().runConsole).toMatchObject({
        scope: "profile",
        profile: "acceptance-profile",
      });

      store.setView("profiles");
      await settle(setup);
      await clickText(setup, "[d:delete]");
      expect(store.getSnapshot().dialog?.title).toContain("Delete profile acceptance-profile");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      expect(store.getSnapshot().profiles["acceptance-profile"]).toEqual(["acme/api"]);

      await clickText(setup, "[d:delete]");
      expect(store.getSnapshot().dialog?.title).toContain("Delete profile acceptance-profile");
      await clickText(setup, "[Enter] Confirm");
      await waitUntil(() => store.getSnapshot().profiles["acceptance-profile"] === undefined);
      expect(store.getSnapshot().profiles["acceptance-profile"]).toBeUndefined();
      expect(
        (await readWorkspaceConfig(f.root, f.env))?.profiles?.["acceptance-profile"],
      ).toBeUndefined();

      await clickText(setup, "[n] save profile");
      await setup.waitForFrame((frame) =>
        frame.includes("Enter save profile · Esc actions · F1 help"),
      );
      await setup.mockInput.typeText("mouse-profile");
      await clickText(setup, "from: selection");
      await waitUntil(
        () =>
          store.getSnapshot().profiles["mouse-profile"] !== undefined &&
          store
            .getSnapshot()
            .statuses.some(
              (status) =>
                status.key === "[profile]" &&
                status.phase === "DONE" &&
                status.message?.includes("mouse-profile saved (1 repositories)"),
            ),
      );
      expect(store.getSnapshot().profiles["mouse-profile"]).toEqual(["acme/api"]);
      expect((await readWorkspaceConfig(f.root, f.env))?.profiles?.["mouse-profile"]).toEqual([
        "acme/api",
      ]);
    } finally {
      await setup.dispose();
    }
  });

  test("fixture cleanup drain holds a pending rendered pin write until persistence finishes", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    store.toggleRepoAt(0);
    const originalTogglePin = store.togglePinSelection;
    let releasePin!: () => void;
    let notifyPinStarted!: () => void;
    const pinGate = new Promise<void>((resolve) => {
      releasePin = resolve;
    });
    const pinStarted = new Promise<void>((resolve) => {
      notifyPinStarted = resolve;
    });
    store.togglePinSelection = () =>
      trackPendingWriter(
        store,
        (async () => {
          notifyPinStarted();
          await pinGate;
          await originalTogglePin();
        })(),
      );
    const setup = await mount(store);
    try {
      store.setView("profiles");
      await clickText(setup, "[p] pin/unpin cockpit selection");
      await pinStarted;

      let drained = false;
      const draining = drainPendingWriters(store).then(() => {
        drained = true;
      });
      await Promise.resolve();
      expect(drained).toBe(false);
      expect(existsSync(f.base)).toBe(true);

      releasePin();
      await draining;
      expect(store.getSnapshot().localHealth.get("acme/api")?.pinned).toBe(true);
      expect((await readWorkspaceConfig(f.root, f.env))?.pinned).toContain("acme/api");
    } finally {
      releasePin();
      await setup.dispose();
    }
  });

  test("compact cockpit, profile, and settings controls remain actionable", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    store.toggleRepoAt(0);
    await store.profileSaveFromSelection("compact-profile");
    const setup = await mount(store, 58, 18);
    try {
      store.setView("cockpit");
      await settle(setup);
      await clickText(setup, "[Scope]");
      expect(store.getSnapshot().focus).toBe("sidebar");
      await clickText(setup, "Repos (");
      expect(store.getSnapshot().focus).toBe("list");
      await clickText(setup, "[Status]");
      expect(store.getSnapshot().focus).toBe("status");

      store.setView("profiles");
      setup.mockInput.pressTab();
      const profileFrame = await setup.waitForFrame(
        (frame) => frame.includes("compact-profile") && frame.includes("[▶ r:run]"),
      );
      expect(profileFrame).toContain("compact-profile");
      setup.mockInput.pressKey("r");
      await waitUntil(() => store.getSnapshot().view === "run");
      expect(store.getSnapshot().view).toBe("run");
      expect(store.getSnapshot().runConsole).toMatchObject({
        scope: "profile",
        profile: "compact-profile",
      });

      store.setView("settings");
      await store.refreshSettingsPage();
      await settle(setup);
      await clickText(setup, "Tools");
      await clickText(setup, "[y] Copy update command");
      expect(store.getSnapshot().statuses.some((status) => status.key === "[update]")).toBe(true);
      await clickText(setup, "Configuration");
      expect(setup.captureCharFrame()).toContain("sync blobless");
    } finally {
      await setup.dispose();
    }
  });

  test("compact trash tabs route a fixture snapshot to the selected restore confirmation", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    const setup = await mount(store, 58, 18);
    try {
      store.setView("trash");
      await store.refreshTrashPage();
      await settle(setup);
      setup.mockInput.pressKey("b");
      await waitUntil(() => (store.getSnapshot().trashPage?.backups.length ?? 0) > 0);
      await clickText(setup, "Backups");
      await clickText(setup, "[restore --yes]");
      expect(store.getSnapshot().dialog?.title).toBe("Restore snapshot");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      expect(store.getSnapshot().trashPage?.backups.length).toBeGreaterThan(0);
    } finally {
      await setup.dispose();
    }
  });

  test("agents template apply and clear controls write only within the fixture", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    let mcpPort = 0;
    let stopped = 0;
    store.startMcpServer = async (port: number) => {
      mcpPort = port;
    };
    store.stopMcpServer = () => {
      stopped++;
    };
    await store.init();
    const setup = await mount(store, 140, 48);
    try {
      store.setView("agents");
      await settle(setup);
      const frame = setup.captureCharFrame();
      const templateName = frame.match(/\s([a-z][a-z0-9-]*) — /)?.[1];
      expect(templateName).toBeTruthy();
      setup.mockInput.pressEnter();
      const instructionFile = `${f.root}/AGENTS.md`;
      await waitUntil(
        () =>
          existsSync(instructionFile) &&
          store
            .getSnapshot()
            .statuses.some(
              (status) =>
                status.key === "[instructions]" &&
                status.phase === "DONE" &&
                status.message?.includes(`applied template "${templateName}"`),
            ),
      );
      expect(readFileSync(instructionFile, "utf8").length).toBeGreaterThan(30);
      await clickText(setup, "[Enter] Apply");

      // Exercise mouse clear on the rendered row and verify the generated template is removed.
      await clickText(setup, "[x:clear]");
      await waitUntil(() =>
        store
          .getSnapshot()
          .statuses.some((status) => status.message?.includes("removed the instructions template")),
      );
      expect(
        store
          .getSnapshot()
          .statuses.some((status) => status.message?.includes("removed the instructions template")),
      ).toBe(true);
      await clickText(setup, "[f] format:");
      await clickText(setup, "[e] export");
      await waitUntil(() =>
        store
          .getSnapshot()
          .statuses.some(
            (status) => status.key === "[instructions]" && status.message?.includes("exported"),
          ),
      );
      const exportMessage = store
        .getSnapshot()
        .statuses.filter((status) => status.key === "[instructions]")
        .at(-1)?.message;
      const exportPath = exportMessage?.match(/exported \w+ -> (.+)/)?.[1];
      expect(exportPath).toBeTruthy();
      expect(existsSync(exportPath!)).toBe(true);
      expect(
        store
          .getSnapshot()
          .statuses.some(
            (status) => status.key === "[instructions]" && status.message?.includes("export"),
          ),
      ).toBe(true);
      await clickText(setup, "[p] port: 3000");
      await clickText(setup, "[y] copy client config");
      await clickText(setup, "[i] Copy stdio setup");
      await clickText(setup, "[m] start --http");
      expect(mcpPort).toBe(3100);
      store.beginTask("mcp", "MCP server");
      await settle(setup);
      await clickText(setup, "[s] stop");
      expect(stopped).toBe(1);
      await clickText(setup, "[r] regenerate map");
      await waitUntil(() =>
        store
          .getSnapshot()
          .statuses.some(
            (status) =>
              status.key === "[instructions]" &&
              status.phase === "DONE" &&
              status.message?.includes("regenerated AGENTS.md ("),
          ),
      );
    } finally {
      await setup.dispose();
    }
  });

  test("trash page scans/backs up with mouse and keeps restore guarded by a dialog", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    // A backup action writes a fixture-local snapshot; no real workspace data is touched.
    const setup = await mount(store, 140, 48);
    try {
      store.setView("trash");
      await store.refreshTrashPage();
      await settle(setup);
      await clickText(setup, "[b] snapshot now");
      await waitUntil(
        () =>
          (store.getSnapshot().trashPage?.backups.length ?? 0) > 0 &&
          store
            .getSnapshot()
            .statuses.some((status) => status.key === "[backup]" && status.phase === "DONE"),
      );
      await clickText(setup, "Backups · 5 generations");
      await setup.mockMouse.scroll(90, 20, "down");
      await settle(setup);
      await clickText(setup, "1 repos");
      await clickText(setup, "[restore --yes]");
      expect(store.getSnapshot().dialog?.title).toBe("Restore snapshot");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      setup.mockInput.pressKey("r");
      await settle(setup);
      setup.mockInput.pressEnter();
      expect(store.getSnapshot().dialog?.title).toBe("Restore snapshot");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      await clickText(setup, "[restore --yes]");
      await clickText(setup, "[Enter] Confirm");
      await waitUntil(
        () =>
          store
            .getSnapshot()
            .statuses.some((status) => status.key === "[backup]" && status.phase === "DONE") &&
          (store.getSnapshot().trashPage?.backups.length ?? 0) > 0,
      );
      expect(store.getSnapshot().trashPage?.backups.length).toBeGreaterThan(0);

      setup.mockInput.pressKey("E");
      await settle(setup);
      expect(store.getSnapshot().dialog?.title.toLowerCase()).toContain("empty");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      await clickText(setup, "[E] empty trash --yes");
      expect(store.getSnapshot().dialog?.title.toLowerCase()).toContain("empty");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      expect(existsSync(f.repoDir)).toBe(true);
    } finally {
      await setup.dispose();
    }
  });

  test("trash restore row confirms first and restores the fixture repository", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    store.openModal({ type: "confirmDelete", key: "acme/api", absPath: f.repoDir });
    await store.confirmDelete("acme/api");
    expect(existsSync(f.repoDir)).toBe(false);
    const setup = await mount(store, 140, 48);
    try {
      store.setView("trash");
      await store.refreshTrashPage();
      await settle(setup);
      expect(store.getSnapshot().trashPage?.trash).toHaveLength(1);
      await clickText(setup, "acme/api");
      setup.mockInput.pressEnter();
      expect(store.getSnapshot().dialog?.title).toBe("Restore");
      await clickText(setup, "[Esc] Cancel");
      await settle(setup);
      await clickText(setup, "[restore]");
      expect(store.getSnapshot().dialog?.title).toBe("Restore");
      await clickText(setup, "[Enter] Confirm");
      await waitUntil(
        () => existsSync(f.repoDir) && store.getSnapshot().trashPage?.trash.length === 0,
      );
      expect(readFileSync(`${f.repoDir}/sentinel.txt`, "utf8")).toBe("user data\n");
      expect(store.getSnapshot().trashPage?.trash).toHaveLength(0);
    } finally {
      await setup.dispose();
    }
  });

  test("trash empty requires its visible confirmation and removes only fixture trash data", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    store.openModal({ type: "confirmDelete", key: "acme/api", absPath: f.repoDir });
    await store.confirmDelete("acme/api");
    expect(existsSync(f.repoDir)).toBe(false);
    const setup = await mount(store, 140, 48);
    try {
      store.setView("trash");
      await store.refreshTrashPage();
      await settle(setup);
      expect(store.getSnapshot().trashPage?.trash).toHaveLength(1);
      await clickText(setup, "[E] empty trash --yes");
      expect(store.getSnapshot().dialog?.title).toBe("Empty trash");
      await clickText(setup, "[Enter] Confirm");
      await waitUntil(
        () =>
          store.getSnapshot().trashPage?.trash.length === 0 &&
          !existsSync(f.repoDir) &&
          store
            .getSnapshot()
            .statuses.some((status) => status.key === "[trash]" && status.phase === "DONE"),
      );
      expect(store.getSnapshot().trashPage?.trash).toHaveLength(0);
      expect(existsSync(f.repoDir)).toBe(false);
    } finally {
      await setup.dispose();
    }
  });

  test("discover selects a result and mouse toggles blobless before a safe clone attempt", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f, {
      github: () => ({
        getUserLogin: async () => "acme",
        getActiveOrgs: async () => [],
        listUserRepos: async () => [],
        listOrgRepos: async () => [],
        getRepo: async () => ({
          owner: "acme",
          name: "api",
          description: null,
          isPrivate: false,
          isFork: false,
          isArchived: false,
          language: null,
          httpsUrl: "",
          sshUrl: "",
          updatedAt: null,
        }),
        createRepo: async () => ({
          owner: "acme",
          name: "api",
          description: null,
          isPrivate: false,
          isFork: false,
          isArchived: false,
          language: null,
          httpsUrl: "",
          sshUrl: "",
          updatedAt: null,
        }),
        searchRepos: async () => [
          {
            owner: "sample",
            name: "one",
            description: null,
            isPrivate: false,
            isFork: false,
            isArchived: false,
            language: "TypeScript",
            httpsUrl: "https://github.com/sample/one.git",
            sshUrl: "",
            updatedAt: null,
          },
          {
            owner: "sample",
            name: "two",
            description: null,
            isPrivate: false,
            isFork: false,
            isArchived: false,
            language: "TypeScript",
            httpsUrl: "https://github.com/sample/two.git",
            sshUrl: "",
            updatedAt: null,
          },
        ],
      }),
      cloneSingle: async (url: string) => {
        if (url.endsWith("/two.git")) throw new Error("fixture clone failed");
        return { ok: true, action: "cloned", repo: { owner: "sample", name: "one" } } as never;
      },
    });
    await store.init();
    const setup = await mount(store);
    try {
      store.setView("discover");
      await settle(setup);
      await setup.mockInput.typeText("sample");
      setup.mockInput.pressEnter();
      await waitUntil(
        () =>
          store.getSnapshot().discoverPage?.loading === false &&
          store.getSnapshot().discoverPage?.results.length === 2,
      );
      expect(store.getSnapshot().discoverPage?.results).toHaveLength(2);
      await clickText(setup, "[l] limit: 20");
      expect(store.getSnapshot().discoverPage?.limit).toBe(50);
      await clickText(setup, "[y] Copy CLI");
      expect(store.getSnapshot().statuses.some((status) => status.key === "[discover]")).toBe(true);
      await clickText(setup, "sample/two");
      expect(store.getSnapshot().discoverPage?.selected.has("sample/two")).toBe(true);

      await clickText(setup, "[b] blobless: off");
      expect(store.getSnapshot().discoverPage?.blobless).toBe(true);
      await clickText(setup, "[a] select all");
      expect(store.getSnapshot().discoverPage?.selected.size).toBe(2);
      await clickText(setup, "[c] clone selected");
      await waitUntil(() =>
        store.getSnapshot().statuses.some((status) => status.message?.includes("1 failed")),
      );
      expect(
        store.getSnapshot().statuses.some((status) => status.message?.includes("1 failed")),
      ).toBe(true);
    } finally {
      await setup.dispose();
    }
  });

  test("discover query reports a GitHub search failure through its visible form", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f, {
      github: () =>
        ({
          getUserLogin: async () => "acme",
          getActiveOrgs: async () => [],
          listUserRepos: async () => [],
          listOrgRepos: async () => [],
          getRepo: async () => ({
            owner: "acme",
            name: "api",
            description: null,
            isPrivate: false,
            isFork: false,
            isArchived: false,
            language: null,
            httpsUrl: "",
            sshUrl: "",
            updatedAt: null,
          }),
          createRepo: async () => ({
            owner: "acme",
            name: "api",
            description: null,
            isPrivate: false,
            isFork: false,
            isArchived: false,
            language: null,
            httpsUrl: "",
            sshUrl: "",
            updatedAt: null,
          }),
          searchRepos: async () => {
            throw new Error("fixture GitHub search outage");
          },
        }) as never,
    });
    await store.init();
    const setup = await mount(store);
    try {
      store.setView("discover");
      await settle(setup);
      await setup.mockInput.typeText("sample-project");
      setup.mockInput.pressEnter();
      await waitUntil(() => store.getSnapshot().discoverPage?.loading === false);
      expect(store.getSnapshot().discoverPage).toMatchObject({
        query: "sample-project",
        loading: false,
        results: [],
      });
      expect(store.getSnapshot().statuses.at(-1)).toMatchObject({
        phase: "FAILED",
        message: "fixture GitHub search outage",
      });
    } finally {
      await setup.dispose();
    }
  });
});

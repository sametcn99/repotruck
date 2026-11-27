import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { CreateModal } from "../src/components/CreateModal.tsx";
import { OmnibarModal } from "../src/components/OmnibarModal.tsx";
import { OpenModal } from "../src/components/OpenModal.tsx";
import { ReorganizeModal } from "../src/components/ReorganizeModal.tsx";
import { StartPreviewModal } from "../src/components/StartPreviewModal.tsx";
import { Store } from "../src/components/store.ts";
import { WorkspacePicker } from "../src/components/WorkspacePicker.tsx";
import { WorktreeModal } from "../src/components/WorktreeModal.tsx";
import { readSettings } from "../src/services/settings.ts";
import { storeDeps, workspaceFixture } from "./helpers/hardening.ts";
import { settleRender, testRender } from "./helpers/render.tsx";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];
const stores: Store[] = [];
const priorConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
type RendererSetup = Awaited<ReturnType<typeof testRender>>;

function fixture() {
  const value = workspaceFixture();
  fixtures.push(value);
  process.env.REPOTRUCK_CONFIG_DIR = value.configDir;
  return value;
}

function makeStore(f: ReturnType<typeof fixture>, extra: Parameters<typeof storeDeps>[0] = {}) {
  const store = new Store(f.root, storeDeps(extra));
  stores.push(store);
  return store;
}

async function settle(setup: RendererSetup) {
  await settleRender(setup);
}

function canonicalRealPath(value: string): string {
  let resolved = realpathSync.native(value).replaceAll("\\", "/");
  if (resolved.startsWith("//?/")) resolved = resolved.slice(4);
  return resolved.replace(/\/+$/, "").toLocaleLowerCase("en-US");
}

function porcelainWorktreePaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

async function clickText(setup: RendererSetup, text: string) {
  await settle(setup);
  const frame = setup.captureCharFrame();
  const offset = frame.indexOf(text);
  expect(offset, `visible control ${text}`).toBeGreaterThanOrEqual(0);
  const before = frame.slice(0, offset);
  const y = before.split("\n").length - 1;
  const row = before.includes("\n") ? before.slice(before.lastIndexOf("\n") + 1) : before;
  const x = [...row].reduce((sum, c) => sum + (c.codePointAt(0)! > 0xff ? 2 : 1), 0);
  await setup.mockMouse.click(x, y);
  await settle(setup);
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  if (priorConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = priorConfigDir;
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe("acceptance: modal actions through native terminal input", () => {
  test("Create wizard validates, advances, and submits its validated draft using Enter", async () => {
    const f = fixture();
    await f.save();
    const createCalls: unknown[] = [];
    const store = makeStore(f, {
      create: async (input) => {
        createCalls.push(input.options);
        return {
          ok: true,
          message: "created fixture repository",
          relativePath: "acme-user/brand-new-repo",
        };
      },
    });
    await store.init();
    store.openCreateModal();
    const setup = await testRender(<CreateModal store={store} />, { width: 100, height: 32 });
    try {
      await settle(setup);
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().modalError).toContain("invalid repository name");
      await setup.mockInput.typeText("brand-new-repo");
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().modal).toMatchObject({ type: "create", step: "source" });
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().modal).toMatchObject({ type: "create", step: "org" });
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().modal).toMatchObject({ type: "create", step: "path" });
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().modal).toMatchObject({ type: "create", step: "description" });
      await setup.mockInput.typeText("Acceptance fixture");
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(store.getSnapshot().modal).toMatchObject({ type: "create", step: "visibility" });
      setup.mockInput.pressEnter();
      await settle(setup);
      expect(createCalls).toEqual([
        {
          name: "brand-new-repo",
          isPrivate: true,
          description: "Acceptance fixture",
          customPath: "acme/source/brand-new-repo",
        },
      ]);
      expect(store.getSnapshot().modal).toBeNull();
    } finally {
      await setup.dispose();
    }

    const failedStore = makeStore(f, {
      create: async () => ({ ok: false, message: "fixture create rejected" }),
    });
    await failedStore.init();
    failedStore.openCreateModal();
    const failedSetup = await testRender(<CreateModal store={failedStore} />, {
      width: 100,
      height: 32,
    });
    try {
      await failedSetup.mockInput.typeText("rejected-repo");
      failedSetup.mockInput.pressEnter();
      await settle(failedSetup);
      for (let step = 0; step < 4; step++) {
        failedSetup.mockInput.pressEnter();
        await settle(failedSetup);
      }
      expect(failedStore.getSnapshot().modal).toMatchObject({ type: "create", step: "visibility" });
      failedSetup.mockInput.pressEnter();
      await settle(failedSetup);
      expect(failedStore.getSnapshot().modal).toMatchObject({ type: "create", step: "visibility" });
      expect(failedStore.getSnapshot().modalError).toContain("fixture create rejected");
      expect(norm(failedSetup.captureCharFrame())).toContain("fixture create rejected");
    } finally {
      await failedSetup.dispose();
    }
  });

  test("Worktree form rejects an empty branch, creates a local worktree, and removes only a non-main entry", async () => {
    const f = fixture();
    await f.save();
    const repoDir = f.repoDir;
    const git = simpleGit(repoDir);
    await git.init();
    await git.addConfig("user.name", "Acceptance Fixture");
    await git.addConfig("user.email", "acceptance@example.test");
    await git.add("sentinel.txt");
    await git.commit("fixture commit");
    await git.branch(["-M", "main"]);
    const store = makeStore(f);
    await store.init();
    await store.openWorktreeModal("acme/api");
    const { createWorktree, removeWorktree } = store;
    let worktreeAction: ReturnType<Store["createWorktree"]> | undefined;
    store.createWorktree = (...args) => (worktreeAction = createWorktree(...args));
    store.removeWorktree = (...args) => (worktreeAction = removeWorktree(...args));
    const setup = await testRender(<WorktreeModal store={store} />, { width: 100, height: 32 });
    try {
      await settle(setup);
      setup.mockInput.pressTab();
      setup.mockInput.pressTab();
      setup.mockInput.pressTab();
      setup.mockInput.pressEnter();
      await settle(setup);
      expect((store.getSnapshot().modal as { type: string }).type).toBe("worktree");
      expect(worktreeAction).toBeUndefined();
      expect(await git.raw(["worktree", "list", "--porcelain"])).not.toContain("feature-k05");

      await setup.mockInput.typeText("feature-k05");
      setup.mockInput.pressTab();
      await setup.mockInput.typeText(path.join(f.base, "feature-k05"));
      setup.mockInput.pressTab();
      setup.mockInput.pressKey(" ");
      setup.mockInput.pressTab();
      await settleRender(setup, async () => {
        setup.mockInput.pressEnter();
        expect(await worktreeAction).toMatchObject({ ok: true });
      });
      const worktrees = await git.raw(["worktree", "list", "--porcelain"]);
      expect(worktrees).toContain("branch refs/heads/feature-k05");
      expect(porcelainWorktreePaths(worktrees).map(canonicalRealPath)).toContain(
        canonicalRealPath(path.join(f.base, "feature-k05")),
      );
      expect(norm(setup.captureCharFrame())).toContain("created worktree at");

      setup.mockInput.pressTab({ shift: true });
      setup.mockInput.pressTab({ shift: true });
      setup.mockInput.pressTab({ shift: true });
      worktreeAction = undefined;
      await settleRender(setup, async () => {
        await clickText(setup, "[Del] Remove");
        expect(await worktreeAction).toMatchObject({ ok: true });
      });
      const afterRemoval = await git.raw(["worktree", "list", "--porcelain"]);
      expect(afterRemoval).not.toContain("branch refs/heads/feature-k05");
      expect(afterRemoval).toContain("branch refs/heads/main");
      expect(porcelainWorktreePaths(afterRemoval).map(canonicalRealPath)).toEqual([
        canonicalRealPath(repoDir),
      ]);
    } finally {
      await setup.dispose();
    }
  });

  test("WorkspacePicker removes a registry entry through x and Cancel closes the picker", async () => {
    const f = fixture();
    await f.save();
    const other = `${f.base}/other workspace`;
    let listings = [
      {
        root: f.root,
        path: f.root,
        preset: "categorized",
        repoCount: 1,
        lastSync: null,
        lastUsed: "now",
        aliases: {},
        missing: false,
      },
      {
        root: other,
        path: other,
        preset: "categorized",
        repoCount: 0,
        lastSync: null,
        lastUsed: "now",
        aliases: {},
        missing: true,
      },
    ] as never[];
    const removed: string[] = [];
    const store = makeStore(f, {
      listWorkspacesFn: async () => listings as never,
      removeWorkspaceFn: async (target) => {
        removed.push(target);
        listings = listings.filter((row) => (row as { path: string }).path !== target);
        return null;
      },
    });
    await store.init();
    await store.openWorkspacePicker();
    const setup = await testRender(<WorkspacePicker store={store} />, { width: 100, height: 32 });
    try {
      await settle(setup);
      setup.mockInput.pressArrow("down");
      setup.mockInput.pressKey("x");
      await settle(setup);
      expect(removed).toEqual([other]);
      expect(store.getSnapshot().workspaces).toHaveLength(1);
      expect(norm(setup.captureCharFrame())).toContain("removed");
      await clickText(setup, "[ Cancel ]");
      expect(store.getSnapshot().modal).toBeNull();
    } finally {
      await setup.dispose();
    }
  });

  test("WorkspacePicker d persists the default root and n opens the add-workspace flow", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f, {
      listWorkspacesFn: async () =>
        [
          {
            root: f.root,
            path: f.root,
            preset: "categorized",
            repoCount: 1,
            lastSync: null,
            lastUsed: "now",
            aliases: {},
            missing: false,
          },
        ] as never,
    });
    const submitRoot = store.submitRoot;
    let saving: Promise<boolean> | undefined;
    store.submitRoot = (root) => {
      saving = submitRoot(root);
      return saving;
    };
    await store.init();
    await store.openWorkspacePicker();
    const setup = await testRender(<WorkspacePicker store={store} />, { width: 100, height: 32 });
    try {
      await settle(setup);
      setup.mockInput.pressKey("d");
      expect(saving).toBeDefined();
      expect(await saving).toBe(true);
      await settle(setup);
      expect(store.getSnapshot().modal).toBeNull();
      expect((await readSettings(process.env)).defaultRoot).toBe(f.root);
      await store.openWorkspacePicker();
      setup.mockInput.pressKey("n");
      await settle(setup);
      expect(store.getSnapshot().modal).toMatchObject({ type: "workspaceAdd" });
    } finally {
      await saving?.catch(() => undefined);
      await setup.dispose();
    }
  });

  test("WorkspacePicker Enter switches the selected workspace through the Store", async () => {
    const f = fixture();
    await f.save();
    const other = workspaceFixture();
    fixtures.push(other);
    await other.save();
    const store = makeStore(f, {
      listWorkspacesFn: async () =>
        [
          {
            root: f.root,
            path: f.root,
            preset: "categorized",
            repoCount: 1,
            lastSync: null,
            lastUsed: "now",
            aliases: {},
            missing: false,
          },
          {
            root: other.root,
            path: other.root,
            preset: "categorized",
            repoCount: 1,
            lastSync: null,
            lastUsed: "now",
            aliases: {},
            missing: false,
          },
        ] as never,
    });
    const switchWorkspace = store.switchWorkspace;
    let switching: Promise<void> | undefined;
    store.switchWorkspace = (root) => {
      switching = switchWorkspace(root);
      return switching;
    };
    await store.init();
    await store.openWorkspacePicker();
    const setup = await testRender(<WorkspacePicker store={store} />, { width: 100, height: 32 });
    try {
      await settle(setup);
      setup.mockInput.pressArrow("down");
      setup.mockInput.pressEnter();
      expect(switching).toBeDefined();
      await switching;
      await settle(setup);
      expect(store.getSnapshot().root).toBe(other.root);
      expect(store.getSnapshot().phase).toBe("ready");
      expect(store.getSnapshot().modal).toBeNull();
    } finally {
      await switching?.catch(() => undefined);
      await setup.dispose();
    }
  });

  test("OpenModal routes the selected app through the suspended runner and cancel closes without launch", async () => {
    const f = fixture();
    await f.save();
    const spawned: unknown[] = [];
    const store = makeStore(f, {
      resolveAppFn: async (name) => ({
        name,
        command: `/fake/${name}`,
        args: ["--wait"],
        detected: true,
      }),
      spawnImpl: async (request) => {
        spawned.push(request);
        return 0;
      },
      detectAppsFn: async () => [
        { name: "editor", command: "/fake/editor", detected: true },
        { name: "terminal", command: "/fake/terminal", detected: true },
      ],
    });
    await store.init();
    await store.openOpenModal("acme/api");
    let suspended = 0;
    const setup = await testRender(
      <OpenModal
        store={store}
        onSuspendAndRun={async (run) => {
          suspended++;
          await run();
        }}
      />,
      { width: 100, height: 32 },
    );
    try {
      await settle(setup);
      setup.mockInput.pressArrow("down");
      await settle(setup);
      expect(norm(setup.captureCharFrame())).toContain("> terminal");
      await clickText(setup, "[ Open ]");
      expect(suspended).toBe(1);
      expect(spawned).toHaveLength(1);
      expect(spawned[0]).toMatchObject({
        command: "/fake/terminal",
        args: ["--wait"],
        cwd: f.repoDir,
      });
      expect(store.getSnapshot().modal).toBeNull();
    } finally {
      await setup.dispose();
    }

    await store.openOpenModal("acme/api");
    const cancelSetup = await testRender(
      <OpenModal
        store={store}
        onSuspendAndRun={async (run) => {
          suspended++;
          await run();
        }}
      />,
      { width: 100, height: 32 },
    );
    try {
      await clickText(cancelSetup, "[ Cancel ]");
      expect(store.getSnapshot().modal).toBeNull();
      expect(suspended).toBe(1);
      expect(spawned).toHaveLength(1);
    } finally {
      await cancelSetup.dispose();
    }
  });

  test("OpenModal reports app-detection errors and keeps Cancel available", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f, {
      detectAppsFn: async () => {
        throw new Error("fixture app discovery unavailable");
      },
    });
    await store.init();
    await store.openOpenModal("acme/api");
    const setup = await testRender(<OpenModal store={store} onSuspendAndRun={async () => {}} />, {
      width: 100,
      height: 32,
    });
    try {
      await settle(setup);
      expect(store.getSnapshot().modalError).toContain("fixture app discovery unavailable");
      expect(norm(setup.captureCharFrame())).toContain("no apps detected");
      await clickText(setup, "[ Cancel ]");
      expect(store.getSnapshot().modal).toBeNull();
    } finally {
      await setup.dispose();
    }
  });

  test("Reorganize preview options, keyboard toggles, apply effect, and failure status follow visible actions", async () => {
    const f = fixture();
    await f.save();
    const calls: Array<{ target: string; dryRun: boolean; keepCustom: boolean; scan: boolean }> =
      [];
    const marker = path.join(f.base, "reorganize-applied.json");
    const store = makeStore(f, {
      reorganize: async (_root, target = "categorized", options = {}) => {
        calls.push({
          target,
          dryRun: options.dryRun === true,
          keepCustom: options.keepCustom === true,
          scan: options.scan === true,
        });
        if (!options.dryRun) writeFileSync(marker, JSON.stringify({ target, options }));
        return { moved: [], skipped: [], failed: [], collisions: [] };
      },
    });
    await store.init();
    await store.openReorganizeModal();
    const setup = await testRender(<ReorganizeModal store={store} />, { width: 100, height: 32 });
    try {
      await settle(setup);
      expect(norm(setup.captureCharFrame())).toContain("Reorganize workspace");
      setup.mockInput.pressArrow("down");
      setup.mockInput.pressKey("k");
      setup.mockInput.pressKey("s");
      await settle(setup);
      expect(calls.some((call) => call.dryRun && !call.keepCustom && call.scan)).toBe(true);
      expect(norm(setup.captureCharFrame())).toContain("[x] [s] Scan disk");
      setup.mockInput.pressEnter();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await settle(setup);
      expect(existsSync(marker)).toBe(true);
      expect(calls.at(-1)).toMatchObject({ dryRun: false, keepCustom: false, scan: true });
      expect(store.getSnapshot().modal).toBeNull();
      expect(store.getSnapshot().statuses.some((row) => row.key === "[reorganize]")).toBe(true);
    } finally {
      await setup.dispose();
    }

    await store.openReorganizeModal();
    const cancelSetup = await testRender(<ReorganizeModal store={store} />, {
      width: 100,
      height: 32,
    });
    try {
      await settle(cancelSetup);
      cancelSetup.mockInput.pressEscape();
      await settle(cancelSetup);
      expect(store.getSnapshot().modal).toBeNull();
      expect(calls.filter((call) => !call.dryRun)).toHaveLength(1);
    } finally {
      await cancelSetup.dispose();
    }

    const failedStore = makeStore(f, {
      reorganize: async (_root, _target = "categorized", options = {}) => {
        if (!options.dryRun) throw new Error("fixture apply failed");
        return { moved: [], skipped: [], failed: [], collisions: [] };
      },
    });
    await failedStore.init();
    await failedStore.openReorganizeModal();
    const failedSetup = await testRender(<ReorganizeModal store={failedStore} />, {
      width: 100,
      height: 32,
    });
    try {
      await settle(failedSetup);
      failedSetup.mockInput.pressEnter();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(failedStore.getSnapshot().modal).toBeNull();
      expect(
        failedStore
          .getSnapshot()
          .statuses.some(
            (row) => row.phase === "FAILED" && row.message?.includes("fixture apply failed"),
          ),
      ).toBe(true);
    } finally {
      await failedSetup.dispose();
    }
  });

  test("StartPreview builds selected repository entries, cycles preset and starts only through Enter", async () => {
    const f = fixture();
    await f.save();
    const syncCalls: unknown[] = [];
    const store = makeStore(f, {
      sync: async (options) => {
        syncCalls.push(options);
        return { done: [], failed: [], skipped: [] };
      },
    });
    await store.init();
    expect(store.getSnapshot().filteredRepos.length).toBeGreaterThan(0);
    store.toggleRepoAt(0);
    await store.openStartPreview();
    expect(store.getSnapshot().modal).toMatchObject({
      type: "preview",
      entries: [{ key: "acme/api" }],
    });
    const setup = await testRender(<StartPreviewModal store={store} />, { width: 100, height: 32 });
    try {
      await settle(setup);
      const previousPreset = store.getSnapshot().preset;
      setup.mockInput.pressArrow("down");
      setup.mockInput.pressKey("p");
      await settle(setup);
      expect(store.getSnapshot().preset).not.toBe(previousPreset);
      expect(norm(setup.captureCharFrame())).toContain("repositories selected");
      setup.mockInput.pressEnter();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await settle(setup);
      expect(syncCalls).toHaveLength(1);
      expect(store.getSnapshot().modal).toBeNull();
      expect(store.getSnapshot().running).toBe(false);
    } finally {
      await setup.dispose();
    }
    await store.openStartPreview();
    const cancelSetup = await testRender(<StartPreviewModal store={store} />, {
      width: 100,
      height: 32,
    });
    try {
      await clickText(cancelSetup, "[ Cancel ]");
      expect(store.getSnapshot().modal).toBeNull();
      expect(syncCalls).toHaveLength(1);
    } finally {
      await cancelSetup.dispose();
    }
  });

  test("Omnibar runner submits through its focused input and preserves the controlled command result", async () => {
    const f = fixture();
    await f.save();
    const calls: unknown[] = [];
    const store = makeStore(f, {
      runInReposFn: async (options) => {
        calls.push(options);
        return {
          results: [
            {
              key: "acme/api",
              relativePath: "acme/source/api",
              ok: true,
              exitCode: 0,
              durationMs: 1,
              stdout: "fixture output",
              stderr: "",
            },
          ],
          skipped: [],
        };
      },
    });
    await store.init();
    store.openOmnibar("runner", "git status");
    const setup = await testRender(<OmnibarModal store={store} />, { width: 100, height: 32 });
    try {
      await settle(setup);
      expect(norm(setup.captureCharFrame())).toContain("Target scope: all tracked repositories");
      setup.mockInput.pressEnter();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await settle(setup);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ command: "git", args: ["status"], root: f.root });
      expect(store.getSnapshot().modal).toBeNull();
      expect(
        store.getSnapshot().statuses.some((row) => row.message?.includes("fixture output")),
      ).toBe(true);
    } finally {
      await setup.dispose();
    }
  });
});

function norm(frame: string) {
  return frame.replace(/[\u2500-\u257f]/g, " ");
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { simpleGit } from "simple-git";
import { Dashboard } from "../src/components/Dashboard.tsx";
import { Store, type StoreDeps } from "../src/components/store.ts";
import type { RepoInfo } from "../src/services/github.ts";

type RendererSetup = Awaited<ReturnType<typeof testRender>>;

async function settle(setup: RendererSetup): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await setup.flush();
}

function norm(frame: string): string {
  return frame.replace(/[─│┌┐└┘├┤┬┴┼]/g, " ");
}

const tempDirs: string[] = [];
let savedConfigDir: string | undefined;
let isolatedConfigDir: string | null = null;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
});

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  for (const dir of tempDirs)
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function repo(owner: string, name: string, extra: Partial<RepoInfo> = {}): RepoInfo {
  return {
    owner,
    name,
    description: null,
    isPrivate: false,
    isFork: false,
    isArchived: false,
    language: null,
    httpsUrl: `https://github.com/${owner}/${name}.git`,
    sshUrl: `git@github.com:${owner}/${name}.git`,
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

interface DriveDeps {
  deps: StoreDeps;
  forgets: string[];
  deletes: Array<{ key: string; yes: boolean }>;
  reorganizes: Array<{
    preset: string;
    dryRun: boolean | undefined;
    keepCustom: boolean | undefined;
  }>;
  removedWorkspaces: string[];
}

function makeDriveDeps(): DriveDeps {
  const forgets: string[] = [];
  const deletes: DriveDeps["deletes"] = [];
  const reorganizes: DriveDeps["reorganizes"] = [];
  const removedWorkspaces: string[] = [];
  const deps: StoreDeps = {
    auth: async () => ({ token: "t", method: "gh-cli" }),
    github: () => ({
      getUserLogin: async () => "monalisa",
      getActiveOrgs: async () => ["acme-org"],
      listUserRepos: async () => [
        repo("acme", "api", { description: "the api", stars: 42 }),
        repo("octocat", "hello"),
      ],
      listOrgRepos: async () => [],
      getRepo: async (owner: string, name: string) => repo(owner, name),
      createRepo: async (name: string) => repo("monalisa", name),
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
    listWorkspacesFn: async () => [
      {
        root: "C:\\ws\\one",
        path: "C:\\ws\\one",
        preset: "categorized",
        repoCount: 3,
        lastSync: null,
        lastUsed: "2026-10-23T00:00:00.000Z",
        aliases: {},
        missing: false,
      } as never,
      {
        root: "C:\\ws\\gone",
        path: "C:\\ws\\gone",
        preset: "flat-by-owner",
        repoCount: 0,
        lastSync: null,
        lastUsed: "2026-10-22T00:00:00.000Z",
        aliases: {},
        missing: true,
      } as never,
    ],
    forget: (async (_root: string, _config: unknown, ref: string) => {
      forgets.push(ref);
      return { ok: true, message: `forgot ${ref} (kept on disk at acme/source/api)` };
    }) as never,
    deleteRepo: (async (
      _root: string,
      _config: unknown,
      ref: string,
      options: { yes?: boolean },
    ) => {
      deletes.push({ key: ref, yes: options.yes === true });
      return { ok: true, message: `deleted ${ref} (removed acme/source/api)` };
    }) as never,
    reorganize: (async (
      _root: string,
      preset: string,
      options: { dryRun?: boolean; keepCustom?: boolean },
    ) => {
      reorganizes.push({ preset, dryRun: options.dryRun, keepCustom: options.keepCustom });
      return {
        moved: [{ key: "acme/api", from: "acme/source/api", to: "acme/api" }],
        skipped: [],
        failed: [],
        collisions: [],
      };
    }) as never,
    removeWorkspaceFn: (async (target: string) => {
      removedWorkspaces.push(target);
    }) as never,
  };
  return { deps, forgets, deletes, reorganizes, removedWorkspaces };
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
      lastSync: null,
      repos: [
        {
          owner: "acme",
          name: "api",
          relativePath: "acme/source/api",
          category: "source",
          internal: true,
          language: null,
          updatedAt: null,
        },
      ],
      aliases: { api: "acme/source/api" },
    }),
    "utf8",
  );
  return root;
}

async function freshIsolation(): Promise<void> {
  isolatedConfigDir = tempDir("rt-smoke-cfg-");
  process.env.REPOTRUCK_CONFIG_DIR = isolatedConfigDir;
}

async function renderDashboard(
  root: string,
  deps: StoreDeps,
): Promise<{ setup: RendererSetup; store: Store }> {
  const store = new Store(root, deps);
  const setup = await testRender(
    <Dashboard store={store} onQuit={() => {}} onSuspendAndRun={async () => {}} />,
    { width: 120, height: 40, exitOnCtrlC: false },
  );
  for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(store.getSnapshot().phase).toBe("ready");
  await settle(setup);
  return { setup, store };
}

describe("dashboard render smoke", () => {
  test("panels, search flow, sort label, help modal, focus quirk", async () => {
    await freshIsolation();
    const root = makeWorkspace("rt-smoke1-");
    const { setup, store } = await renderDashboard(root, makeDriveDeps().deps);
    try {
      let frame = norm(setup.captureCharFrame());
      expect(frame).toContain("repotruck · monalisa");
      expect(frame).toContain("[Tab] Focus");
      expect(frame).toContain("Scope");
      expect(frame).toContain("Repositories");
      expect(frame).toContain("Status");
      expect(frame).toContain("[ ] api");
      expect(frame).toContain("[ ] hello");

      setup.mockInput.pressKey("/");
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).toContain("Search");
      await setup.mockInput.typeText("hello");
      await settle(setup);
      // Live search: the filter applies per keystroke, before Enter.
      expect(store.getSnapshot().search).toBe("hello");
      expect(store.getSnapshot().filteredRepos.map((item) => item.name)).toEqual(["hello"]);
      setup.mockInput.pressEnter();
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).toContain("search: hello");
      expect(frame).not.toContain("[ ] api");
      expect(frame).toContain("[ ] hello");

      setup.mockInput.pressEscape();
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).toContain("[ ] api");

      setup.mockInput.pressKey("s");
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).toContain("sort: name");

      setup.mockInput.pressKey("?");
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).toContain("Keyboard shortcuts");
      expect(frame).toContain("[Tab] Focus");
      setup.mockInput.pressEscape();
      await settle(setup);

      setup.mockInput.pressTab();
      await settle(setup);
      setup.mockInput.pressKey("o");
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).not.toContain("Open in app");

      setup.mockInput.pressTab();
      await settle(setup);
      setup.mockInput.pressKey("r");
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).not.toContain("Set alias");

      setup.mockInput.pressTab();
      await settle(setup);
      setup.mockInput.pressKey("o");
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).toContain("Open in app");
      setup.mockInput.pressEscape();
      await settle(setup);
    } finally {
      await setup.dispose();
    }
  }, 20_000);

  test("plain d/r open their modals, capital D/R open theirs (T2')", async () => {
    await freshIsolation();
    const root = makeWorkspace("rt-smoke2-");
    const { setup } = await renderDashboard(root, makeDriveDeps().deps);
    try {
      setup.mockInput.pressKey("d");
      await settle(setup);
      expect(norm(setup.captureCharFrame())).toContain("Default root");
      setup.mockInput.pressEscape();
      await settle(setup);

      setup.mockInput.pressKey("r");
      await settle(setup);
      expect(norm(setup.captureCharFrame())).toContain("Set alias");
      setup.mockInput.pressEscape();
      await settle(setup);

      setup.mockInput.pressKey("D");
      await settle(setup);
      expect(norm(setup.captureCharFrame())).toContain("Delete repository");
      setup.mockInput.pressEscape();
      await settle(setup);

      setup.mockInput.pressKey("R");
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(setup);
      const frame = norm(setup.captureCharFrame());
      expect(frame).toContain("Reorganize workspace");
      expect(frame).toContain("acme/source/api -> acme/api");
      setup.mockInput.pressEscape();
      await settle(setup);
    } finally {
      await setup.dispose();
    }
  }, 20_000);

  test("detail modal shows remote info plus local git state for both branches", async () => {
    await freshIsolation();
    const root = makeWorkspace("rt-smoke3-");
    const dir = path.join(root, "acme", "source", "api");
    const git = simpleGit(dir);
    await git.init(["-b", "main"]);
    await git.addConfig("user.email", "t@t");
    await git.addConfig("user.name", "t");
    writeFileSync(path.join(dir, "file.txt"), "v1\n", "utf8");
    await git.add(".");
    await git.commit("initial");
    writeFileSync(path.join(dir, "file.txt"), "edited\n", "utf8");

    const { setup } = await renderDashboard(root, makeDriveDeps().deps);
    try {
      setup.mockInput.pressKey("i");
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await settle(setup);
      let frame = norm(setup.captureCharFrame());
      expect(frame).toContain("Repository details");
      expect(frame).toContain("description: the api");
      expect(frame).toContain("stars: 42");
      expect(frame).toContain("tracked at acme/source/api");
      expect(frame).toContain("alias: api");
      expect(frame).toContain("dirty");
      setup.mockInput.pressEscape();
      await settle(setup);

      setup.mockInput.pressArrow("down");
      await settle(setup);
      setup.mockInput.pressKey("i");
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).toContain("not tracked by repotruck");
      expect(frame).not.toContain("stars:");
      setup.mockInput.pressEscape();
      await settle(setup);
    } finally {
      await setup.dispose();
    }
  }, 20_000);

  test("u asks for confirmation, y confirms, n cancels; D->y deletes (fake seams)", async () => {
    await freshIsolation();
    const root = makeWorkspace("rt-smoke4-");
    const drive = makeDriveDeps();
    const { setup } = await renderDashboard(root, drive.deps);
    try {
      setup.mockInput.pressKey("u");
      await settle(setup);
      let frame = norm(setup.captureCharFrame());
      expect(frame).toContain("Untrack repository");
      expect(frame).toContain("stop tracking acme/api");
      expect(drive.forgets).toEqual([]);

      setup.mockInput.pressKey("n");
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).not.toContain("Untrack repository");
      expect(drive.forgets).toEqual([]);

      setup.mockInput.pressKey("u");
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).toContain("Untrack repository");
      setup.mockInput.pressKey("y");
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(setup);
      expect(drive.forgets).toEqual(["acme/api"]);
      frame = norm(setup.captureCharFrame());
      expect(frame).toContain("[DONE] [tui] — forgot acme/api");

      setup.mockInput.pressKey("D");
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(setup);
      let confirmFrame = norm(setup.captureCharFrame());
      expect(confirmFrame).toContain("Delete repository");
      expect(confirmFrame).toContain(".repotruck/trash");
      setup.mockInput.pressKey("n");
      await settle(setup);
      expect(drive.deletes).toEqual([]);
      expect(norm(setup.captureCharFrame())).not.toContain("Delete repository");

      setup.mockInput.pressKey("D");
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(setup);
      confirmFrame = norm(setup.captureCharFrame());
      expect(confirmFrame).toContain("Delete repository");
      setup.mockInput.pressKey("y");
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(setup);
      expect(drive.deletes).toEqual([{ key: "acme/api", yes: true }]);
      expect(norm(setup.captureCharFrame())).toContain("[DONE] [tui] — deleted acme/api");
    } finally {
      await setup.dispose();
    }
  }, 20_000);

  test("R previews dry-run first and Enter applies the real run", async () => {
    await freshIsolation();
    const root = makeWorkspace("rt-smoke5-");
    const drive = makeDriveDeps();
    const { setup } = await renderDashboard(root, drive.deps);
    try {
      setup.mockInput.pressKey("R");
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(setup);
      expect(norm(setup.captureCharFrame())).toContain("Reorganize workspace");
      expect(drive.reorganizes).toEqual([
        { preset: "categorized", dryRun: true, keepCustom: true },
      ]);

      setup.mockInput.pressArrow("down");
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(setup);
      expect(drive.reorganizes[drive.reorganizes.length - 1]!.dryRun).toBe(true);
      expect(drive.reorganizes[drive.reorganizes.length - 1]!.preset).toBe("flat-by-owner");

      setup.mockInput.pressEnter();
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(setup);
      expect(drive.reorganizes[drive.reorganizes.length - 1]!.dryRun).toBeUndefined();
      expect(drive.reorganizes[drive.reorganizes.length - 1]!.preset).toBe("flat-by-owner");
      expect(norm(setup.captureCharFrame())).toContain("[DONE] [reorganize]");
    } finally {
      await setup.dispose();
    }
  }, 20_000);

  test("workspace picker x removes the highlighted entry", async () => {
    await freshIsolation();
    const root = makeWorkspace("rt-smoke6-");
    const drive = makeDriveDeps();
    const { setup } = await renderDashboard(root, drive.deps);
    try {
      setup.mockInput.pressKey("w");
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(setup);
      let frame = norm(setup.captureCharFrame());
      expect(frame).toContain("Workspaces");
      expect(frame).toContain("C:\\ws\\one");
      expect(frame).toContain("missing, not switchable");

      setup.mockInput.pressKey("x");
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(setup);
      expect(drive.removedWorkspaces).toEqual(["C:\\ws\\one"]);
      frame = norm(setup.captureCharFrame());
      expect(frame).toContain("removed C:\\ws\\one");
    } finally {
      await setup.dispose();
    }
  }, 20_000);

  test("running footer shows working counts and q needs a second press while syncing", async () => {
    await freshIsolation();
    const root = makeWorkspace("rt-smoke7-");
    const drive = makeDriveDeps();
    let releaseSync: (() => void) | null = null;
    drive.deps.sync = (() =>
      new Promise<void>((resolve) => {
        releaseSync = resolve;
      })) as never;
    const quits: number[] = [];
    const store = new Store(root, drive.deps);
    const setup = await testRender(
      <Dashboard store={store} onQuit={() => quits.push(1)} onSuspendAndRun={async () => {}} />,
      { width: 120, height: 40, exitOnCtrlC: false },
    );
    for (let i = 0; i < 40 && store.getSnapshot().phase !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(store.getSnapshot().phase).toBe("ready");
    await settle(setup);
    try {
      setup.mockInput.pressKey(" ");
      await settle(setup);
      setup.mockInput.pressEnter();
      await settle(setup);
      setup.mockInput.pressEnter();
      await settle(setup);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle(setup);
      expect(store.getSnapshot().running).toBe(true);
      let frame = norm(setup.captureCharFrame());
      expect(frame).toContain("working…");
      expect(frame).toContain("0 cloning/pulling");
      expect(frame).toContain("0 failed");
      expect(frame).not.toContain("[Tab] Focus");

      setup.mockInput.pressKey("q");
      await settle(setup);
      frame = norm(setup.captureCharFrame());
      expect(frame).toContain("sync in progress — press q again to quit");
      expect(quits).toEqual([]);

      setup.mockInput.pressKey("q");
      await settle(setup);
      expect(quits.length).toBe(1);
    } finally {
      (releaseSync as (() => void) | null)?.();
      await setup.dispose();
    }
  }, 20_000);

  test("mouse interactions: clicking footer opens help, right click closes, clicking repo selects", async () => {
    await freshIsolation();
    const root = makeWorkspace("rt-smoke-mouse-");
    const drive = makeDriveDeps();
    const { setup, store } = await renderDashboard(root, drive.deps);
    try {
      expect(store.getSnapshot().modal).toBeNull();

      const emitMouse = (event: {
        type: "down";
        button: number;
        x: number;
        y: number;
        modifiers: { shift: boolean; alt: boolean; ctrl: boolean };
      }) => {
        (
          setup.renderer as unknown as {
            processSingleMouseEvent: (e: typeof event) => void;
          }
        ).processSingleMouseEvent(event);
      };

      // Click footer [?] Help at x=40, y=38
      emitMouse({
        type: "down",
        button: 0,
        x: 40,
        y: 38,
        modifiers: { shift: false, alt: false, ctrl: false },
      });
      await settle(setup);
      expect(store.getSnapshot().modal?.type).toBe("help");
      const frame = norm(setup.captureCharFrame());
      expect(frame).toContain("Keyboard shortcuts");
      expect(frame).toContain("[× Close]");

      // Right-click to dismiss modal
      emitMouse({
        type: "down",
        button: 2,
        x: 60,
        y: 10,
        modifiers: { shift: false, alt: false, ctrl: false },
      });
      await settle(setup);
      expect(store.getSnapshot().modal).toBeNull();

      // Click second repo row
      expect(store.getSnapshot().cursor).toBe(0);
      emitMouse({
        type: "down",
        button: 0,
        x: 60,
        y: 5,
        modifiers: { shift: false, alt: false, ctrl: false },
      });
      await settle(setup);
      expect(store.getSnapshot().cursor).toBe(1);

      // Click checkbox of active repo (x=28)
      expect(store.getSnapshot().selected.size).toBe(0);
      emitMouse({
        type: "down",
        button: 0,
        x: 28,
        y: 5,
        modifiers: { shift: false, alt: false, ctrl: false },
      });
      await settle(setup);
      expect(store.getSnapshot().selected.size).toBe(1);
    } finally {
      await setup.dispose();
    }
  }, 20_000);
});

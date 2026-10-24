import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildSidebarRows,
  type CreateDraft,
  filterRepos,
  nextCreateStep,
  prevCreateStep,
  STATUS_VIEW_ROWS,
  Store,
  type StoreDeps,
  type StoreSnapshot,
  searchRepos,
  sidebarRowIndexForY,
  sortRepos,
  validateCreateDraft,
} from "../src/components/store.ts";
import { PRESET_IDS } from "../src/presets/index.ts";
import { appConfigDir } from "../src/services/config.ts";
import type { CreateRepoOptions, RepoInfo } from "../src/services/github.ts";
import type { AppEntry } from "../src/services/launcher.ts";
import { deleteRepository } from "../src/services/lifecycle.ts";
import { osDefaultRoot } from "../src/services/settings.ts";
import { loadWorkspace } from "../src/services/workspace.ts";

const tempRoots: string[] = [];

let isolatedConfigDir: string;
let savedConfigDir: string | undefined;
let realStoreBefore: string | null = null;
const pendingTempDirs: string[] = [];
const REAL_STORE = path.join(appConfigDir(process.env), "repotruck.json");

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  isolatedConfigDir = realpathSync(mkdtempSync(path.join(tmpdir(), "repotruck-store-cfg-")));
  process.env.REPOTRUCK_CONFIG_DIR = isolatedConfigDir;
  try {
    realStoreBefore = readFileSync(REAL_STORE, "utf8");
  } catch {
    realStoreBefore = null;
  }
});

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  let realStoreAfter: string | null = null;
  try {
    realStoreAfter = readFileSync(REAL_STORE, "utf8");
  } catch {
    realStoreAfter = null;
  }
  expect(realStoreAfter).toBe(realStoreBefore);
  rmSync(isolatedConfigDir, { recursive: true, force: true });
});

function sweepTempRoots(roots: string[]): string[] {
  const pending: string[] = [];
  for (const dir of roots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      pending.push(dir);
    }
  }
  return pending;
}

afterEach(() => {
  pendingTempDirs.push(...sweepTempRoots(tempRoots));
});

afterAll(() => {
  pendingTempDirs.push(...sweepTempRoots(pendingTempDirs));
  pendingTempDirs.push(...sweepTempRoots(tempRoots));
  for (const dir of pendingTempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* best-effort: the OS releases these locks moments later */
    }
  }
});

function tempWorkspace(preset = "categorized"): string {
  const dir = (realpathSync.native ?? realpathSync)(
    mkdtempSync(path.join(tmpdir(), "repotruck-tui-store-")),
  );
  tempRoots.push(dir);
  writeFileSync(
    path.join(dir, "repotruck.json"),
    JSON.stringify({
      version: 1,
      root: dir,
      preset,
      lastSync: null,
      repos: [
        {
          owner: "acme",
          name: "api",
          relativePath: "acme/source/api",
          category: "source",
          internal: true,
          language: "Go",
          updatedAt: null,
        },
      ],
    }),
    "utf8",
  );
  return dir;
}

function readCentralEntry(root: string): Record<string, unknown> | null {
  const store = JSON.parse(
    readFileSync(path.join(isolatedConfigDir, "repotruck.json"), "utf8"),
  ) as { workspaces?: Array<{ root: string }> };
  const target = root.toLowerCase();
  const entry = store.workspaces?.find((item) => {
    if (item.root.toLowerCase() === target || path.resolve(item.root).toLowerCase() === target) {
      return true;
    }
    try {
      const nr = (realpathSync.native ?? realpathSync)(root).toLowerCase();
      const ni = (realpathSync.native ?? realpathSync)(item.root).toLowerCase();
      return ni === nr;
    } catch {
      return false;
    }
  });
  return entry ?? null;
}

function repo(
  owner: string,
  name: string,
  flags: {
    isPrivate?: boolean;
    isFork?: boolean;
    isArchived?: boolean;
    language?: string | null;
  } = {},
): RepoInfo {
  return {
    owner,
    name,
    description: null,
    isPrivate: flags.isPrivate ?? false,
    isFork: flags.isFork ?? false,
    isArchived: flags.isArchived ?? false,
    language: flags.language ?? null,
    httpsUrl: `https://github.com/${owner}/${name}.git`,
    sshUrl: `git@github.com:${owner}/${name}.git`,
    updatedAt: null,
  };
}

interface FakeGithubCalls {
  logins: number;
  orgs: number;
  userRepos: number;
  orgRepos: string[];
  creates: Array<{ name: string; options: CreateRepoOptions }>;
  gets: Array<{ owner: string; name: string }>;
}

function makeFakeGithubCalls(): FakeGithubCalls {
  return { logins: 0, orgs: 0, userRepos: 0, orgRepos: [], creates: [], gets: [] };
}

function fakeGithub(repos: RepoInfo[], calls: FakeGithubCalls): NonNullable<StoreDeps["github"]> {
  return (token: string) => ({
    getUserLogin: async () => {
      calls.logins += 1;
      void token;
      return "monalisa";
    },
    getActiveOrgs: async () => {
      calls.orgs += 1;
      return ["acme-org"];
    },
    listUserRepos: async () => {
      calls.userRepos += 1;
      return repos;
    },
    listOrgRepos: async (org: string) => {
      calls.orgRepos.push(org);
      return [repo(org, "shared")];
    },
    getRepo: async (owner: string, name: string) => {
      calls.gets.push({ owner, name });
      return repo(owner, name);
    },
    createRepo: async (name: string, options: CreateRepoOptions) => {
      calls.creates.push({ name, options });
      return repo(options.org ?? "monalisa", name);
    },
  });
}

interface TestHarness {
  store: Store;
  calls: FakeGithubCalls;
  clones: string[];
  syncs: Array<{ keys: string[]; preset?: string }>;
  moves: Array<{ key: string; dest: string }>;
  creates: Array<{ name: string }>;
  forgets: string[];
  deletes: Array<{ key: string; yes: boolean }>;
  reorganizes: Array<{
    preset: string;
    dryRun: boolean | undefined;
    keepCustom: boolean | undefined;
  }>;
  removedWorkspaces: string[];
  listedWorkspaces: number;
  snapshot: () => StoreSnapshot;
}

function makeStore(root: string, personalRepos: RepoInfo[] = []): TestHarness {
  const calls = makeFakeGithubCalls();
  const clones: string[] = [];
  const syncs: Array<{ keys: string[]; preset?: string }> = [];
  const moves: Array<{ key: string; dest: string }> = [];
  const creates: Array<{ name: string }> = [];
  const forgets: string[] = [];
  const deletes: Array<{ key: string; yes: boolean }> = [];
  const reorganizes: TestHarness["reorganizes"] = [];
  const removedWorkspaces: string[] = [];
  let listedWorkspaces = 0;
  const deps: StoreDeps = {
    auth: async () => ({ token: "test-token", method: "gh-cli" }),
    github: fakeGithub(personalRepos, calls),
    cloneSingle: (async (url: string) => {
      clones.push(url);
      return {
        repo: repo("octocat", "hello"),
        destDir: path.join(root, "community", "octocat", "source", "hello"),
        internal: false,
        preset: "categorized" as const,
        progress: {
          key: "octocat/hello",
          owner: "octocat",
          name: "hello",
          phase: "done" as const,
          message: "cloned",
        },
      };
    }) as unknown as NonNullable<StoreDeps["cloneSingle"]>,
    sync: (async (options: { repos: RepoInfo[]; config?: { preset: string } }) => {
      syncs.push({
        keys: options.repos.map((item) => `${item.owner}/${item.name}`),
        preset: options.config?.preset,
      });
      return { done: [], failed: [] };
    }) as unknown as NonNullable<StoreDeps["sync"]>,
    move: (async (_root: string, _config: unknown, key: string, dest: string) => {
      moves.push({ key, dest });
      return { ok: true, message: `moved to ${dest}` };
    }) as unknown as NonNullable<StoreDeps["move"]>,
    create: (async (input: { options: { name: string } }) => {
      creates.push({ name: input.options.name });
      return {
        ok: true,
        message: `created ${input.options.name}`,
        destDir: root,
        relativePath: "x",
      };
    }) as unknown as NonNullable<StoreDeps["create"]>,
    listWorkspacesFn: (async () => {
      listedWorkspaces += 1;
      return [];
    }) as unknown as NonNullable<StoreDeps["listWorkspacesFn"]>,
    forget: (async (_root: string, _config: unknown, ref: string) => {
      forgets.push(ref);
      return { ok: true, message: `forgot ${ref} (kept on disk at x)` };
    }) as unknown as NonNullable<StoreDeps["forget"]>,
    deleteRepo: (async (
      _root: string,
      _config: unknown,
      ref: string,
      options: { yes?: boolean },
    ) => {
      deletes.push({ key: ref, yes: options.yes === true });
      return { ok: true, message: `deleted ${ref} (removed x)` };
    }) as unknown as NonNullable<StoreDeps["deleteRepo"]>,
    reorganize: (async (
      _root: string,
      preset: string,
      options: { dryRun?: boolean; keepCustom?: boolean },
    ) => {
      reorganizes.push({
        preset,
        dryRun: options.dryRun,
        keepCustom: options.keepCustom,
      });
      return {
        moved: [{ key: "acme/api", from: "acme/source/api", to: "acme/api" }],
        skipped: [],
        failed: [],
        collisions: [],
      };
    }) as unknown as NonNullable<StoreDeps["reorganize"]>,
    removeWorkspaceFn: (async (target: string) => {
      removedWorkspaces.push(target);
    }) as unknown as NonNullable<StoreDeps["removeWorkspaceFn"]>,
    now: () => "2026-10-23T00:00:00.000Z",
  };
  const store = new Store(root, deps);
  return {
    store,
    calls,
    clones,
    syncs,
    moves,
    creates,
    forgets,
    deletes,
    reorganizes,
    removedWorkspaces,
    get listedWorkspaces() {
      return listedWorkspaces;
    },
    snapshot: () => store.getSnapshot(),
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe("store init", () => {
  test("loads auth, user, orgs and personal repos into a ready snapshot", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("monalisa", "api"), repo("monalisa", "web")]);
    await h.store.init();
    const snap = h.snapshot();
    expect(snap.phase).toBe("ready");
    expect(snap.userLogin).toBe("monalisa");
    expect(snap.authMethod).toBe("gh-cli");
    expect(snap.orgs).toEqual(["acme-org"]);
    expect(snap.repos.length).toBe(2);
    expect(snap.preset).toBe("categorized");
    expect(snap.root).toBe(root);
  });

  test("auth failure lands in the error state with the message", async () => {
    const root = tempWorkspace();
    const store = new Store(root, {
      auth: async () => {
        throw new Error("GitHub authentication is not available");
      },
    });
    await store.init();
    const snap = store.getSnapshot();
    expect(snap.phase).toBe("error");
    expect(snap.errorMessage).toContain("authentication is not available");
  });

  test("store is constructible headlessly with no renderer", () => {
    const root = tempWorkspace();
    const store = new Store(root, {
      auth: async () => ({ token: "t", method: "device" }),
    });
    expect(store.getSnapshot().phase).toBe("loading");
    expect(store.getSnapshot().root).toBe(root);
  });
});

describe("store org and filter state", () => {
  test("toggleOrg fetches, caches and merges org repos without duplicates", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("monalisa", "api")]);
    await h.store.init();
    await h.store.toggleOrg("acme-org");
    let snap = h.snapshot();
    expect(snap.selectedOrgs.has("acme-org")).toBe(true);
    expect(snap.repos.length).toBe(2);
    expect(h.calls.orgRepos).toEqual(["acme-org"]);
    await h.store.toggleOrg("acme-org");
    snap = h.snapshot();
    expect(snap.selectedOrgs.has("acme-org")).toBe(false);
    expect(snap.repos.length).toBe(1);
    await h.store.toggleOrg("acme-org");
    expect(h.calls.orgRepos).toEqual(["acme-org"]);
    snap = h.snapshot();
    expect(snap.repos.length).toBe(2);
  });

  test("filters map archived, fork and active repos", () => {
    const repos = [
      repo("a", "active"),
      repo("b", "forked", { isFork: true }),
      repo("c", "old", { isArchived: true }),
    ];
    const all = { active: true, forks: true, archived: true };
    expect(filterRepos(repos, all).length).toBe(3);
    expect(filterRepos(repos, { active: false, forks: true, archived: true }).length).toBe(2);
    expect(filterRepos(repos, { active: false, forks: false, archived: false }).length).toBe(0);
  });

  test("setFilter recomputes filteredRepos", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [
      repo("monalisa", "api"),
      repo("monalisa", "old", { isArchived: true }),
    ]);
    await h.store.init();
    expect(h.snapshot().filteredRepos.length).toBe(2);
    h.store.setFilter("archived", false);
    expect(h.snapshot().filteredRepos.length).toBe(1);
  });
});

describe("store cursor and selection", () => {
  test("moveCursor clamps at both ends", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("s", "a"), repo("s", "b"), repo("s", "c")]);
    await h.store.init();
    h.store.moveCursor(-5);
    expect(h.snapshot().cursor).toBe(0);
    h.store.moveCursor(2);
    expect(h.snapshot().cursor).toBe(2);
    h.store.moveCursor(10);
    expect(h.snapshot().cursor).toBe(2);
  });

  test("setCursor jumps and clamps at both ends", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("s", "a"), repo("s", "b"), repo("s", "c")]);
    await h.store.init();
    h.store.setCursor(2);
    expect(h.snapshot().cursor).toBe(2);
    h.store.setCursor(-3);
    expect(h.snapshot().cursor).toBe(0);
    h.store.setCursor(99);
    expect(h.snapshot().cursor).toBe(2);
    h.store.setCursor(1);
    expect(h.snapshot().cursor).toBe(1);
  });

  test("pageCursor moves by the viewport height and clamps", async () => {
    const root = tempWorkspace();
    const many = Array.from({ length: 25 }, (_, i) => repo("s", `r${String(i).padStart(2, "0")}`));
    const h = makeStore(root, many);
    await h.store.init();
    h.store.pageCursor(1, 10);
    expect(h.snapshot().cursor).toBe(10);
    h.store.pageCursor(1, 10);
    expect(h.snapshot().cursor).toBe(20);
    h.store.pageCursor(1, 10);
    expect(h.snapshot().cursor).toBe(24);
    h.store.pageCursor(-1, 10);
    expect(h.snapshot().cursor).toBe(14);
    h.store.pageCursor(-5, 10);
    expect(h.snapshot().cursor).toBe(0);
    h.store.pageCursor(1, 0);
    expect(h.snapshot().cursor).toBe(1);
  });

  test("toggleCurrent flips membership immutably", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("s", "a"), repo("s", "b")]);
    await h.store.init();
    const before = h.snapshot().selected;
    h.store.toggleCurrent();
    const after = h.snapshot().selected;
    expect(before.has("s/a")).toBe(false);
    expect(after.has("s/a")).toBe(true);
    expect(before).not.toBe(after);
    h.store.toggleCurrent();
    expect(h.snapshot().selected.has("s/a")).toBe(false);
  });

  test("selectAll selects all, then clears when everything is selected", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("s", "a"), repo("s", "b")]);
    await h.store.init();
    h.store.selectAll();
    expect(h.snapshot().selected.size).toBe(2);
    h.store.selectAll();
    expect(h.snapshot().selected.size).toBe(0);
  });

  test("cyclePreset cycles through every preset", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    for (const expected of PRESET_IDS.slice(1)) {
      h.store.cyclePreset();
      expect(h.snapshot().preset).toBe(expected);
    }
    h.store.cyclePreset();
    expect(h.snapshot().preset).toBe("categorized");
  });
});

describe("store start (sync)", () => {
  test("runs syncRepos over the selection", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("s", "a"), repo("s", "b")]);
    await h.store.init();
    h.store.moveCursor(1);
    h.store.toggleCurrent();
    await h.store.start();
    expect(h.syncs.length).toBe(1);
    expect(h.syncs[0]!.keys).toEqual(["s/b"]);
    const snap = h.snapshot();
    expect(snap.running).toBe(false);
  });

  test("start with nothing selected records a failed status and never syncs", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("s", "a")]);
    await h.store.init();
    await h.store.start();
    expect(h.syncs.length).toBe(0);
    expect(h.snapshot().statuses.length).toBe(1);
    expect(h.snapshot().statuses[0]!.phase).toBe("FAILED");
  });

  test("statuses cap at 300 entries", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("s", "a")]);
    await h.store.init();
    h.store.toggleCurrent();
    for (let i = 0; i < 310; i += 1) {
      await h.store.start();
    }
    expect(h.snapshot().statuses.length).toBeLessThanOrEqual(300);
    expect(h.syncs.length).toBe(310);
  });
});

describe("status log scrolling", () => {
  test("moveStatusScroll clamps between zero and statuses minus the view window", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("s", "a")]);
    await h.store.init();
    // Every start with nothing selected records one FAILED status.
    for (let i = 0; i < STATUS_VIEW_ROWS + 3; i += 1) {
      await h.store.start();
    }
    expect(h.snapshot().statuses.length).toBe(STATUS_VIEW_ROWS + 3);
    expect(h.snapshot().statusScroll).toBe(0);
    h.store.moveStatusScroll(1);
    expect(h.snapshot().statusScroll).toBe(1);
    h.store.moveStatusScroll(100);
    expect(h.snapshot().statusScroll).toBe(3);
    h.store.moveStatusScroll(-100);
    expect(h.snapshot().statusScroll).toBe(0);
    h.store.moveStatusScroll(-1);
    expect(h.snapshot().statusScroll).toBe(0);
  });

  test("scrolling is a no-op while the log fits the view window", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("s", "a")]);
    await h.store.init();
    await h.store.start();
    h.store.moveStatusScroll(1);
    expect(h.snapshot().statusScroll).toBe(0);
  });
});

describe("store modals", () => {
  test("clone modal: invalid URL keeps the modal and sets an English error", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    h.store.openCloneModal();
    expect(h.snapshot().modal).toEqual({ type: "clone" });
    const ok = await h.store.submitClone("not a url!!");
    expect(ok).toBe(false);
    expect(h.snapshot().modal).toEqual({ type: "clone" });
    expect(h.snapshot().modalError).toContain("invalid GitHub repository URL");
    expect(h.clones.length).toBe(0);
  });

  test("clone modal: valid URL calls the injected cloner and closes", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    h.store.openCloneModal();
    const ok = await h.store.submitClone("https://github.com/octocat/hello");
    expect(ok).toBe(true);
    expect(h.clones).toEqual(["https://github.com/octocat/hello"]);
    expect(h.snapshot().modal).toBeNull();
    expect(h.snapshot().modalError).toBeNull();
  });

  test("move modal: injected failure surfaces in the modal, success closes", async () => {
    const root = tempWorkspace();
    const failing = new Store(root, {
      auth: async () => ({ token: "t", method: "gh-cli" }),
      github: fakeGithub([], makeFakeGithubCalls()),
      move: (async () => ({
        ok: false,
        message: "destination already exists on disk: blocked/lib",
      })) as unknown as NonNullable<StoreDeps["move"]>,
    });
    await failing.init();
    await failing.openMoveModal("acme/api");
    expect(failing.getSnapshot().modal).toEqual({ type: "move", key: "acme/api" });
    expect(failing.getSnapshot().movePrefill).toBe("acme/source/api");
    const ok = await failing.submitMove("blocked/lib");
    expect(ok).toBe(false);
    expect(failing.getSnapshot().modalError).toContain("destination already exists");
    expect(failing.getSnapshot().modal).toEqual({ type: "move", key: "acme/api" });

    const h = makeStore(root, []);
    await h.store.init();
    await h.store.openMoveModal("acme/api");
    const moved = await h.store.submitMove("acme/moved/api");
    expect(moved).toBe(true);
    expect(h.moves).toEqual([{ key: "acme/api", dest: "acme/moved/api" }]);
    expect(h.snapshot().modal).toBeNull();
  });

  test("move modal rejects invalid destinations without calling move", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    await h.store.openMoveModal("acme/api");
    const ok = await h.store.submitMove("../escape");
    expect(ok).toBe(false);
    expect(h.moves.length).toBe(0);
    expect(h.snapshot().modalError).toContain("invalid destination path");
  });

  test("modal open and close clear the error line", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    h.store.openCloneModal();
    expect(h.snapshot().modal).not.toBeNull();
    h.store.closeModal();
    expect(h.snapshot().modal).toBeNull();
    expect(h.snapshot().modalError).toBeNull();
  });
});

describe("create wizard", () => {
  test("nextCreateStep walks the six wizard steps and stops", () => {
    expect(nextCreateStep("name")).toBe("source");
    expect(nextCreateStep("source")).toBe("org");
    expect(nextCreateStep("org")).toBe("path");
    expect(nextCreateStep("path")).toBe("description");
    expect(nextCreateStep("description")).toBe("visibility");
    expect(nextCreateStep("visibility")).toBeNull();
  });

  test("prevCreateStep walks the wizard backwards and stops at name", () => {
    expect(prevCreateStep("visibility")).toBe("description");
    expect(prevCreateStep("description")).toBe("path");
    expect(prevCreateStep("path")).toBe("org");
    expect(prevCreateStep("org")).toBe("source");
    expect(prevCreateStep("source")).toBe("name");
    expect(prevCreateStep("name")).toBeNull();
  });

  test("validateCreateDraft rejects bad names and bad paths", () => {
    const good: CreateDraft = { name: "api", path: "", isPrivate: true };
    expect(validateCreateDraft(good)).toBeNull();
    expect(validateCreateDraft({ ...good, name: "-bad" })).toContain("invalid repository name");
    expect(validateCreateDraft({ ...good, path: "../escape" })).toContain(
      "invalid destination path",
    );
  });

  test("openCreateModal starts at the name step with a private draft", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    h.store.openCreateModal();
    const modal = h.snapshot().modal;
    expect(modal).not.toBeNull();
    expect(modal!.type).toBe("create");
    if (modal!.type === "create") {
      expect(modal!.step).toBe("name");
      expect(modal!.draft.isPrivate).toBe(true);
    }
  });

  test("submitCreate validates, calls the injected creator and closes", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    h.store.openCreateModal();
    const ok = await h.store.submitCreate({ name: "api", path: "", isPrivate: true });
    expect(ok).toBe(true);
    expect(h.creates).toEqual([{ name: "api" }]);
    expect(h.snapshot().modal).toBeNull();
  });

  test("submitCreate failure keeps the modal with the creator message", async () => {
    const root = tempWorkspace();
    const store = new Store(root, {
      auth: async () => ({ token: "t", method: "gh-cli" }),
      github: fakeGithub([], makeFakeGithubCalls()),
      create: (async () => ({
        ok: false,
        message: "name already exists on GitHub",
      })) as unknown as NonNullable<StoreDeps["create"]>,
    });
    await store.init();
    store.openCreateModal();
    const ok = await store.submitCreate({ name: "api", path: "", isPrivate: true });
    expect(ok).toBe(false);
    expect(store.getSnapshot().modal).not.toBeNull();
    expect(store.getSnapshot().modalError).toBe("name already exists on GitHub");
  });

  test("presetTargetFor returns the internal preset path for the user", async () => {
    const root = tempWorkspace("flat-by-owner");
    const h = makeStore(root, []);
    await h.store.init();
    expect(h.store.presetTargetFor("api")).toBe("monalisa/api");
  });
});

describe("workspaces modal", () => {
  test("openWorkspacePicker loads listings and switchWorkspace re-inits", async () => {
    const first = tempWorkspace();
    const second = tempWorkspace("flat-by-owner");
    const store = new Store(first, {
      auth: async () => ({ token: "t", method: "gh-cli" }),
      github: fakeGithub([], makeFakeGithubCalls()),
      listWorkspacesFn: (async () => [
        {
          path: first,
          preset: "categorized" as const,
          lastSync: null,
          repoCount: 1,
          lastUsed: "2026-10-23T00:00:00.000Z",
          missing: false,
        },
        {
          path: path.join(second, "gone"),
          preset: "flat-by-owner" as const,
          lastSync: null,
          repoCount: 0,
          lastUsed: "2026-10-22T00:00:00.000Z",
          missing: true,
        },
      ]) as unknown as NonNullable<StoreDeps["listWorkspacesFn"]>,
    });
    await store.init();
    await store.openWorkspacePicker();
    expect(store.getSnapshot().modal).toEqual({
      type: "workspaces",
      recordsPath: path.join(isolatedConfigDir, "repotruck.json"),
    });
    expect(store.getSnapshot().workspaces.length).toBe(2);
    expect(store.getSnapshot().workspaces[1]!.missing).toBe(true);
    await store.switchWorkspace(second);
    const snap = store.getSnapshot();
    expect(snap.root).toBe(second);
    expect(snap.modal).toBeNull();
    expect(snap.preset).toBe("flat-by-owner");
  });
});

describe("start preview modal", () => {
  function writePreviewFixture(root: string): void {
    mkdirSync(path.join(root, "monalisa", "source", "web"), { recursive: true });
    writeFileSync(
      path.join(root, "repotruck.json"),
      JSON.stringify({
        version: 1,
        root,
        preset: "categorized",
        lastSync: null,
        repos: [
          {
            owner: "monalisa",
            name: "web",
            relativePath: "monalisa/source/web",
            category: "source",
            internal: true,
            language: null,
            updatedAt: null,
            custom: true,
          },
        ],
      }),
      "utf8",
    );
  }

  test("preview opens with correct entries for a mixed new/update selection", async () => {
    const root = tempWorkspace();
    writePreviewFixture(root);
    const h = makeStore(root, [repo("monalisa", "api"), repo("monalisa", "web")]);
    await h.store.init();
    h.store.toggleCurrent();
    h.store.moveCursor(1);
    h.store.toggleCurrent();
    expect(h.snapshot().selected.size).toBe(2);
    await h.store.openStartPreview();
    const modal = h.snapshot().modal;
    expect(modal !== null && modal.type === "preview").toBe(true);
    if (modal !== null && modal.type === "preview") {
      expect(modal.entries).toEqual([
        { key: "monalisa/api", relPath: "monalisa/source/api", exists: false },
        {
          key: "monalisa/web",
          relPath: "monalisa/source/web",
          exists: true,
          custom: true,
        },
      ]);
    }
    expect(h.syncs.length).toBe(0);
  });

  test("confirm closes the preview and runs the sync", async () => {
    const root = tempWorkspace();
    writePreviewFixture(root);
    const h = makeStore(root, [repo("monalisa", "api"), repo("monalisa", "web")]);
    await h.store.init();
    h.store.selectAll();
    await h.store.openStartPreview();
    await h.store.confirmStartPreview();
    expect(h.snapshot().modal).toBeNull();
    expect(h.syncs.length).toBe(1);
    expect(h.syncs[0]!.keys).toEqual(["monalisa/api", "monalisa/web"]);
  });

  test("cancel closes the preview and runs nothing", async () => {
    const root = tempWorkspace();
    writePreviewFixture(root);
    const h = makeStore(root, [repo("monalisa", "api")]);
    await h.store.init();
    h.store.toggleCurrent();
    await h.store.openStartPreview();
    h.store.closeModal();
    expect(h.snapshot().modal).toBeNull();
    expect(h.syncs.length).toBe(0);
    expect(h.snapshot().statuses.length).toBe(0);
  });

  test("preview with an empty selection records the failed status and opens nothing", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("s", "a")]);
    await h.store.init();
    await h.store.openStartPreview();
    expect(h.snapshot().modal).toBeNull();
    expect(h.syncs.length).toBe(0);
    expect(h.snapshot().statuses[0]!.phase).toBe("FAILED");
    expect(h.snapshot().statuses[0]!.message).toBe("nothing selected");
  });

  test("preview reflects preset changed before opening preview", async () => {
    const root = tempWorkspace();
    writePreviewFixture(root);
    const h = makeStore(root, [repo("monalisa", "api")]);
    await h.store.init();
    expect(h.snapshot().preset).toBe("categorized");
    h.store.cyclePreset();
    expect(h.snapshot().preset).toBe("flat-by-owner");

    h.store.toggleCurrent();
    await h.store.openStartPreview();

    const modal = h.snapshot().modal;
    expect(modal !== null && modal.type === "preview").toBe(true);
    if (modal !== null && modal.type === "preview") {
      expect(modal.entries).toEqual([
        { key: "monalisa/api", relPath: "monalisa/api", exists: false },
      ]);
    }

    await h.store.confirmStartPreview();
    expect(h.syncs.length).toBe(1);
    expect(h.syncs[0]!.preset).toBe("flat-by-owner");
  });

  test("cycling preset while preview is open updates entries live", async () => {
    const root = tempWorkspace();
    writePreviewFixture(root);
    const h = makeStore(root, [repo("monalisa", "api", { language: "TypeScript" })]);
    await h.store.init();
    expect(h.snapshot().preset).toBe("categorized");

    h.store.toggleCurrent();
    await h.store.openStartPreview();

    let modal = h.snapshot().modal;
    expect(modal !== null && modal.type === "preview").toBe(true);
    if (modal !== null && modal.type === "preview") {
      expect(modal.entries[0]!.relPath).toBe("monalisa/source/api");
    }

    // Cycle to flat-by-owner
    await h.store.cyclePreset();
    expect(h.snapshot().preset).toBe("flat-by-owner");
    modal = h.snapshot().modal;
    if (modal !== null && modal.type === "preview") {
      expect(modal.entries[0]!.relPath).toBe("monalisa/api");
    }

    // Cycle to topic-focused
    await h.store.cyclePreset();
    expect(h.snapshot().preset).toBe("topic-focused");
    modal = h.snapshot().modal;
    if (modal !== null && modal.type === "preview") {
      expect(modal.entries[0]!.relPath).toBe("monalisa/TypeScript/api");
    }
  });
});

describe("root modal", () => {
  test("shows the effective root labeled, saves an override and re-resolves", async () => {
    const root = tempWorkspace();
    const target = realpathSync(mkdtempSync(path.join(tmpdir(), "repotruck-root-target-")));
    tempRoots.push(target);
    const h = makeStore(root, []);
    await h.store.init();
    await h.store.openRootModal();
    let modal = h.snapshot().modal;
    expect(modal !== null && modal.type === "root").toBe(true);
    if (modal !== null && modal.type === "root") {
      expect(modal.fromOverride).toBe(false);
      expect(modal.effective).toBe(osDefaultRoot(process.env));
    }
    const ok = await h.store.submitRoot(target);
    expect(ok).toBe(true);
    expect(h.snapshot().modal).toBeNull();
    expect(h.snapshot().root).toBe(target);
    const saved = JSON.parse(
      readFileSync(path.join(isolatedConfigDir, "settings.json"), "utf8"),
    ) as { defaultRoot?: string };
    expect(saved.defaultRoot).toBe(path.resolve(target));
    await h.store.openRootModal();
    modal = h.snapshot().modal;
    if (modal !== null && modal.type === "root") {
      expect(modal.fromOverride).toBe(true);
      expect(modal.effective).toBe(path.resolve(target));
    }
  });

  test("invalid input keeps the modal open with an English error", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    await h.store.openRootModal();
    const ok = await h.store.submitRoot("relative/path");
    expect(ok).toBe(false);
    expect(h.snapshot().modalError).toContain("absolute");
    expect(h.snapshot().modal).not.toBeNull();
    const empty = await h.store.submitRoot("   ");
    expect(empty).toBe(false);
    expect(h.snapshot().modalError).toContain("path is required");
  });
});

describe("sidebar rows", () => {
  test("buildSidebarRows covers personal, orgs, preset and filters in order", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    const rows = buildSidebarRows(h.snapshot());
    expect(rows[0]!.kind).toBe("personal");
    expect(rows[1]!.kind).toBe("org");
    expect(rows[2]!.kind).toBe("preset");
    expect(rows[3]!.kind).toBe("filter");
    expect(rows.length).toBe(6);
  });

  test("activateSidebarRow toggles the org under the cursor", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    h.store.moveSidebarCursor(1);
    h.store.activateSidebarRow();
    await tick();
    expect(h.snapshot().selectedOrgs.has("acme-org")).toBe(true);
    h.store.activateSidebarRow();
    await tick();
    expect(h.snapshot().selectedOrgs.has("acme-org")).toBe(false);
  });

  test("activateSidebarRow flips the last filter row", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    h.store.moveSidebarCursor(buildSidebarRows(h.snapshot()).length - 1);
    h.store.activateSidebarRow();
    expect(h.snapshot().filters.archived).toBe(false);
  });

  test("activateSidebarRow cycles the preset row", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    h.store.moveSidebarCursor(2);
    h.store.activateSidebarRow();
    expect(h.snapshot().preset).toBe("flat-by-owner");
  });
});

describe("focus and snapshot immutability", () => {
  test("cycleFocus walks list to status to sidebar and wraps", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    expect(h.snapshot().focus).toBe("list");
    h.store.cycleFocus();
    expect(h.snapshot().focus).toBe("status");
    h.store.cycleFocus();
    expect(h.snapshot().focus).toBe("sidebar");
    h.store.cycleFocus();
    expect(h.snapshot().focus).toBe("list");
  });

  test("snapshots are immutable: changed collections are recreated", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("s", "a")]);
    await h.store.init();
    const before = h.snapshot();
    h.store.toggleCurrent();
    const after = h.snapshot();
    expect(before).not.toBe(after);
    expect(before.selected).not.toBe(after.selected);
    h.store.toggleCurrent();
    await h.store.start();
    const withStatus = h.snapshot();
    expect(withStatus.statuses).not.toBe(after.statuses);
    expect(withStatus.statuses.length).toBe(1);
  });
});

describe("update toast", () => {
  function makeToastStore(
    updaterResult: { latestVersion: string | null; updateAvailable: boolean },
    persisted: { versions: string[] },
  ): { store: Store; state: () => StoreSnapshot } {
    const root = tempWorkspace();
    const store = new Store(root, {
      auth: async () => ({ token: "t", method: "gh-cli" }),
      github: fakeGithub([], makeFakeGithubCalls()),
      updater: async () => ({
        currentVersion: "0.1.0",
        latestVersion: updaterResult.latestVersion,
        updateAvailable: updaterResult.updateAvailable,
      }),
      readUpdateStateFn: async () => ({
        lastCheck: null,
        latestVersion: null,
        dismissedVersion: null,
      }),
      persistDismissedVersion: async (version: string) => {
        persisted.versions.push(version);
      },
    });
    return { store, state: () => store.getSnapshot() };
  }

  test("a newer version raises the toast", async () => {
    const persisted: { versions: string[] } = { versions: [] };
    const h = makeToastStore({ latestVersion: "9.9.9", updateAvailable: true }, persisted);
    await h.store.init();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.state().updateToast).toEqual({ version: "9.9.9" });
  });

  test("no update available means no toast", async () => {
    const persisted: { versions: string[] } = { versions: [] };
    const h = makeToastStore({ latestVersion: null, updateAvailable: false }, persisted);
    await h.store.init();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.state().updateToast).toBeNull();
  });

  test("x dismisses, persists once per version, and stays gone on re-check", async () => {
    const persisted: { versions: string[] } = { versions: [] };
    const h = makeToastStore({ latestVersion: "9.9.9", updateAvailable: true }, persisted);
    await h.store.init();
    await new Promise((resolve) => setTimeout(resolve, 10));
    h.store.dismissUpdateToast();
    expect(h.state().updateToast).toBeNull();
    expect(persisted.versions).toEqual(["9.9.9"]);
    h.store.dismissUpdateToast();
    expect(persisted.versions).toEqual(["9.9.9"]);
    await h.store.runUpdateCheck();
    expect(h.state().updateToast).toBeNull();
  });
});

describe("open and alias modals", () => {
  function makeLauncherStore(root: string, apps: AppEntry[]) {
    const spawnCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const store = new Store(root, {
      auth: async () => ({ token: "t", method: "gh-cli" }),
      github: fakeGithub([], makeFakeGithubCalls()),
      detectAppsFn: async () => apps,
      resolveAppFn: async (name: string) => {
        const found = apps.find((app) => app.name === name);
        if (found === undefined) return null;
        return { name: found.name, command: found.command, args: found.args ?? [] };
      },
      spawnImpl: async (request) => {
        spawnCalls.push(request);
        return 0;
      },
    });
    return { store, spawnCalls, state: () => store.getSnapshot() };
  }

  const repoEntry = {
    owner: "acme",
    name: "api",
    relativePath: "acme/source/api",
    category: "source" as const,
    internal: true,
    language: null,
    updatedAt: null,
  };

  test("open modal populates detected apps and tracks the repo key", async () => {
    const root = tempWorkspace();
    mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
    const config = {
      version: 1,
      root,
      preset: "categorized" as const,
      lastSync: null,
      repos: [repoEntry],
    };
    writeFileSync(path.join(root, "repotruck.json"), JSON.stringify(config), "utf8");
    const h = makeLauncherStore(root, [{ name: "marker", command: "node", args: ["-e", "ok"] }]);
    await h.store.init();
    await h.store.openOpenModal("acme/api");
    const modal = h.state().modal;
    expect(modal).not.toBeNull();
    expect(modal!.type).toBe("open");
    if (modal!.type === "open") {
      expect(modal!.key).toBe("acme/api");
      expect(modal!.apps!.length).toBe(1);
      expect(modal!.apps![0]!.name).toBe("marker");
    }
  });

  test("open modal keeps apps pending (null) until detection resolves", async () => {
    const root = tempWorkspace();
    let release: (apps: AppEntry[]) => void = () => {};
    const gate = new Promise<AppEntry[]>((resolve) => {
      release = resolve;
    });
    const store = new Store(root, {
      auth: async () => ({ token: "t", method: "gh-cli" }),
      github: fakeGithub([], makeFakeGithubCalls()),
      detectAppsFn: () => gate,
    });
    await store.init();
    const opening = store.openOpenModal("acme/api");
    let modal = store.getSnapshot().modal;
    expect(modal!.type).toBe("open");
    if (modal!.type === "open") {
      expect(modal!.apps).toBeNull();
    }
    release([{ name: "marker", command: "node", args: [] }]);
    await opening;
    modal = store.getSnapshot().modal;
    if (modal !== null && modal.type === "open") {
      expect(modal.apps!.length).toBe(1);
    } else {
      throw new Error("open modal disappeared after detection");
    }
  });

  test("closing the open modal before detection finishes does not resurrect it", async () => {
    const root = tempWorkspace();
    let release: (apps: AppEntry[]) => void = () => {};
    const gate = new Promise<AppEntry[]>((resolve) => {
      release = resolve;
    });
    const store = new Store(root, {
      auth: async () => ({ token: "t", method: "gh-cli" }),
      github: fakeGithub([], makeFakeGithubCalls()),
      detectAppsFn: () => gate,
    });
    await store.init();
    const opening = store.openOpenModal("acme/api");
    store.closeModal();
    release([{ name: "marker", command: "node", args: [] }]);
    await opening;
    expect(store.getSnapshot().modal).toBeNull();
  });

  test("runOpenApp spawns the resolved app inside the repo dir", async () => {
    const root = tempWorkspace();
    mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
    const config = {
      version: 1,
      root,
      preset: "categorized" as const,
      lastSync: null,
      repos: [repoEntry],
    };
    writeFileSync(path.join(root, "repotruck.json"), JSON.stringify(config), "utf8");
    const h = makeLauncherStore(root, [{ name: "marker", command: "node", args: ["-e", "ok"] }]);
    await h.store.init();
    await h.store.openOpenModal("acme/api");
    const code = await h.store.runOpenApp("marker");
    expect(code).toBe(0);
    expect(h.spawnCalls.length).toBe(1);
    expect(h.spawnCalls[0]!.cwd).toBe(path.join(root, "acme", "source", "api"));
    expect(h.spawnCalls[0]!.command).toBe("node");
  });

  test("alias modal pre-fills the current alias and submitAlias persists it", async () => {
    const root = tempWorkspace();
    mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
    const config = {
      version: 1,
      root,
      preset: "categorized" as const,
      lastSync: null,
      repos: [repoEntry],
      aliases: { api: "acme/source/api" },
    };
    writeFileSync(path.join(root, "repotruck.json"), JSON.stringify(config), "utf8");
    const h = makeLauncherStore(root, []);
    await h.store.init();
    await h.store.openAliasModal("acme/api");
    const modal = h.state().modal;
    expect(modal!.type).toBe("alias");
    if (modal!.type === "alias") {
      expect(modal!.prefill).toBe("api");
    }
    const ok = await h.store.submitAlias("acme/api", "api");
    expect(ok).toBe(true);
    expect(h.state().modal).toBeNull();
    const saved = readCentralEntry(root) as { aliases?: Record<string, string> } | null;
    expect(saved).not.toBeNull();
    expect(saved!.aliases).toEqual({ api: "acme/source/api" });
  });

  test("submitAlias writes the AGENTS.md alias badge and rejects collisions", async () => {
    const root = tempWorkspace();
    mkdirSync(path.join(root, "acme", "source", "api"), { recursive: true });
    mkdirSync(path.join(root, "acme", "source", "web"), { recursive: true });
    const config = {
      version: 1,
      root,
      preset: "categorized" as const,
      lastSync: null,
      repos: [
        repoEntry,
        {
          owner: "acme",
          name: "web",
          relativePath: "acme/source/web",
          category: "source" as const,
          internal: true,
          language: null,
          updatedAt: null,
        },
      ],
    };
    writeFileSync(path.join(root, "repotruck.json"), JSON.stringify(config), "utf8");
    const h = makeLauncherStore(root, []);
    await h.store.init();
    const ok = await h.store.submitAlias("acme/api", "api");
    expect(ok).toBe(true);
    const agents = readFileSync(path.join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("(alias: api)");
    const collision = await h.store.submitAlias("acme/web", "api");
    expect(collision).toBe(false);
    expect(h.state().modalError).toContain("already used");
  });
});

describe("searchRepos", () => {
  test("null and empty terms leave the list untouched", () => {
    const repos = [repo("acme", "api"), repo("octocat", "hello")];
    expect(searchRepos(repos, null)).toHaveLength(2);
    expect(searchRepos(repos, "")).toHaveLength(2);
  });

  test("matches owner or name case-insensitively as a substring", () => {
    const repos = [repo("acme", "api"), repo("ACME", "web"), repo("octocat", "HelloWorld")];
    expect(searchRepos(repos, "acme").map((item) => item.owner)).toEqual(["acme", "ACME"]);
    expect(searchRepos(repos, "hello").map((item) => item.name)).toEqual(["HelloWorld"]);
    expect(searchRepos(repos, "api")).toHaveLength(1);
    expect(searchRepos(repos, "zzz")).toHaveLength(0);
  });
});

describe("sortRepos", () => {
  const repos = [
    repo("zeta", "beta", { language: "Zig" }),
    repo("acme", "Zulu", { language: null }),
    repo("mid", "alpha", { language: "Go" }),
  ];

  test("default keeps the input order", () => {
    expect(sortRepos(repos, "default").map((item) => item.name)).toEqual(["beta", "Zulu", "alpha"]);
  });

  test("name sorts case-insensitively with owner/name tie-break", () => {
    const tied = [repo("zeta", "same"), repo("acme", "same")];
    expect(sortRepos(tied, "name").map((item) => item.owner)).toEqual(["acme", "zeta"]);
    expect(sortRepos(repos, "name").map((item) => item.name)).toEqual(["alpha", "beta", "Zulu"]);
  });

  test("language sorts values alphabetically with null last", () => {
    expect(sortRepos(repos, "language").map((item) => item.language)).toEqual(["Go", "Zig", null]);
  });

  test("updatedAt sorts newest first with null last", () => {
    const withDates: RepoInfo[] = [
      { ...repo("a", "old"), updatedAt: "2020-01-01T00:00:00.000Z" },
      { ...repo("b", "new"), updatedAt: "2026-10-01T00:00:00.000Z" },
      { ...repo("c", "never"), updatedAt: null },
    ];
    expect(sortRepos(withDates, "updatedAt").map((item) => item.name)).toEqual([
      "new",
      "old",
      "never",
    ]);
  });

  test("descending reverses the ascending order for every key", () => {
    expect(sortRepos(repos, "name", true).map((item) => item.name)).toEqual([
      "Zulu",
      "beta",
      "alpha",
    ]);
    expect(sortRepos(repos, "default", true).map((item) => item.name)).toEqual([
      "alpha",
      "Zulu",
      "beta",
    ]);
    expect(sortRepos(repos, "language", true).map((item) => item.language)).toEqual([
      null,
      "Zig",
      "Go",
    ]);
    expect(sortRepos(repos, "name", false).map((item) => item.name)).toEqual([
      "alpha",
      "beta",
      "Zulu",
    ]);
  });
});

describe("store search, sort and selection semantics", () => {
  test("applySearch narrows the list, resets the cursor and clears on empty", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("acme", "api"), repo("octocat", "hello")]);
    await h.store.init();
    h.store.moveCursor(1);
    h.store.applySearch("hello");
    let snap = h.snapshot();
    expect(snap.filteredRepos.map((item) => item.name)).toEqual(["hello"]);
    expect(snap.cursor).toBe(0);
    expect(snap.search).toBe("hello");
    h.store.applySearch("");
    snap = h.snapshot();
    expect(snap.filteredRepos).toHaveLength(2);
    expect(snap.search).toBeNull();
  });

  test("cycleSort rotates the four keys and resets the cursor", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("acme", "api")]);
    await h.store.init();
    expect(h.snapshot().sortKey).toBe("default");
    h.store.moveCursor(0);
    for (const expected of ["name", "language", "updatedAt", "default"] as const) {
      h.store.cycleSort();
      expect(h.snapshot().sortKey).toBe(expected);
    }
  });

  test("toggleSortDirection reverses the visible order and resets the cursor", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("acme", "zeta"), repo("acme", "alpha")]);
    await h.store.init();
    h.store.cycleSort();
    expect(h.snapshot().filteredRepos.map((item) => item.name)).toEqual(["alpha", "zeta"]);
    h.store.moveCursor(1);
    h.store.toggleSortDirection();
    const snap = h.snapshot();
    expect(snap.sortDescending).toBe(true);
    expect(snap.cursor).toBe(0);
    expect(snap.filteredRepos.map((item) => item.name)).toEqual(["zeta", "alpha"]);
    h.store.toggleSortDirection();
    expect(h.snapshot().sortDescending).toBe(false);
    expect(h.snapshot().filteredRepos.map((item) => item.name)).toEqual(["alpha", "zeta"]);
  });

  test("search and sort never change selected-set membership (T3')", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("acme", "api"), repo("acme", "web")]);
    await h.store.init();
    h.store.selectAll();
    expect(h.snapshot().selected.size).toBe(2);
    h.store.applySearch("api");
    expect(h.snapshot().filteredRepos).toHaveLength(1);
    expect(h.snapshot().selected.size).toBe(2);
    h.store.clearSearch();
    expect(h.snapshot().selected.size).toBe(2);
  });

  test("clearSearch is a no-op without an active search", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("acme", "api")]);
    await h.store.init();
    h.store.clearSearch();
    expect(h.snapshot().search).toBeNull();
  });
});

describe("store lifecycle actions", () => {
  test("untrackRepo calls the injected forget and reports a DONE status", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("acme", "api")]);
    await h.store.init();
    await h.store.untrackRepo("acme/api");
    expect(h.forgets).toEqual(["acme/api"]);
    const statuses = h.snapshot().statuses;
    expect(statuses[statuses.length - 1]!.phase).toBe("DONE");
    expect(statuses[statuses.length - 1]!.message).toContain("forgot acme/api");
  });

  test("openUntrackConfirm opens the confirm modal; confirmUntrack closes then forgets", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("acme", "api")]);
    await h.store.init();
    h.store.openUntrackConfirm("acme/api");
    expect(h.snapshot().modal).toEqual({ type: "confirmUntrack", key: "acme/api" });
    expect(h.forgets).toEqual([]);
    await h.store.confirmUntrack("acme/api");
    expect(h.snapshot().modal).toBeNull();
    expect(h.forgets).toEqual(["acme/api"]);
    const statuses = h.snapshot().statuses;
    expect(statuses[statuses.length - 1]!.phase).toBe("DONE");
  });

  test("openDeleteConfirm needs a tracked entry; confirmDelete runs with yes", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("acme", "api")]);
    await h.store.init();
    await h.store.openDeleteConfirm("acme/missing");
    expect(h.snapshot().modal).toBeNull();
    const last = h.snapshot().statuses[h.snapshot().statuses.length - 1]!;
    expect(last.phase).toBe("FAILED");
    expect(last.message).toContain("not tracked by repotruck");
    await h.store.openDeleteConfirm("acme/api");
    const modal = h.snapshot().modal;
    expect(modal?.type).toBe("confirmDelete");
    expect(modal?.type === "confirmDelete" && modal.absPath).toContain("acme");
    const ok = await h.store.confirmDelete("acme/api");
    expect(ok).toBe(true);
    expect(h.deletes).toEqual([{ key: "acme/api", yes: true }]);
  });

  test("reorganize modal previews dry-run first and applies on confirm", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("acme", "api")]);
    await h.store.init();
    await h.store.openReorganizeModal();
    await tick();
    let modal = h.snapshot().modal;
    expect(modal?.type).toBe("reorganize");
    expect(modal?.type === "reorganize" && modal.keepCustom).toBe(true);
    expect(h.reorganizes).toEqual([{ preset: "categorized", dryRun: true, keepCustom: true }]);
    modal = h.snapshot().modal;
    expect(modal?.type === "reorganize" && modal.preview?.moved).toHaveLength(1);
    await h.store.toggleReorganizeKeepCustom();
    await tick();
    expect(h.reorganizes[h.reorganizes.length - 1]).toEqual({
      preset: "categorized",
      dryRun: true,
      keepCustom: false,
    });
    await h.store.confirmReorganize();
    expect(h.reorganizes[h.reorganizes.length - 1]).toEqual({
      preset: "categorized",
      dryRun: undefined,
      keepCustom: false,
    });
    const statuses = h.snapshot().statuses;
    expect(statuses[statuses.length - 1]!.phase).toBe("DONE");
  });

  test("removeWorkspaceEntry drops the registry entry and refreshes the list", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, []);
    await h.store.init();
    const before = h.listedWorkspaces;
    await h.store.removeWorkspaceEntry("C:\\gone\\workspace");
    expect(h.removedWorkspaces).toEqual(["C:\\gone\\workspace"]);
    expect(h.listedWorkspaces).toBeGreaterThan(before);
  });

  test("presetTargetFor keeps personal internal and prefixes org repos with community", async () => {
    const root = tempWorkspace("flat-by-owner");
    const h = makeStore(root, []);
    await h.store.init();
    expect(h.store.presetTargetFor("api")).toBe("monalisa/api");
    expect(h.store.presetTargetFor("api", "acme-org")).toBe("community/acme-org/api");
  });
});

function makeUndoableWorkspace(prefix: string): { root: string; repoDir: string } {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  tempRoots.push(root);
  const repoDir = path.join(root, "acme", "source", "api");
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(path.join(repoDir, "hello.txt"), "v1", "utf8");
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
    }),
    "utf8",
  );
  return { root, repoDir };
}

describe("undo (z)", () => {
  test("undoing a dashboard delete restores the directory and the inventory entry", async () => {
    const { root, repoDir } = makeUndoableWorkspace("rt-undo-del-");
    const store = new Store(root, {
      auth: async () => ({ token: "t", method: "gh-cli" }),
      github: fakeGithub([repo("monalisa", "api")], makeFakeGithubCalls()),
      deleteRepo: ((r: string, config: never, ref: string, options: { yes?: boolean }) =>
        deleteRepository(r, config, ref, { ...options, trash: true })) as unknown as NonNullable<
        StoreDeps["deleteRepo"]
      >,
    });
    await store.init();
    const okDelete = await store.confirmDelete("acme/api");
    expect(okDelete).toBe(true);
    expect(store.getSnapshot().canUndo).toBe(true);
    expect(existsSync(repoDir)).toBe(false);
    await store.undoLast();
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(existsSync(repoDir)).toBe(true);
    expect(readFileSync(path.join(repoDir, "hello.txt"), "utf8")).toBe("v1");
    const restored = await loadWorkspace(root);
    expect(restored.repos.length).toBe(1);
    expect(restored.repos[0]!.relativePath).toBe("acme/source/api");
  });

  test("undo with an empty stack reports and does nothing", async () => {
    const root = tempWorkspace();
    const h = makeStore(root);
    await h.store.init();
    await h.store.undoLast();
    const last = h.snapshot().statuses.at(-1);
    expect(last?.message).toBe("nothing to undo");
  });
});

describe("mouse mapping", () => {
  test("sidebarRowIndexForY maps coordinates to sidebar rows accurately", () => {
    // With 0 orgs: 0=SCOPE, 1=Personal(0), 2=PRESET, 3=Preset(1), 4=FILTERS, 5=Active(2), 6=Forks(3), 7=Archived(4)
    expect(sidebarRowIndexForY(-1, 0)).toBeNull();
    expect(sidebarRowIndexForY(0, 0)).toBeNull();
    expect(sidebarRowIndexForY(1, 0)).toBe(0);
    expect(sidebarRowIndexForY(2, 0)).toBeNull();
    expect(sidebarRowIndexForY(3, 0)).toBe(1);
    expect(sidebarRowIndexForY(4, 0)).toBeNull();
    expect(sidebarRowIndexForY(5, 0)).toBe(2);
    expect(sidebarRowIndexForY(6, 0)).toBe(3);
    expect(sidebarRowIndexForY(7, 0)).toBe(4);
    expect(sidebarRowIndexForY(8, 0)).toBeNull();

    // With 1 org: 1=Personal(0), 2=Org1(1), 3=PRESET, 4=Preset(2), 5=FILTERS, 6=Active(3), 7=Forks(4), 8=Archived(5)
    expect(sidebarRowIndexForY(1, 1)).toBe(0);
    expect(sidebarRowIndexForY(2, 1)).toBe(1);
    expect(sidebarRowIndexForY(3, 1)).toBeNull();
    expect(sidebarRowIndexForY(4, 1)).toBe(2);
    expect(sidebarRowIndexForY(5, 1)).toBeNull();
    expect(sidebarRowIndexForY(6, 1)).toBe(3);
    expect(sidebarRowIndexForY(7, 1)).toBe(4);
    expect(sidebarRowIndexForY(8, 1)).toBe(5);
    expect(sidebarRowIndexForY(9, 1)).toBeNull();
  });

  test("wheel scrolls the list and a click maps to the row under the cursor", async () => {
    const root = tempWorkspace();
    const many = Array.from({ length: 12 }, (_, i) => repo("monalisa", `repo-${i}`));
    const h = makeStore(root, many);
    await h.store.init();
    const store = h.store;
    store.setCursor(0);
    store.handleMouse({ button: 5, x: 60, y: 10 }, 120, 40);
    expect(store.getSnapshot().cursor).toBe(3);
    store.handleMouse({ button: 4, x: 60, y: 10 }, 120, 40);
    expect(store.getSnapshot().cursor).toBe(0);
    // Clicking the fifth visible list row (header is 3 rows, y is 1-based).
    store.handleMouse({ button: 0, x: 60, y: 8 }, 120, 40);
    expect(store.getSnapshot().cursor).toBe(4);
    expect(store.getSnapshot().focus).toBe("list");
    // Side-pane clicks move focus without changing the cursor.
    store.handleMouse({ button: 0, x: 5, y: 8 }, 120, 40);
    expect(store.getSnapshot().focus).toBe("sidebar");
    store.handleMouse({ button: 0, x: 110, y: 8 }, 120, 40);
    expect(store.getSnapshot().focus).toBe("status");
  });

  test("wheel scrolls sidebar and status panel independently", async () => {
    const root = tempWorkspace();
    const many = Array.from({ length: 6 }, (_, i) => repo("monalisa", `repo-${i}`));
    const h = makeStore(root, many);
    await h.store.init();
    const store = h.store;

    // Wheel over sidebar
    expect(store.getSnapshot().sidebarCursor).toBe(0);
    store.handleMouse({ button: 5, x: 10, y: 10 }, 120, 40);
    expect(store.getSnapshot().focus).toBe("sidebar");
    expect(store.getSnapshot().sidebarCursor).toBe(1);
    store.handleMouse({ button: 4, x: 10, y: 10 }, 120, 40);
    expect(store.getSnapshot().sidebarCursor).toBe(0);

    // Wheel over status panel
    for (let i = 0; i < 20; i++) {
      store.pushStatus("DONE", `key-${i}`, "ok");
    }
    expect(store.getSnapshot().statusScroll).toBe(0);
    store.handleMouse({ button: 4, x: 110, y: 10 }, 120, 40);
    expect(store.getSnapshot().focus).toBe("status");
    expect(store.getSnapshot().statusScroll).toBe(3);
    store.handleMouse({ button: 5, x: 110, y: 10 }, 120, 40);
    expect(store.getSnapshot().statusScroll).toBe(0);
  });

  test("clicking checkbox in repo list toggles selection without losing cursor position", async () => {
    const root = tempWorkspace();
    const items = [repo("monalisa", "alpha"), repo("monalisa", "beta")];
    const h = makeStore(root, items);
    await h.store.init();
    const store = h.store;

    expect(store.getSnapshot().selected.has("monalisa/alpha")).toBe(false);
    // sidebarWidth(120) = 24. A click at x=28 is inside the checkbox (relX = 4 <= 6)
    store.handleMouse({ button: 0, x: 28, y: 4 }, 120, 40);
    expect(store.getSnapshot().selected.has("monalisa/alpha")).toBe(true);

    // Clicking again toggles it off
    store.handleMouse({ button: 0, x: 28, y: 4 }, 120, 40);
    expect(store.getSnapshot().selected.has("monalisa/alpha")).toBe(false);
  });

  test("clicking active repo row toggles selection", async () => {
    const root = tempWorkspace();
    const items = [repo("monalisa", "alpha")];
    const h = makeStore(root, items);
    await h.store.init();
    const store = h.store;

    expect(store.getSnapshot().cursor).toBe(0);
    expect(store.getSnapshot().selected.has("monalisa/alpha")).toBe(false);
    // Click on active row at text (x=60)
    store.handleMouse({ button: 0, x: 60, y: 4 }, 120, 40);
    expect(store.getSnapshot().selected.has("monalisa/alpha")).toBe(true);
  });

  test("double-clicking a repo row opens DetailModal", async () => {
    const root = tempWorkspace();
    const items = [repo("monalisa", "alpha")];
    const h = makeStore(root, items);
    await h.store.init();
    const store = h.store;

    expect(store.getSnapshot().modal).toBeNull();
    // First click
    store.handleMouse({ button: 0, x: 60, y: 4 }, 120, 40);
    // Second click in rapid succession
    store.handleMouse({ button: 0, x: 60, y: 4 }, 120, 40);
    expect(store.getSnapshot().modal?.type).toBe("detail");
  });

  test("right-clicking a repo row opens DetailModal", async () => {
    const root = tempWorkspace();
    const items = [repo("monalisa", "alpha")];
    const h = makeStore(root, items);
    await h.store.init();
    const store = h.store;

    expect(store.getSnapshot().modal).toBeNull();
    store.handleMouse({ button: 2, x: 60, y: 4 }, 120, 40);
    expect(store.getSnapshot().modal?.type).toBe("detail");
  });

  test("header clicks cycle preset or open default root modal", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("monalisa", "alpha")]);
    await h.store.init();
    const store = h.store;

    const initialPreset = store.getSnapshot().preset;
    // Click near preset in header (x=45, y=1)
    store.handleMouse({ button: 0, x: 45, y: 1 }, 120, 40);
    expect(store.getSnapshot().preset).not.toBe(initialPreset);

    // Click near root in header (x=80, y=1)
    store.handleMouse({ button: 0, x: 80, y: 1 }, 120, 40);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.getSnapshot().modal?.type).toBe("root");
  });

  test("footer clicks cycle focus, toggle select, open help, and trigger quit", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("monalisa", "alpha")]);
    await h.store.init();
    const store = h.store;

    // [Tab] Focus at x=10, y=38
    store.handleMouse({ button: 0, x: 10, y: 38 }, 120, 40);
    expect(store.getSnapshot().focus).toBe("status");

    // [Space] Select at x=25, y=38
    expect(store.getSnapshot().selected.has("monalisa/alpha")).toBe(false);
    store.handleMouse({ button: 0, x: 25, y: 38 }, 120, 40);
    expect(store.getSnapshot().selected.has("monalisa/alpha")).toBe(true);

    // [?] Help at x=40, y=38
    expect(store.getSnapshot().modal).toBeNull();
    store.handleMouse({ button: 0, x: 40, y: 38 }, 120, 40);
    expect(store.getSnapshot().modal?.type).toBe("help");
    store.closeModal();

    // [q] Quit at x=55, y=38
    let quitCalled = false;
    store.handleMouse({ button: 0, x: 55, y: 38 }, 120, 40, {
      onQuit: () => {
        quitCalled = true;
      },
    });
    expect(quitCalled).toBe(true);
  });

  test("right-click and backdrop clicks dismiss open modals", async () => {
    const root = tempWorkspace();
    const h = makeStore(root, [repo("monalisa", "alpha")]);
    await h.store.init();
    const store = h.store;

    store.openHelpModal();
    expect(store.getSnapshot().modal?.type).toBe("help");

    // Right-click dismisses
    store.handleMouse({ button: 2, x: 60, y: 20 }, 120, 40);
    expect(store.getSnapshot().modal).toBeNull();

    // Click on footer outside modal dismisses
    store.openHelpModal();
    expect(store.getSnapshot().modal?.type).toBe("help");
    store.handleMouse({ button: 0, x: 60, y: 39 }, 120, 40);
    expect(store.getSnapshot().modal).toBeNull();
  });

  test("clicking update toast dismisses it", async () => {
    const root = tempWorkspace();
    const store = new Store(root, {
      auth: async () => ({ token: "t", method: "gh-cli" }),
      github: fakeGithub([repo("monalisa", "alpha")], makeFakeGithubCalls()),
      updater: async () => ({
        currentVersion: "0.1.0",
        latestVersion: "1.0.0",
        updateAvailable: true,
      }),
      readUpdateStateFn: async () => ({
        lastCheck: null,
        latestVersion: null,
        dismissedVersion: null,
      }),
      persistDismissedVersion: async () => {},
    });
    await store.init();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.getSnapshot().updateToast).toEqual({ version: "1.0.0" });

    // Toast is at height - 6 = 34 to 36
    store.handleMouse({ button: 0, x: 40, y: 35 }, 120, 40);
    expect(store.getSnapshot().updateToast).toBeNull();
  });
});

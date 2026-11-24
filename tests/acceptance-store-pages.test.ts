import { afterEach, describe, expect, test } from "bun:test";
import { Store } from "../src/components/store.ts";
import { storeDeps, workspaceFixture } from "./helpers/hardening.ts";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];
const stores: Store[] = [];
const priorConfigDir = process.env.REPOTRUCK_CONFIG_DIR;

function fixture() {
  const value = workspaceFixture();
  fixtures.push(value);
  process.env.REPOTRUCK_CONFIG_DIR = value.configDir;
  return value;
}

function makeStore(f: ReturnType<typeof fixture>, extra: Parameters<typeof storeDeps>[0] = {}) {
  const value = new Store(f.root, storeDeps(extra));
  stores.push(value);
  return value;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  if (priorConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = priorConfigDir;
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe("acceptance: data page store outcomes", () => {
  test("discover search failure clears loading, preserves selection, and emits a failure status", async () => {
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
        searchRepos: async () => {
          throw new Error("fixture search unavailable");
        },
      }),
    });
    await store.init();
    store.updateDiscoverPage({ query: "fixture", selected: new Set(["sample/selected"]) });
    await store.discoverSearch();
    expect(store.getSnapshot().discoverPage).toMatchObject({ query: "fixture", loading: false });
    expect(store.getSnapshot().discoverPage?.selected.has("sample/selected")).toBe(true);
    expect(store.getSnapshot().statuses.at(-1)).toMatchObject({
      phase: "FAILED",
      message: "fixture search unavailable",
    });
  });

  test("code search service failure returns to idle with a useful status", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f, {
      searchCodeFn: async () => {
        throw new Error("fixture index failed");
      },
    });
    await store.init();
    store.updateCodeSearchForm({ pattern: "needle", mode: "re" });
    await store.runCodeSearchPage();
    expect(store.getSnapshot().codeSearchPage).toMatchObject({ pattern: "needle", loading: false });
    expect(store.getSnapshot().statuses.at(-1)).toMatchObject({
      phase: "FAILED",
      message: "fixture index failed",
    });
  });

  test("sync start rejects an empty selection without leaving the running flag set", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f);
    await store.init();
    store.updateSyncCenter({ scope: "selection" });
    await store.startSyncCenter();
    expect(store.getSnapshot().syncCenter?.running).toBe(false);
    expect(
      store
        .getSnapshot()
        .statuses.some(
          (entry) => entry.phase === "FAILED" && entry.message?.includes("0 repositories"),
        ),
    ).toBe(true);
  });

  test("status refresh failure clears loading and records an actionable failure", async () => {
    const f = fixture();
    await f.save();
    const store = makeStore(f, {
      workspaceStatusFn: async () => {
        throw new Error("fixture status service failed");
      },
    });
    await store.init();
    await store.refreshStatusMatrix(true);
    expect(store.getSnapshot().statusMatrix?.loading).toBe(false);
    expect(store.getSnapshot().statuses.at(-1)).toMatchObject({
      phase: "FAILED",
      message: "fixture status service failed",
    });
  });
});

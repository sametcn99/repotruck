import { afterEach, expect, mock, test } from "bun:test";
import type { StoreDeps } from "../src/components/store/types.ts";
import { Store } from "../src/components/store.ts";
import { readWorkspaceConfig, writeWorkspaceConfig } from "../src/services/workspaceRegistry.ts";
import { storeDeps, waitUntil, workspaceFixture } from "./helpers/hardening.ts";

const fixtures: ReturnType<typeof workspaceFixture>[] = [],
  stores: Store[] = [];
const oldConfig = process.env.REPOTRUCK_CONFIG_DIR;
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  if (oldConfig === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = oldConfig;
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});
async function fixture(overrides: StoreDeps = {}) {
  const f = workspaceFixture();
  fixtures.push(f);
  process.env.REPOTRUCK_CONFIG_DIR = f.configDir;
  await f.save();
  const store = new Store(f.root, storeDeps(overrides));
  stores.push(store);
  await store.init();
  return { f, store };
}

test("[E60] reopening and confirming snapshot restore while it is pending starts only one write", async () => {
  const pending = Promise.withResolvers<{ ok: boolean; message: string }>();
  const restore = mock(async () => pending.promise);
  const { store } = await fixture({ restoreSnapshotFn: restore });
  store.backupRestoreConfirm("one.json");
  store.resolveDialog(true);
  store.backupRestoreConfirm("one.json");
  store.resolveDialog(true);
  const calls = restore.mock.calls.length;
  pending.resolve({ ok: true, message: "restored once" });
  await waitUntil(() => store.getSnapshot().statuses.some((s) => s.message === "restored once"));
  await waitUntil(() => store.getSnapshot().trashPage !== null);
  expect(calls).toBe(1);
});

for (const action of ["archive", "trash-restore"] as const)
  test(`[E60] pending ${action} cannot be started twice`, async () => {
    const pending = Promise.withResolvers<void>();
    let calls = 0;
    const base = storeDeps();
    const { store } = await fixture({
      github: () => ({
        ...base.github!("fixture"),
        archiveRepo: async () => {
          throw new Error("injected archive service should be used");
        },
      }),
      archiveRepoFn: async (_root, config) => {
        calls++;
        await pending.promise;
        return { ok: true, config, message: "archived once" };
      },
      restoreTrashFn: async () => {
        calls++;
        await pending.promise;
        return { ok: true, message: "restored once" };
      },
    });
    const start = () =>
      action === "archive" ? store.confirmArchive("acme/api") : store.trashRestoreEntry("one");
    const first = start();
    await waitUntil(() => calls === 1);
    const second = start();
    pending.resolve();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });

for (const action of ["backup-restore", "trash-restore", "maintenance"] as const)
  for (const fail of [false, true])
    test(`[E61] ${action} late completion after A→B→A is discarded (failure=${fail})`, async () => {
      const pending = Promise.withResolvers<void>(),
        roots: string[] = [];
      const { f, store } = await fixture({
        restoreSnapshotFn: async (root) => {
          roots.push(root);
          await pending.promise;
          return { ok: true, message: "late-A" };
        },
        restoreTrashFn: async (root) => {
          roots.push(root);
          await pending.promise;
          return { ok: true, message: "late-A" };
        },
        maintenanceFn: async (root, _kind, push) => {
          roots.push(root);
          await pending.promise;
          push("DONE", "[maintenance]", "late-A");
        },
      });
      const b = workspaceFixture();
      fixtures.push(b);
      await writeWorkspaceConfig(b.root, b.config, f.env);
      const first =
        action === "backup-restore"
          ? store.restoreBackupSnapshot("one.json")
          : action === "trash-restore"
            ? store.trashRestoreEntry("one")
            : store.runWorkspaceMaintenance("trash-empty");
      await waitUntil(() => roots.length === 1);
      await store.switchWorkspace(b.root);
      await store.switchWorkspace(f.root);
      const before = store.getSnapshot(),
        config = await readWorkspaceConfig(f.root, f.env);
      if (fail) pending.reject(new Error("late-A"));
      else pending.resolve();
      await first;
      expect(roots).toEqual([f.root]);
      expect(store.getSnapshot().statuses).toEqual(before.statuses);
      expect(store.getSnapshot().trashPage).toBe(before.trashPage);
      expect(await readWorkspaceConfig(f.root, f.env)).toEqual(config);
    });

for (const action of ["search", "sync"] as const)
  for (const fail of [false, true])
    test(`[E61] ${action} late result cannot update B (failure=${fail})`, async () => {
      const pending = Promise.withResolvers<void>();
      let started = false;
      const { f, store } = await fixture({
        searchCodeFn: async () => {
          started = true;
          await pending.promise;
          return {
            matches: [],
            index: {
              built: false,
              filesIndexed: 0,
              filesReused: 0,
              filesSkippedUnknown: 0,
              filesSkippedLarge: 0,
              symbols: 0,
              durationMs: 0,
            },
          };
        },
        sync: async () => {
          started = true;
          await pending.promise;
          return { done: [], failed: [], skipped: [] };
        },
      });
      const b = workspaceFixture();
      fixtures.push(b);
      await writeWorkspaceConfig(b.root, b.config, f.env);
      store.updateCodeSearchForm({ pattern: "old" });
      store.updateSyncCenter({ scope: "all" });
      const first = action === "search" ? store.runCodeSearchPage() : store.startSyncCenter();
      await waitUntil(() => started);
      await store.switchWorkspace(b.root);
      const before = store.getSnapshot();
      if (fail) pending.reject(new Error("late-A"));
      else pending.resolve();
      await first;
      expect(store.getSnapshot().root).toBe(b.root);
      expect(store.getSnapshot().codeSearchPage).toBe(before.codeSearchPage);
      expect(store.getSnapshot().syncCenter).toBe(before.syncCenter);
      expect(store.getSnapshot().statuses).toEqual(before.statuses);
      expect(store.getSnapshot().activeTaskCount).toBe(0);
    });

test("[E61] remote status captures the initiating GitHub client across a workspace switch", async () => {
  const pending = Promise.withResolvers<void>(),
    clients: number[] = [];
  let nextClient = 0,
    started = false;
  const base = storeDeps();
  const { f, store } = await fixture({
    github: () => {
      const id = ++nextClient;
      return {
        ...base.github!("fixture"),
        getRepoRemoteHealth: async () => {
          clients.push(id);
          return { defaultBranch: "main", openPrs: 0, ciState: "success" as const };
        },
      };
    },
    workspaceStatusFn: async (_root, _config, options) => {
      started = true;
      await pending.promise;
      await options?.github?.getRepoRemoteHealth("acme", "api");
      return { lastSync: null, repos: [] };
    },
  });
  const b = workspaceFixture();
  fixtures.push(b);
  await writeWorkspaceConfig(b.root, b.config, f.env);
  const request = store.refreshStatusMatrix(true);
  await waitUntil(() => started);
  await store.switchWorkspace(b.root);
  pending.resolve();
  await request;
  expect(clients).toEqual([1]);
  expect(store.getSnapshot().statusMatrix).toBeNull();
});

test("[E60] repeated empty-trash starts only one pending maintenance operation", async () => {
  const pending = Promise.withResolvers<void>();
  const maintenance = mock(async () => pending.promise);
  const { store } = await fixture({ maintenanceFn: maintenance });
  const first = store.runWorkspaceMaintenance("trash-empty");
  const second = store.runWorkspaceMaintenance("trash-empty");
  const calls = maintenance.mock.calls.length;
  pending.resolve();
  await Promise.all([first, second]);
  expect(calls).toBe(1);
});

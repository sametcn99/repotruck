import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import { aggregateCoverage, parseCoverage } from "../scripts/lib/coverage.ts";
import { Store } from "../src/components/store.ts";
import { writeWorkspaceSnapshot } from "../src/services/backups.ts";
import type { CodeSearchResult } from "../src/services/codeSearch.ts";
import { GitHubService } from "../src/services/github.ts";
import { deleteRepository } from "../src/services/lifecycle.ts";
import { defaultRunCommandImpl, MAX_CAPTURED_OUTPUT_CHARS } from "../src/services/runner.ts";
import { updateWorkspace } from "../src/services/workspace.ts";
import {
  readWorkspaceConfig,
  restoreWorkspaceSnapshot,
} from "../src/services/workspaceRegistry.ts";
import { inventoryEntry, storeDeps, waitUntil, workspaceFixture } from "./helpers/hardening.ts";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];
const originalConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
function fixture() {
  const f = workspaceFixture();
  fixtures.push(f);
  process.env.REPOTRUCK_CONFIG_DIR = f.configDir;
  return f;
}
afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = originalConfigDir;
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe("artifact regressions", () => {
  test("[E01] symlink parent cannot delete an outside repository or its records", async () => {
    const f = fixture();
    const outside = path.join(f.base, "outside");
    mkdirSync(path.join(outside, "api"), { recursive: true });
    const sentinel = path.join(outside, "api", "keep.txt");
    writeFileSync(sentinel, "outside");
    symlinkSync(
      outside,
      path.join(f.root, "bridge"),
      process.platform === "win32" ? "junction" : "dir",
    );
    f.config.repos = [inventoryEntry("bridge/api")];
    f.config.aliases = { api: "bridge/api" };
    await f.save();
    const result = await deleteRepository(f.root, f.config, "acme/api", { yes: true }, f.env);
    expect(result.ok).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("outside");
    expect((await readWorkspaceConfig(f.root, f.env))?.aliases).toEqual(f.config.aliases);
  });

  test("[E02] confirmed trash age filter preserves the young item; cancel preserves both", async () => {
    const f = fixture();
    await f.save();
    const now = Date.now();
    const young = path.join(f.root, ".repotruck/trash", `acme-young-${now}`);
    const old = path.join(f.root, ".repotruck/trash", `acme-old-${now - 10 * 86400000}`);
    mkdirSync(young, { recursive: true });
    mkdirSync(old);
    const store = new Store(f.root, storeDeps());
    store.trashEmptyConfirm(7);
    store.resolveDialog(false);
    expect(existsSync(young)).toBe(true);
    expect(existsSync(old)).toBe(true);
    store.trashEmptyConfirm(7);
    expect(store.getSnapshot().dialog?.message).toContain("--older-than 7");
    store.resolveDialog(true);
    await waitUntil(() => store.getSnapshot().statuses.some((s) => s.key === "[trash]"));
    expect(existsSync(young)).toBe(true);
    expect(existsSync(old)).toBe(false);
  });

  test("[E03] stop waits for active sync and blocks a duplicate start", async () => {
    const f = fixture();
    await f.save();
    const pending = Promise.withResolvers<{ done: []; failed: []; skipped: [] }>();
    const entered = Promise.withResolvers<void>();
    let calls = 0;
    const store = new Store(
      f.root,
      storeDeps({
        sync: async () => {
          calls++;
          entered.resolve();
          return pending.promise;
        },
      }),
    );
    await store.ensureInit();
    store.updateSyncCenter({ scope: "all" });
    const first = store.startSyncCenter();
    await entered.promise;
    store.stopSyncCenter();
    expect(store.getSnapshot().syncCenter?.running).toBe(true);
    await store.startSyncCenter();
    expect(calls).toBe(1);
    expect(store.getSnapshot().activeTaskCount).toBe(1);
    pending.resolve({ done: [], failed: [], skipped: [] });
    await first;
    expect(store.getSnapshot().activeTaskCount).toBe(0);
    expect(store.getSnapshot().syncCenter?.running).toBe(false);
  });

  test.each([403, 429])("[E04] real Octokit error preserves Retry-After for %s", async (status) => {
    let requests = 0;
    const waits: number[] = [];
    const octokit = new Octokit({
      auth: "fixture",
      log: { debug() {}, info() {}, warn() {}, error() {} },
      request: {
        fetch: async () => {
          requests++;
          return new Response(
            JSON.stringify(
              requests === 1 ? { message: "API rate limit exceeded" } : { login: "fixture" },
            ),
            {
              status: requests === 1 ? status : 200,
              headers: {
                "content-type": "application/json",
                "retry-after": "2",
                "x-ratelimit-remaining": "0",
              },
            },
          );
        },
      },
    });
    const github = new GitHubService("fixture", {
      octokit,
      retry: {
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
    });
    expect(await github.getUserLogin()).toBe("fixture");
    expect(requests).toBe(2);
    expect(waits).toEqual([2000]);
  });

  test("[E05] missing trash and backup restore report FAILED with the service reason", async () => {
    const f = fixture();
    await f.save();
    const store = new Store(f.root, storeDeps());
    await store.trashRestoreEntry("missing");
    expect(store.getSnapshot().statuses.at(-1)?.phase).toBe("FAILED");
    store.backupRestoreConfirm("missing.json");
    store.resolveDialog(true);
    await waitUntil(() => store.getSnapshot().statuses.some((s) => s.key === "[backup]"));
    const status = store
      .getSnapshot()
      .statuses.filter((s) => s.key === "[backup]")
      .at(-1);
    expect(status?.phase).toBe("FAILED");
    expect(status?.message).toContain("snapshot not found");
    expect((await readWorkspaceConfig(f.root, f.env))?.repos.length).toBe(1);
  });

  test("[E06] restored snapshot and AGENTS map agree on repos, preset, alias and pin", async () => {
    const f = fixture();
    f.config.aliases = { api: "acme/source/api" };
    f.config.pinned = ["acme/api"];
    await updateWorkspace(f.root, () => ({ config: f.config, result: undefined }), f.env);
    const saved = await writeWorkspaceSnapshot(f.root, f.config);
    await updateWorkspace(
      f.root,
      (current) => ({
        config: { ...current, repos: [], aliases: {}, pinned: [] },
        result: undefined,
      }),
      f.env,
    );
    expect((await restoreWorkspaceSnapshot(f.root, path.basename(saved), f.env)).ok).toBe(true);
    const restored = await readWorkspaceConfig(f.root, f.env);
    const map = readFileSync(path.join(f.root, "AGENTS.md"), "utf8");
    expect(restored?.aliases).toEqual(f.config.aliases);
    expect(restored?.pinned).toEqual(f.config.pinned);
    expect(map).toContain("acme/api");
    expect(map).toContain("Total repositories: 1");
  });

  test.each([false, true])(
    "[E07] late old completion cannot replace the new search (failure=%s)",
    async (failed) => {
      const f = fixture();
      await f.save();
      const old = Promise.withResolvers<CodeSearchResult>();
      const entered = Promise.withResolvers<void>();
      let calls = 0;
      const response = (name: string) => ({ matches: [{ name }] }) as CodeSearchResult;
      const store = new Store(
        f.root,
        storeDeps({
          searchCodeFn: async () => {
            if (++calls === 1) {
              entered.resolve();
              return old.promise;
            }
            return response("new-result");
          },
        }),
      );
      store.updateCodeSearchForm({ pattern: "old" });
      const first = store.runCodeSearchPage();
      await entered.promise;
      store.updateCodeSearchForm({ pattern: "new" });
      await store.runCodeSearchPage();
      if (failed) old.reject(new Error("old failure"));
      else old.resolve(response("old-result"));
      await first;
      expect(store.getSnapshot().codeSearchPage?.matches[0]?.name).toBe("new-result");
      expect(store.getSnapshot().codeSearchPage?.pattern).toBe("new");
    },
  );

  test.each(["acme/*", "ACME/*", "acme/a?i", "acme/**"])(
    "[E08] Sync Center selects the shared filter set for %s",
    async (pattern) => {
      const f = fixture();
      await f.save();
      let selected: string[] = [];
      const store = new Store(
        f.root,
        storeDeps({
          sync: async (options) => {
            selected = options.repos.map((repo) => `${repo.owner}/${repo.name}`);
            return { done: [], failed: [], skipped: [] };
          },
        }),
      );
      await store.ensureInit();
      store.updateSyncCenter({ scope: "all", include: pattern });
      await store.startSyncCenter();
      expect(selected).toEqual(["acme/api"]);
    },
  );

  test("[E09] coverage rejects empty, unrelated, invalid and incomplete reports", () => {
    const record = (file: string, lf: string, lh = "1") =>
      `SF:${file}\nLF:${lf}\nLH:${lh}\nFNF:1\nFNH:1\nend_of_record\n`;
    expect(() => parseCoverage("")).toThrow("empty");
    expect(() => aggregateCoverage(parseCoverage(record("unrelated.ts", "1")))).toThrow("source");
    for (const value of ["bad", "NaN", "Infinity", "-1", "1.5"])
      expect(() => parseCoverage(record("src/a.ts", value))).toThrow("counter");
    expect(() => parseCoverage(record("src/a.ts", "1", "2"))).toThrow("exceed");
    expect(() =>
      aggregateCoverage(parseCoverage(record("src/a.ts", "1")), ["src/a.ts", "src/missing.ts"]),
    ).toThrow("missing.ts");
  });

  test("[E10] simultaneous same-millisecond snapshots preserve both contents", async () => {
    const f = fixture();
    const now = () => new Date("2026-11-23T12:00:00.000Z");
    const files = await Promise.all([
      writeWorkspaceSnapshot(f.root, f.config, { now }),
      writeWorkspaceSnapshot(f.root, { ...f.config, repos: [] }, { now }),
    ]);
    expect(new Set(files).size).toBe(2);
    expect(files.map((file) => JSON.parse(readFileSync(file, "utf8")).repos.length).sort()).toEqual(
      [0, 1],
    );
  });

  test("[E11] real child preserves split UTF-8 and enforces bounded stdout/stderr", async () => {
    const f = fixture();
    const node = Bun.which("node")!;
    const result = await defaultRunCommandImpl({
      command: node,
      cwd: f.root,
      args: [
        "-e",
        "process.stdout.write(Buffer.from([0xc5]));setTimeout(()=>{process.stdout.write(Buffer.from([0x9f]));process.stderr.write('🚀')},20)",
      ],
    });
    expect(result.stdout).toBe("ş");
    expect(result.stderr).toBe("🚀");
    expect(result.exitCode).toBe(0);
    const large = await defaultRunCommandImpl({
      command: node,
      cwd: f.root,
      args: [
        "-e",
        "process.stdout.write('x'.repeat(500000));process.stderr.write('y'.repeat(500000))",
      ],
    });
    expect(large.stdout.length).toBe(MAX_CAPTURED_OUTPUT_CHARS);
    expect(large.stderr.length).toBe(MAX_CAPTURED_OUTPUT_CHARS);
  });

  test("[E73] about works headlessly without auth, network or workspace", () => {
    const f = fixture();
    for (const arg of ["--about", "about"]) {
      const result = Bun.spawnSync([process.execPath, "src/cli.ts", arg], {
        cwd: path.resolve(import.meta.dir, ".."),
        env: { ...process.env, REPOTRUCK_CONFIG_DIR: f.configDir },
        stdin: "ignore",
      });
      expect(result.exitCode).toBe(0);
      const out = result.stdout.toString();
      expect(out).toContain("Clone, organize and sync");
      expect(out).toContain("https://github.com/sametcn99/repotruck");
      expect(existsSync(path.join(f.configDir, "repotruck.json"))).toBe(false);
    }
  });
});

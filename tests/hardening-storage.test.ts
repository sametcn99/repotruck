import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { writeWorkspaceSnapshot } from "../src/services/backups.ts";
import { writeFileAtomic } from "../src/services/fsUtils.ts";
import {
  readReorganizeJournal,
  reorganizeJournalPath,
  reorganizeWorkspace,
} from "../src/services/reorganizer.ts";
import { loadWorkspace, updateWorkspace } from "../src/services/workspace.ts";
import { withWorkspaceLock, workspaceLockPath } from "../src/services/workspaceLock.ts";
import { agentsRecoveryPath } from "../src/services/workspaceRecovery.ts";
import {
  centralStorePath,
  readWorkspaceConfig,
  restoreWorkspaceSnapshot,
} from "../src/services/workspaceRegistry.ts";
import { inventoryEntry, workspaceFixture } from "./helpers/hardening.ts";

const repo = path.resolve(import.meta.dir, "..");
const fixtures: ReturnType<typeof workspaceFixture>[] = [];
const children: ReturnType<typeof Bun.spawn>[] = [];
function fixture() {
  const f = workspaceFixture();
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill();
    await child.exited;
  }
  for (const f of fixtures.splice(0)) f.cleanup();
});
function child(source: string, configDir: string) {
  const p = Bun.spawn([process.execPath, "-e", source], {
    cwd: repo,
    env: { ...process.env, REPOTRUCK_CONFIG_DIR: configDir },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(p);
  return p;
}
async function ready(p: ReturnType<typeof child>) {
  const reader = (p.stdout as ReadableStream<Uint8Array>).getReader();
  const chunk = await reader.read();
  reader.releaseLock();
  expect(new TextDecoder().decode(chunk.value)).toContain("READY");
}

describe("storage concurrency and recovery", () => {
  test("[E22] two processes mutating different roots in one store preserve both workspaces and every alias", async () => {
    const f = fixture();
    const secondRoot = path.join(f.base, "second");
    mkdirSync(secondRoot);
    const worker = (root: string, prefix: string) =>
      `import {updateWorkspace} from './src/services/workspace.ts'; const root=${JSON.stringify(root)}; for(let i=0;i<8;i++)await updateWorkspace(root,c=>({config:{...c,aliases:{...c.aliases,[${JSON.stringify(prefix)}+i]:'acme/source/api'}},result:undefined}));`;
    const a = child(worker(f.root, "a"), f.configDir),
      b = child(worker(secondRoot, "b"), f.configDir);
    expect(await a.exited).toBe(0);
    expect(await b.exited).toBe(0);
    expect(Object.keys((await readWorkspaceConfig(f.root, f.env))?.aliases ?? {}).length).toBe(8);
    expect(Object.keys((await readWorkspaceConfig(secondRoot, f.env))?.aliases ?? {}).length).toBe(
      8,
    );
  });

  test("[E23] killed lock owner is reclaimed after staleness, with no orphan process", async () => {
    const f = fixture();
    const p = child(
      `import {withWorkspaceLock} from './src/services/workspaceLock.ts'; const keep=setInterval(()=>{},1000); await withWorkspaceLock(async()=>{console.log('READY'); await new Promise(()=>{});},{staleLockMs:100,heartbeatMs:10});clearInterval(keep);`,
      f.configDir,
    );
    await ready(p);
    p.kill(process.platform === "win32" ? "SIGTERM" : "SIGKILL");
    await p.exited;
    const lock = workspaceLockPath({ env: f.env });
    const past = new Date(Date.now() - 1000);
    utimesSync(lock, past, past);
    let ran = false;
    await withWorkspaceLock(
      async () => {
        ran = true;
      },
      { env: f.env, staleLockMs: 100, retryMs: 5, waitMs: 1000 },
    );
    expect(ran).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  test("[E24] a contender's stale observation cannot evict a newly acquired owner", async () => {
    const f = fixture();
    const lock = workspaceLockPath({ env: f.env });
    writeFileSync(lock, "stale legacy owner");
    const past = new Date(0);
    utimesSync(lock, past, past);
    const gate = path.join(f.base, "continue");
    const p = child(
      `import{existsSync}from'node:fs';import{withWorkspaceLock}from'./src/services/workspaceLock.ts';let once=false;try{await withWorkspaceLock(async()=>{throw Error('STOLEN')},{staleLockMs:100,retryMs:5,waitMs:250,afterStaleObservation:async()=>{if(once)return;once=true;console.log('READY');while(!existsSync(${JSON.stringify(gate)}))await Bun.sleep(2)}})}catch(e){console.error(e.message);process.exitCode=e.message.includes('STOLEN')?2:0}`,
      f.configDir,
    );
    await ready(p);
    rmSync(lock);
    await withWorkspaceLock(
      async () => {
        writeFileSync(gate, "continue");
        expect(await p.exited).toBe(0);
        expect(await new Response(p.stderr as ReadableStream).text()).toContain(
          "another repotruck process holds",
        );
        expect(existsSync(lock)).toBe(true);
      },
      { env: f.env, staleLockMs: 100, heartbeatMs: 10 },
    );
  });

  test.each(["write", "rename"])(
    "[E25] atomic %s failure preserves complete old bytes and closes/cleans temporary state",
    async (stage) => {
      const f = fixture();
      const file = path.join(f.root, "state.json");
      writeFileSync(file, '{"old":true}\n');
      await expect(
        writeFileAtomic(
          file,
          '{"new":true}\n',
          undefined,
          stage === "rename"
            ? {
                rename: async () => {
                  throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
                },
              }
            : {
                open: async (...args: Parameters<typeof open>) => {
                  const handle = await open(...args);
                  return new Proxy(handle, {
                    get(target, key) {
                      if (key === "writeFile")
                        return async () => {
                          throw new Error("ENOSPC");
                        };
                      const value = Reflect.get(target, key);
                      return typeof value === "function" ? value.bind(target) : value;
                    },
                  });
                },
              },
        ),
      ).rejects.toThrow("ENOSPC");
      expect(readFileSync(file, "utf8")).toBe('{"old":true}\n');
      expect(readdirSync(f.root).filter((name) => name.includes(".tmp-"))).toEqual([]);
    },
  );

  test("[E26] map failure after inventory commit leaves a marker and recovers from the committed record", async () => {
    const f = fixture();
    await f.save();
    await expect(
      updateWorkspace(
        f.root,
        (current) => ({ config: { ...current, repos: [] }, result: undefined }),
        f.env,
        {
          writeMap: async () => {
            throw new Error("EACCES");
          },
        },
      ),
    ).rejects.toThrow("inventory saved");
    expect((await readWorkspaceConfig(f.root, f.env))?.repos).toEqual([]);
    expect(existsSync(agentsRecoveryPath(f.root))).toBe(true);
    await loadWorkspace(f.root, undefined, f.env);
    expect(readFileSync(path.join(f.root, "AGENTS.md"), "utf8")).toContain("Total repositories: 0");
    expect(existsSync(agentsRecoveryPath(f.root))).toBe(false);
  });

  test("[E27] cache detects a same-size, same-mtime replacement by a real second process", async () => {
    const f = fixture();
    f.config.aliases = { api: "one" };
    await f.save();
    await readWorkspaceConfig(f.root, f.env);
    const file = centralStorePath(f.env),
      before = statSync(file);
    const p = child(
      `import{readFileSync,utimesSync}from'node:fs';import{writeFileAtomic}from'./src/services/fsUtils.ts';const file=${JSON.stringify(file)};await writeFileAtomic(file,readFileSync(file,'utf8').replace('"one"','"two"'));utimesSync(file,new Date(${before.atimeMs}),new Date(${before.mtimeMs}));`,
      f.configDir,
    );
    expect(await p.exited).toBe(0);
    expect(statSync(file).size).toBe(before.size);
    expect((await readWorkspaceConfig(f.root, f.env))?.aliases?.api).toBe("two");
  });

  test("[E28] callers cannot mutate cached nested config without a save", async () => {
    const f = fixture();
    await f.save();
    const one = (await readWorkspaceConfig(f.root, f.env))!;
    one.repos[0]!.name = "wrong";
    one.repos.push(inventoryEntry("other"));
    const two = (await readWorkspaceConfig(f.root, f.env))!;
    expect(two.repos.length).toBe(1);
    expect(two.repos[0]?.name).toBe("api");
    expect(
      JSON.parse(readFileSync(centralStorePath(f.env), "utf8")).workspaces[0].repos[0].name,
    ).toBe("api");
  });

  test("[E29] invalid individual workspace blocks writes and preserves original evidence", async () => {
    const f = fixture();
    await f.save();
    const file = centralStorePath(f.env);
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.workspaces.push(null);
    const bytes = JSON.stringify(data);
    writeFileSync(file, bytes);
    await expect(readWorkspaceConfig(f.root, f.env)).rejects.toThrow("invalid workspace entry");
    await expect(
      updateWorkspace(f.root, (c) => ({ config: c, result: undefined }), f.env),
    ).rejects.toThrow("invalid workspace entry");
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(readFileSync(`${file}.bak`, "utf8")).toBe(bytes);
  });

  test("[E30] alias queued behind snapshot restore is preserved with a consistent map", async () => {
    const f = fixture();
    await f.save();
    const snapshot = await writeWorkspaceSnapshot(f.root, f.config);
    let worker: ReturnType<typeof child>;
    await withWorkspaceLock(
      async () => {
        worker = child(
          `import{updateWorkspace}from'./src/services/workspace.ts';console.log('READY');await updateWorkspace(${JSON.stringify(f.root)},c=>({config:{...c,aliases:{...c.aliases,after:'acme/source/api'}},result:undefined}));`,
          f.configDir,
        );
        await ready(worker);
        expect((await restoreWorkspaceSnapshot(f.root, path.basename(snapshot), f.env)).ok).toBe(
          true,
        );
      },
      { env: f.env },
    );
    expect(await worker!.exited).toBe(0);
    expect((await readWorkspaceConfig(f.root, f.env))?.aliases?.after).toBe("acme/source/api");
    expect(readFileSync(path.join(f.root, "AGENTS.md"), "utf8")).toContain("after");
  });

  test.each([
    null,
    { key: "acme/api", from: "../outside", to: "safe", status: "pending" },
    { key: "bad", from: "a", to: "b", status: "done" },
    { key: "acme/api", from: "a", to: "b", status: "unknown" },
  ])("[E31] malformed nested journal is rejected before any movement", (move) => {
    const f = fixture();
    mkdirSync(path.join(f.root, ".repotruck"), { recursive: true });
    const file = reorganizeJournalPath(f.root);
    const bytes = JSON.stringify({
      version: 1,
      preset: "flat",
      timestamp: new Date().toISOString(),
      moves: [move],
    });
    writeFileSync(file, bytes);
    expect(() => readReorganizeJournal(f.root)).toThrow("corrupt reorganize journal");
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(readFileSync(path.join(f.repoDir, "sentinel.txt"), "utf8")).toBe("user data\n");
  });
  test("[E31] resume refuses an unknown custom preset without changing evidence or files", async () => {
    const f = fixture();
    await f.save();
    mkdirSync(path.join(f.root, ".repotruck"), { recursive: true });
    const file = reorganizeJournalPath(f.root),
      bytes = JSON.stringify({
        version: 1,
        preset: "missing-custom-preset",
        timestamp: new Date().toISOString(),
        moves: [{ key: "acme/api", from: "acme/source/api", to: "other/api", status: "pending" }],
      });
    writeFileSync(file, bytes);
    await expect(reorganizeWorkspace(f.root, "flat", { resume: true, env: f.env })).rejects.toThrow(
      "unknown preset",
    );
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(existsSync(f.repoDir)).toBe(true);
  });
});

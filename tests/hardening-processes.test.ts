import { afterEach, describe, expect, test } from "bun:test";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { performUndoAction } from "../src/components/store/lifecycleActions.ts";
import {
  appsFilePath,
  defaultSpawnImpl,
  loadCustomApps,
  resolveApp,
  runAppInRepo,
} from "../src/services/launcher.ts";
import { moveDir, moveRepository } from "../src/services/mover.ts";
import { runInRepos } from "../src/services/runner.ts";
import { readWorkspaceConfig, writeWorkspaceConfig } from "../src/services/workspaceRegistry.ts";
import { workspaceFixture } from "./helpers/hardening.ts";

const exec = promisify(execFile);
const fixtures: ReturnType<typeof workspaceFixture>[] = [];
function fixture() {
  const f = workspaceFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

function findFiles(root: string, filename: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(file, filename));
    else if (entry.isFile() && entry.name === filename) found.push(file);
  }
  return found;
}

async function observeEditorWorkspace(userDataDir: string, port: number, expectedFolder: string) {
  const expectedUri = pathToFileURL(expectedFolder).href;
  const deadline = Date.now() + 30000;
  let lastError = "editor workspace has not appeared yet";
  while (Date.now() < deadline) {
    for (const file of findFiles(
      path.join(userDataDir, "User", "workspaceStorage"),
      "workspace.json",
    )) {
      try {
        const workspace = JSON.parse(readFileSync(file, "utf8")) as { folder?: string };
        if (workspace.folder !== expectedUri) continue;
        const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
        if (response === null || !response.ok) continue;
        const targets = (await response.json()) as {
          title?: string;
          type?: string;
          url?: string;
        }[];
        const page = targets.find((target) => target.type === "page");
        if (page?.title === undefined) continue;
        return {
          workspaceFile: file,
          workspaceUri: workspace.folder,
          targetTitle: page.title,
          pageUrl: page.url,
        };
      } catch (error) {
        lastError = String(error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`could not observe ${expectedFolder} in editor ${userDataDir}: ${lastError}`);
}

async function closeEditorByCdp(port: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!response.ok) throw new Error(`CDP version endpoint returned ${response.status}`);
  const version = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (version.webSocketDebuggerUrl === undefined)
    throw new Error("CDP browser websocket is missing");
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(version.webSocketDebuggerUrl!);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("timed out closing test editor over CDP"));
    }, 5000);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };
    socket.addEventListener("open", () =>
      socket.send(JSON.stringify({ id: 1, method: "Browser.close" })),
    );
    socket.addEventListener("message", finish, { once: true });
    socket.addEventListener("close", finish, { once: true });
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("CDP connection to test editor failed"));
      },
      { once: true },
    );
  });
}

async function stopEditorProcesses(userDataDir: string): Promise<void> {
  const matchingPids = () => {
    const found: number[] = [];
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const commandLine = readFileSync(`/proc/${entry}/cmdline`, "utf8");
        if (commandLine.includes(`--user-data-dir=${userDataDir}`)) found.push(Number(entry));
      } catch {}
    }
    return found;
  };
  let pids = matchingPids();
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  pids = matchingPids();
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

const realEditorSmokeEnabled =
  process.platform === "linux" &&
  process.env.REPOTRUCK_TEST_REAL_EDITORS === "1" &&
  Boolean(Bun.which("code")) &&
  Boolean(process.env.REPOTRUCK_TEST_CURSOR);
if (!realEditorSmokeEnabled) {
  console.info(
    "SKIP [W08] real editor smoke requires Linux, REPOTRUCK_TEST_REAL_EDITORS=1, code, and REPOTRUCK_TEST_CURSOR",
  );
}

describe("production process launch paths", () => {
  (process.platform === "win32" ? test.skip : test)(
    "[E62] real PTY opens About, suspends for an app, resumes after failure and exits",
    async () => {
      const f = fixture();
      f.config.aliases = { api: "acme/source/api" };
      await f.save();
      const marker = path.join(f.base, "launched.json"),
        app = path.join(f.base, "app with spaces.mjs");
      writeFileSync(
        app,
        `import {writeFileSync,appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(`${marker}.runs`)}, 'x'); writeFileSync(${JSON.stringify(marker)}, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)})); await new Promise(resolve=>setTimeout(resolve,200)); process.exitCode=17;`,
      );
      writeFileSync(
        path.join(f.configDir, "config.json"),
        JSON.stringify({ defaultRoot: f.root, checkUpdates: false }),
      );
      writeFileSync(
        path.join(f.configDir, "apps.json"),
        JSON.stringify([
          {
            name: "claude",
            command: process.execPath,
            args: [app, "{repoDir}", "spaced argument", "ş🙂", "--literal"],
          },
        ]),
      );
      const runtimeName = process.env.REPOTRUCK_TUI_TEST_RUNTIME;
      const runtime = runtimeName ? Bun.which(runtimeName)! : process.execPath;
      const runtimeVersion = (
        await exec(runtime, ["--version"], {
          cwd: path.join(import.meta.dir, ".."),
          timeout: 10_000,
        })
      ).stdout.trim();
      console.info(`[E62] target runtime=${runtimeName ?? "current"} version=${runtimeVersion}`);
      const expectedRuntimeVersion = process.env.REPOTRUCK_TUI_TEST_EXPECTED_VERSION;
      if (expectedRuntimeVersion) expect(runtimeVersion).toBe(expectedRuntimeVersion);
      const entry = path.resolve(process.env.REPOTRUCK_TUI_TEST_ENTRY ?? "src/cli.ts");
      const movedRepoDir = path.join(f.root, "acme", "moved", "api");
      const configFile = path.join(f.configDir, "repotruck.json");
      const { stdout } = await exec(
        "python3",
        ["scripts/test-pty.py", runtime, entry, marker, f.repoDir, movedRepoDir, configFile],
        {
          cwd: path.join(import.meta.dir, ".."),
          env: {
            ...process.env,
            ...f.env,
            REPOTRUCK_OFFLINE: "1",
            REPOTRUCK_NO_AGENTS_MD_MIGRATE: "1",
            TERM: "xterm-256color",
          },
          timeout: 45000,
          maxBuffer: 1024 * 1024,
        },
      );
      const ptyEvidence = JSON.parse(stdout) as {
        pty: string;
        resumeCycles: number;
        undo: { restored: string; removedMovedPath: string; alias: string };
      };
      expect(ptyEvidence.pty).toBe("passed");
      expect(ptyEvidence.resumeCycles).toBe(2);
      expect(ptyEvidence.undo).toEqual({
        restored: f.repoDir,
        removedMovedPath: movedRepoDir,
        alias: "api -> acme/source/api",
      });
      console.info(`[E62] ${JSON.stringify(ptyEvidence)}`);
      expect(readFileSync(`${marker}.runs`, "utf8")).toBe("xx");
      expect(JSON.parse(readFileSync(marker, "utf8")).cwd).toBe(movedRepoDir);
      const persisted = JSON.parse(readFileSync(configFile, "utf8")) as {
        workspaces: {
          repos: { owner: string; name: string; relativePath: string }[];
          aliases?: Record<string, string>;
        }[];
      };
      expect(persisted.workspaces[0]?.repos).toContainEqual(
        expect.objectContaining({ owner: "acme", name: "api", relativePath: "acme/source/api" }),
      );
      expect(persisted.workspaces[0]?.aliases).toEqual({ api: "acme/source/api" });
    },
    50000,
  );

  test("[E62] move undo restores unchanged aliases and preserves later alias edits", async () => {
    const f = fixture();
    f.config.aliases = { api: "acme/source/api", partner: "acme/source/api" };
    await f.save();
    const previousConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
    process.env.REPOTRUCK_CONFIG_DIR = f.configDir;
    try {
      const beforeMove = structuredClone(f.config);
      expect((await moveRepository(f.root, beforeMove, "acme/api", "acme/moved/api")).ok).toBe(
        true,
      );
      const afterMove = await readWorkspaceConfig(f.root, f.env);
      expect(afterMove?.aliases).toEqual({ api: "acme/moved/api", partner: "acme/moved/api" });
      await writeWorkspaceConfig(
        f.root,
        {
          ...afterMove!,
          aliases: {
            api: "acme/elsewhere",
            partner: "acme/moved/api",
            fresh: "acme/moved/api",
          },
        },
        f.env,
      );
      await performUndoAction(
        f.root,
        {
          type: "move",
          key: "acme/api",
          from: "acme/source/api",
          to: "acme/moved/api",
          config: beforeMove,
        },
        moveDir,
        () => {},
      );
      const afterUndo = await readWorkspaceConfig(f.root, f.env);
      expect(afterUndo?.repos[0]?.relativePath).toBe("acme/source/api");
      expect(afterUndo?.aliases).toEqual({
        api: "acme/elsewhere",
        partner: "acme/source/api",
        fresh: "acme/moved/api",
      });
    } finally {
      if (previousConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
      else process.env.REPOTRUCK_CONFIG_DIR = previousConfigDir;
    }
  });

  const editorTest = realEditorSmokeEnabled ? test : test.skip;
  editorTest(
    "[W08] real VS Code and Cursor open the selected spaced workspace through the production launcher",
    async () => {
      const f = fixture();
      await f.save();
      const root = "/tmp/repotruck-completion-20261124/pty/editors";
      mkdirSync(root, { recursive: true });
      const workspace = f.repoDir;
      const code = Bun.which("code");
      const cursor = process.env.REPOTRUCK_TEST_CURSOR;
      if (code === null || cursor === undefined)
        throw new Error("editor smoke binaries disappeared after setup");
      const cursorVersion = /Cursor-(\d+\.\d+\.\d+)/.exec(path.basename(cursor))?.[1];
      if (cursorVersion === undefined)
        throw new Error(`Cursor binary name has no version: ${cursor}`);
      const apps = [
        {
          name: "vscode",
          command: code,
          args: [
            `--user-data-dir=${path.join(root, "vscode-user-data")}`,
            `--extensions-dir=${path.join(root, "vscode-extensions")}`,
            "--new-window",
            "--remote-debugging-port=19473",
            "{repoDir}",
          ],
        },
        {
          name: "cursor",
          command: cursor,
          args: [
            "--no-sandbox",
            "--disable-gpu",
            `--user-data-dir=${path.join(root, "cursor-user-data")}`,
            `--extensions-dir=${path.join(root, "cursor-extensions")}`,
            "--new-window",
            "--remote-debugging-port=19474",
            "{repoDir}",
          ],
        },
      ];
      writeFileSync(appsFilePath(f.env), JSON.stringify(apps));
      f.config.aliases = { api: "acme/source/api" };
      await f.save();
      const customApps = await loadCustomApps(f.env);
      const evidence: Record<string, unknown> = {};
      for (const name of ["vscode", "cursor"]) {
        const userDataDir = path.join(root, `${name}-user-data`);
        const extensionsDir = path.join(root, `${name}-extensions`);
        const port = name === "vscode" ? 19473 : 19474;
        const app = await resolveApp(name, { customApps, env: f.env });
        if (app === null) throw new Error(`production launcher could not resolve ${name}`);
        rmSync(userDataDir, { recursive: true, force: true });
        rmSync(extensionsDir, { recursive: true, force: true });
        mkdirSync(userDataDir, { recursive: true });
        const version =
          name === "vscode"
            ? execFileSync(app.command, ["--version"], { encoding: "utf8" })
                .trim()
                .split(/\r?\n/)[0]
            : `Cursor ${cursorVersion} (official AppImage)`;
        const launched = runAppInRepo(
          { root: f.root, config: f.config, ref: "api", app, mode: "foreground" },
          { spawnImpl: defaultSpawnImpl },
        );
        try {
          const observed = await observeEditorWorkspace(userDataDir, port, workspace);
          const processEvidence = execFileSync("ps", ["-eo", "args="], { encoding: "utf8" })
            .split(/\r?\n/)
            .find(
              (line) => line.includes(`--user-data-dir=${userDataDir}`) && line.includes(workspace),
            );
          if (processEvidence === undefined)
            throw new Error(
              `${name} process did not retain isolated profile and target folder args`,
            );
          const pageUrl = (observed.pageUrl ?? "").toLowerCase();
          const appPathMarker = name === "vscode" ? "/snap/code/" : "/.mount_cursor";
          if (!pageUrl.includes(appPathMarker)) {
            throw new Error(`${name} CDP page URL did not identify the app: ${observed.pageUrl}`);
          }
          await closeEditorByCdp(port);
          const result = await launched;
          evidence[name] = {
            version,
            launchCode: result.code,
            workspace,
            workspaceUri: observed.workspaceUri,
            workspaceFile: observed.workspaceFile,
            cdpTargetTitle: observed.targetTitle,
            pageUrl: observed.pageUrl,
            process: processEvidence.trim(),
          };
          expect(result.code).toBe(0);
        } finally {
          await stopEditorProcesses(userDataDir);
        }
      }
      const evidenceFile = path.join(root, "real-editor-observations.json");
      writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
      expect(evidence.vscode).toBeDefined();
      expect(evidence.cursor).toBeDefined();
      console.info(`REAL EDITOR EVIDENCE ${evidenceFile}`);
    },
    120000,
  );

  test("[E57] actual Node subprocess terminates a pathological regex with a controlled error", async () => {
    const f = fixture();
    writeFileSync(path.join(f.repoDir, "attack.txt"), `${"a".repeat(100000)}!`);
    const searchCodeUrl = pathToFileURL(path.resolve("src/services/codeSearch.ts")).href;
    const code = `import {searchCode} from ${JSON.stringify(searchCodeUrl)}; let responsive=false;setTimeout(()=>responsive=true,20);try{await searchCode(${JSON.stringify({ root: f.root, config: f.config, text: true, regex: true, pattern: "(a+)+$" })});throw new Error('unexpected success');}catch(error){if(!error.message.includes('execution limit'))throw error; console.log(JSON.stringify({bounded:true,responsive}));}`;
    const result = await exec(Bun.which("node")!, ["--input-type=module", "--eval", code], {
      timeout: 6000,
    });
    expect(JSON.parse(result.stdout)).toEqual({ bounded: true, responsive: true });
  }, 10000);

  test("[E66] defaultSpawnImpl preserves executable paths, spaces, Unicode and literal metacharacters", async () => {
    const f = fixture(),
      script = path.join(f.base, "argv recorder.mjs"),
      output = path.join(f.base, "argv.json");
    writeFileSync(
      script,
      `import {writeFileSync} from 'node:fs';writeFileSync(process.argv[2],JSON.stringify({cwd:process.cwd(),args:process.argv.slice(3)}));`,
    );
    const args = [
      "space value",
      'double"quote',
      "single'quote",
      "ş🙂",
      "a&b",
      "x|y",
      "caret^",
      "100%",
      "!bang!",
      "a(b)",
      "",
      "trailing\\",
    ];
    expect(
      await defaultSpawnImpl({
        command: process.execPath,
        args: [script, output, ...args],
        cwd: f.repoDir,
      }),
    ).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({ cwd: f.repoDir, args });
  });

  (process.platform === "win32" ? test : test.skip)(
    "[E66] production launcher and runner execute .cmd shims without metacharacter expansion",
    async () => {
      const f = fixture(),
        binDir = path.join(f.base, "bin with spaces");
      mkdirSync(binDir);
      const script = path.join(binDir, "record.mjs"),
        shim = path.join(binDir, "tool.cmd"),
        output = path.join(f.base, "shim.json");
      writeFileSync(
        script,
        `import {writeFileSync} from 'node:fs';writeFileSync(process.argv[2],JSON.stringify({cwd:process.cwd(),args:process.argv.slice(3)}));`,
      );
      writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
      const args = [
        "space value",
        'double"quote',
        "a&b",
        "x|y",
        "caret^",
        "%PATH%",
        "!bang!",
        "a(b)",
        "",
        "trail\\",
      ];
      expect(
        await defaultSpawnImpl({ command: shim, args: [output, ...args], cwd: f.repoDir }),
      ).toBe(0);
      expect(JSON.parse(readFileSync(output, "utf8")).args).toEqual(args);
      const result = await runInRepos({
        root: f.root,
        config: f.config,
        refs: ["acme/api"],
        command: shim,
        args: [output, ...args],
      });
      expect(result.results[0]?.ok).toBe(true);
      expect(JSON.parse(readFileSync(output, "utf8")).args).toEqual(args);
      const oldPath = process.env.PATH;
      try {
        process.env.PATH = `${binDir}${path.delimiter}${oldPath ?? ""}`;
        expect(
          await defaultSpawnImpl({ command: "tool", args: [output, ...args], cwd: f.repoDir }),
        ).toBe(0);
        expect(JSON.parse(readFileSync(output, "utf8")).args).toEqual(args);
        const result = await runInRepos({
          root: f.root,
          config: f.config,
          refs: [],
          command: "tool",
          args: [output, ...args],
        });
        expect(result.results[0]?.ok).toBe(true);
        await expect(
          defaultSpawnImpl({ command: shim, args: [output, "line\nvalue"], cwd: f.repoDir }),
        ).rejects.toThrow("newline");
      } finally {
        if (oldPath === undefined) delete process.env.PATH;
        else process.env.PATH = oldPath;
      }
    },
  );
});

// Runs with the target Node runtime against an installed package, from a clean cwd.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const packageDir = path.resolve(process.argv[2]);
const temporaryBase = mkdtempSync(path.join(tmpdir(), "repotruck-installed-"));
const base = realpathSync.native(temporaryBase);
const root = path.join(base, "workspace with spaces"),
  configDir = path.join(base, "config"),
  relativePath = "acme/source/fixture";
const cli = path.join(packageDir, "bin/repotruck.js");
const env = {
  ...process.env,
  REPOTRUCK_CONFIG_DIR: configDir,
  REPOTRUCK_OFFLINE: "1",
  REPOTRUCK_TOKEN: "",
  NO_COLOR: "1",
};
const run = (...args) =>
  execFileSync(process.execPath, [cli, ...args], {
    cwd: base,
    env,
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  mkdirSync(configDir);
  mkdirSync(path.join(root, relativePath), { recursive: true });
  writeFileSync(
    path.join(configDir, "repotruck.json"),
    JSON.stringify({
      version: 1,
      workspaces: [
        {
          version: 1,
          root,
          preset: "categorized",
          lastSync: null,
          lastUsed: new Date().toISOString(),
          repos: [
            {
              owner: "acme",
              name: "fixture",
              relativePath,
              category: "source",
              internal: true,
              language: null,
              updatedAt: null,
            },
          ],
        },
      ],
    }),
  );
  assert.equal(
    run("--version").trim(),
    JSON.parse(readFileSync(path.join(packageDir, "package.json"))).version,
  );
  for (const argument of ["--about", "about"]) {
    const about = run(argument);
    assert.match(about, /Clone, organize and sync/);
    assert.match(about, /github.com\/sametcn99\/repotruck/);
  }
  assert.equal(JSON.parse(run("workspaces", "--json")).workspaces.length, 1);
  assert.equal(JSON.parse(run("status", "--dir", root, "--json")).repos.length, 1);
  const sources = {
    "fixture.ts": "export function fixture_ts() {}",
    "fixture.tsx": "export function fixture_tsx() {return <div/>}",
    "fixture.js": "export function fixture_js() {}",
    "fixture.py": "def fixture_python():\n  pass\n",
    "fixture.go": "package main\nfunc Fixture_go() {}\n",
    "fixture.rs": "pub fn fixture_rust() {}",
  };
  for (const [file, content] of Object.entries(sources))
    writeFileSync(path.join(root, relativePath, file), content);
  const search = JSON.parse(run("search-code", "fixture", "--offline", "--dir", root, "--json"));
  assert.equal(search.matches.length, 6);
  assert.equal(
    JSON.parse(readFileSync(path.join(root, ".repotruck/code-index.json"))).grammars.length,
    6,
  );
  const regex = JSON.parse(
    run("search-code", "fixture_.*", "--regex", "--offline", "--dir", root, "--json"),
  );
  assert.equal(regex.matches.length, 6);
  const child = spawn(process.execPath, [cli, "mcp"], {
    cwd: base,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`installed MCP timed out: ${stderr}`)),
        10000,
      );
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout.on("data", () => {
        for (const line of output.trim().split("\n")) {
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.id === 2) {
            clearTimeout(timer);
            resolve(message);
          }
        }
      });
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "package-smoke", version: "1" } } })}\n`,
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    assert.equal((await done).result.tools.length, 25);
  } finally {
    child.stdin.end();
    child.kill();
    await new Promise((resolve) => child.once("close", resolve));
  }
  console.log(
    JSON.stringify({
      runtime: process.version,
      installed: packageDir,
      about: true,
      status: true,
      offlineGrammars: 6,
      regex: true,
      mcpTools: 25,
    }),
  );
} finally {
  rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

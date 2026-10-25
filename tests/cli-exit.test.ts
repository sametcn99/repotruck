import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RepoInventoryEntry } from "../src/services/config.ts";
import { updateWorkspace } from "../src/services/workspace.ts";

const tempDirs: string[] = [];
const savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function makeRepo(i: number): RepoInventoryEntry {
  return {
    owner: `owner${i}`,
    name: `repo${i}`,
    relativePath: `owner${i}/repo${i}`,
    category: "source",
    internal: false,
    language: "TypeScript",
    updatedAt: null,
  };
}

function runCli(args: string[], configDir: string) {
  return Bun.spawnSync([process.execPath, "run", "src/cli.ts", ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: { ...process.env, REPOTRUCK_CONFIG_DIR: configDir, REPOTRUCK_NO_SSH: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI exit semantics (Faz 7)", () => {
  test("status --json over a pipe stays valid, complete JSON with 2000 tracked repos", async () => {
    const root = tempDir("rt-exit-root-");
    const configDir = tempDir("rt-exit-cfg-");

    await updateWorkspace(
      root,
      (config) => {
        const repos: RepoInventoryEntry[] = [];
        for (let i = 0; i < 2000; i++) repos.push(makeRepo(i));
        return { config: { ...config, repos }, result: undefined };
      },
      { REPOTRUCK_CONFIG_DIR: configDir },
    );

    const proc = runCli(["status", "--json", "--dir", root], configDir);
    expect(proc.exitCode).toBe(0);
    const stdout = proc.stdout.toString();
    const payload = JSON.parse(stdout);
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("status");
    expect(payload.repos.length).toBe(2000);
  });

  test("error paths terminate with exit code 1 and a JSON error payload", async () => {
    const configDir = tempDir("rt-exit-err-cfg-");
    const notAWorkspace = tempDir("rt-exit-not-ws-");

    const proc = runCli(["status", "--json", "--dir", notAWorkspace], configDir);
    expect(proc.exitCode).toBe(1);
    const payload = JSON.parse(proc.stdout.toString());
    expect(payload.ok).toBe(false);
    expect(typeof payload.error).toBe("string");
  });
});

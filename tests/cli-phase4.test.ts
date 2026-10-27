import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { type CallToolResult, InMemoryTransport } from "@modelcontextprotocol/server";
import { createRepotruckMcpServer } from "../src/mcp/server.ts";
import { deleteRepository } from "../src/services/lifecycle.ts";
import { loadWorkspace, updateWorkspace } from "../src/services/workspace.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "src", "cli.ts");
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = (realpathSync.native ?? realpathSync)(mkdtempSync(path.join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function runCli(args: string[], configDir: string) {
  return Bun.spawnSync([process.execPath, "run", cliPath, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, REPOTRUCK_CONFIG_DIR: configDir },
  });
}

describe("Phase 4 CLI & MCP additions", () => {
  test("profile pin/unpin/save/list/delete + status/run --pinned/--profile + search-code --text", async () => {
    const root = tempDir("rt-p4-ws-");
    const cfgDir = tempDir("rt-p4-cfg-");
    const env = { REPOTRUCK_CONFIG_DIR: cfgDir };

    for (const rel of ["acme/source/api", "acme/source/web"]) {
      const abs = path.join(root, ...rel.split("/"));
      mkdirSync(abs, { recursive: true });
      writeFileSync(path.join(abs, "app.ts"), `export const tag = "${rel}";\n`, "utf8");
    }

    await updateWorkspace(
      root,
      () => ({
        config: {
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
              language: "TypeScript",
              updatedAt: null,
            },
            {
              owner: "acme",
              name: "web",
              relativePath: "acme/source/web",
              category: "source",
              internal: true,
              language: "TypeScript",
              updatedAt: null,
            },
          ],
        },
        result: undefined,
      }),
      env,
    );

    const pinRes = runCli(["profile", "pin", "acme/api", "-d", root, "--json"], cfgDir);
    expect(pinRes.exitCode).toBe(0);
    expect(JSON.parse(pinRes.stdout.toString()).pinned).toEqual(["acme/api"]);

    const saveRes = runCli(
      ["profile", "save", "backend", "--from-pinned", "-d", root, "--json"],
      cfgDir,
    );
    expect(saveRes.exitCode).toBe(0);

    const listRes = runCli(["profile", "list", "-d", root, "--json"], cfgDir);
    expect(listRes.exitCode).toBe(0);
    const listed = JSON.parse(listRes.stdout.toString());
    expect(listed.pinned).toEqual(["acme/api"]);
    expect(listed.profiles).toEqual([{ name: "backend", repos: ["acme/api"] }]);

    const statusPinned = runCli(["status", "--pinned", "-d", root, "--json"], cfgDir);
    expect(statusPinned.exitCode).toBe(0);
    expect(
      JSON.parse(statusPinned.stdout.toString()).repos.map((r: { key: string }) => r.key),
    ).toEqual(["acme/api"]);

    const runProfile = runCli(
      [
        "run",
        "--profile",
        "backend",
        "-d",
        root,
        "--json",
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ],
      cfgDir,
    );
    expect(runProfile.exitCode).toBe(0);
    expect(JSON.parse(runProfile.stdout.toString()).results.length).toBe(1);

    const textSearch = runCli(
      ["search-code", "acme/source/web", "--text", "-d", root, "--json"],
      cfgDir,
    );
    expect(textSearch.exitCode).toBe(0);
    const searchJson = JSON.parse(textSearch.stdout.toString());
    expect(searchJson.matches.length).toBe(1);
    expect(searchJson.matches[0].repo).toBe("acme/web");

    // MCP list_repos with pinned/profile and search_code with text=true
    const server = await createRepotruckMcpServer({ env, cwd: root, version: "0.0.0-test" });
    const client = new Client({ name: "p4-mcp-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const mcpPinned = (await client.callTool({
      name: "repotruck_list_repos",
      arguments: { root, pinned: true },
    })) as CallToolResult;
    const mcpPinnedJson = JSON.parse((mcpPinned.content[0] as { text: string }).text);
    expect(mcpPinnedJson.count).toBe(1);
    expect(mcpPinnedJson.repos[0].pinned).toBe(true);

    const mcpText = (await client.callTool({
      name: "repotruck_search_code",
      arguments: { root, pattern: "acme/source/api", text: true },
    })) as CallToolResult;
    const mcpTextJson = JSON.parse((mcpText.content[0] as { text: string }).text);
    expect(mcpTextJson.count).toBe(1);

    // Trash CLI list -> restore -> empty
    await deleteRepository(
      root,
      await loadWorkspace(root, undefined, env),
      "acme/web",
      {
        yes: true,
        trash: true,
      },
      env,
    );
    expect(existsSync(path.join(root, "acme", "source", "web"))).toBe(false);

    const trashList = runCli(["trash", "list", "-d", root, "--json"], cfgDir);
    expect(trashList.exitCode).toBe(0);
    expect(JSON.parse(trashList.stdout.toString()).entries.length).toBe(1);

    const trashRestore = runCli(["trash", "restore", "acme/web", "-d", root, "--json"], cfgDir);
    expect(trashRestore.exitCode).toBe(0);
    expect(existsSync(path.join(root, "acme", "source", "web"))).toBe(true);

    const emptyNoYes = runCli(["trash", "empty", "-d", root], cfgDir);
    expect(emptyNoYes.exitCode).toBe(1);

    const emptyYes = runCli(["trash", "empty", "--yes", "-d", root, "--json"], cfgDir);
    expect(emptyYes.exitCode).toBe(0);

    // Discover --help & validation
    const discoverHelp = runCli(["discover", "--help"], cfgDir);
    expect(discoverHelp.exitCode).toBe(0);
    expect(discoverHelp.stdout.toString()).toContain("--min-stars");
    expect(discoverHelp.stdout.toString()).toContain("--clone");
  });
});

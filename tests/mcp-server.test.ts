import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { type CallToolResult, InMemoryTransport } from "@modelcontextprotocol/server";
import {
  bridgeHubToSink,
  createRepotruckMcpServer,
  type McpServerOptions,
  progressSinkFromContext,
} from "../src/mcp/server.ts";
import type { RepotruckConfig } from "../src/services/config.ts";
import { APPS_FILENAME } from "../src/services/launcher.ts";
import { createProgressHub } from "../src/services/progressHub.ts";
import { updateWorkspace } from "../src/services/workspace.ts";

const tempRoots: string[] = [];
let configDir: string;
let savedConfigDir: string | undefined;
let env: Record<string, string | undefined>;
let cwd: string;
let wsRoot: string;

function tempDir(prefix: string): string {
  const dir = (realpathSync.native ?? realpathSync)(mkdtempSync(path.join(tmpdir(), prefix)));
  tempRoots.push(dir);
  return dir;
}

function entry(
  owner: string,
  name: string,
  relativePath: string,
  internal: boolean,
): RepotruckConfig["repos"][number] {
  return {
    owner,
    name,
    relativePath,
    category: "source",
    internal,
    language: internal ? "TypeScript" : "Go",
    updatedAt: null,
  };
}

async function makeFixtureWorkspace(): Promise<void> {
  wsRoot = tempDir("repotruck-mcp-ws-");
  const config: RepotruckConfig = {
    version: 1,
    root: wsRoot,
    preset: "categorized",
    lastSync: null,
    repos: [
      entry("acme", "api", "acme/source/api", true),
      entry("octo", "lib", "community/octo/source/lib", false),
    ],
  };
  for (const rel of ["acme/source/api", "community/octo/source/lib"]) {
    mkdirSync(path.join(wsRoot, ...rel.split("/")), { recursive: true });
    writeFileSync(path.join(wsRoot, ...rel.split("/"), "file.txt"), "demo", "utf8");
  }
  writeFileSync(
    path.join(wsRoot, "acme", "source", "api", "symbols.ts"),
    "export function demoHelper(): void {\n  return;\n}\n\nclass DemoInternal {\n}\n",
    "utf8",
  );
  await updateWorkspace(wsRoot, () => ({ config, result: undefined }));
}

async function connect(options: Partial<McpServerOptions> = {}): Promise<Client> {
  const server = await createRepotruckMcpServer({
    env,
    cwd,
    version: "0.0.0-test",
    ...options,
  });
  const client = new Client({ name: "repotruck-mcp-tests", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: CallToolResult): string {
  return (result.content ?? [])
    .map((block) => (block.type === "text" ? (block as { text: string }).text : ""))
    .join("");
}

function jsonOf<T>(result: CallToolResult): T {
  return JSON.parse(textOf(result)) as T;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

beforeAll(async () => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  configDir = tempDir("repotruck-mcp-cfg-");
  process.env.REPOTRUCK_CONFIG_DIR = configDir;
  env = { REPOTRUCK_CONFIG_DIR: configDir };
  cwd = tempDir("repotruck-mcp-cwd-");
  await makeFixtureWorkspace();
});

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const EXPECTED_TOOLS: readonly string[] = [
  "repotruck_list_workspaces",
  "repotruck_workspace_status",
  "repotruck_list_repos",
  "repotruck_search_repos",
  "repotruck_resolve_repo",
  "repotruck_agents_md",
  "repotruck_sync",
  "repotruck_clone",
  "repotruck_create",
  "repotruck_move",
  "repotruck_reorganize",
  "repotruck_forget",
  "repotruck_prune",
  "repotruck_status",
  "repotruck_archive",
  "repotruck_open",
  "repotruck_alias_set",
  "repotruck_alias_remove",
  "repotruck_search_github",
  "repotruck_search_code",
  "repotruck_run",
  "repotruck_stats",
  "repotruck_delete",
  "repotruck_doctor",
  "repotruck_workspaces_remove",
];

describe("repotruck MCP server", () => {
  test("exposes the full tool surface with descriptions", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    for (const tool of tools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description!.length).toBeGreaterThan(20);
    }
  });

  test("repotruck_list_workspaces returns the registered fixture", async () => {
    const client = await connect();
    const result = jsonOf<{ workspaces: Array<{ path: string; repoCount: number }> }>(
      await call(client, "repotruck_list_workspaces", {}),
    );
    const match = result.workspaces.find((item) => {
      if (item.path.toLowerCase() === wsRoot.toLowerCase()) return true;
      try {
        const ni = (realpathSync.native ?? realpathSync)(item.path).toLowerCase();
        const nw = (realpathSync.native ?? realpathSync)(wsRoot).toLowerCase();
        return ni === nw;
      } catch {
        return false;
      }
    });
    expect(match).toBeDefined();
    expect(match!.repoCount).toBe(2);
  });

  test("repotruck_workspace_status reports an initialized workspace", async () => {
    const client = await connect();
    const status = jsonOf<{
      root: string;
      initialized: boolean;
      preset: string;
      totalRepos: number;
      internalRepos: number;
      communityRepos: number;
      agentsMd: boolean;
    }>(await call(client, "repotruck_workspace_status", { root: wsRoot }));
    expect(status.initialized).toBe(true);
    expect(status.preset).toBe("categorized");
    expect(status.totalRepos).toBe(2);
    expect(status.internalRepos).toBe(1);
    expect(status.communityRepos).toBe(1);
    expect(status.agentsMd).toBe(true);
  });

  test("repotruck_workspace_status reports an uninitialized root", async () => {
    const client = await connect();
    const bare = tempDir("repotruck-mcp-bare-");
    const status = jsonOf<{ initialized: boolean; preset: string | null }>(
      await call(client, "repotruck_workspace_status", { root: bare }),
    );
    expect(status.initialized).toBe(false);
    expect(status.preset).toBeNull();
  });

  test("repotruck_list_repos returns paths and honors the internal filter", async () => {
    const client = await connect();
    const all = jsonOf<{
      count: number;
      repos: Array<{ key: string; absolutePath: string; onDisk: boolean; language: string | null }>;
    }>(await call(client, "repotruck_list_repos", { root: wsRoot }));
    expect(all.count).toBe(2);
    expect(all.repos.every((repo) => repo.onDisk && path.isAbsolute(repo.absolutePath))).toBe(true);

    const internal = jsonOf<{ count: number; repos: Array<{ key: string }> }>(
      await call(client, "repotruck_list_repos", { root: wsRoot, internal: true }),
    );
    expect(internal.count).toBe(1);
    expect(internal.repos[0]!.key).toBe("acme/api");
  });

  test("repotruck_search_repos matches owner, path and language", async () => {
    const client = await connect();
    const byLanguage = jsonOf<{ repos: Array<{ key: string }> }>(
      await call(client, "repotruck_search_repos", { root: wsRoot, query: "gO" }),
    );
    expect(byLanguage.repos.map((repo) => repo.key)).toEqual(["octo/lib"]);

    const byPath = jsonOf<{ repos: Array<{ key: string }> }>(
      await call(client, "repotruck_search_repos", { root: wsRoot, query: "acme/source" }),
    );
    expect(byPath.repos.map((repo) => repo.key)).toEqual(["acme/api"]);
  });

  test("repotruck_resolve_repo resolves owner/name and errors with suggestions", async () => {
    const client = await connect();
    const resolved = jsonOf<{ repo: { key: string; relativePath: string; absolutePath: string } }>(
      await call(client, "repotruck_resolve_repo", { root: wsRoot, ref: "acme/api" }),
    );
    expect(resolved.repo.relativePath).toBe("acme/source/api");

    const missing = await call(client, "repotruck_resolve_repo", {
      root: wsRoot,
      ref: "acme/ap",
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("Did you mean");
  });

  test("repotruck_agents_md returns the raw workspace map", async () => {
    const client = await connect();
    const result = await call(client, "repotruck_agents_md", { root: wsRoot });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("# Repository Workspace Map");
    expect(textOf(result)).toContain("acme/source/api");
  });

  test("alias set, status and remove round-trip", async () => {
    const client = await connect();
    const set = jsonOf<{ ok: boolean; message: string }>(
      await call(client, "repotruck_alias_set", { root: wsRoot, alias: "api", repo: "acme/api" }),
    );
    expect(set.ok).toBe(true);

    const status = jsonOf<{ aliases: Record<string, string> }>(
      await call(client, "repotruck_workspace_status", { root: wsRoot }),
    );
    expect(status.aliases.api).toBe("acme/source/api");

    const removed = jsonOf<{ ok: boolean }>(
      await call(client, "repotruck_alias_remove", { root: wsRoot, alias: "api" }),
    );
    expect(removed.ok).toBe(true);

    const after = jsonOf<{ aliases: Record<string, string> }>(
      await call(client, "repotruck_workspace_status", { root: wsRoot }),
    );
    expect(after.aliases.api).toBeUndefined();
  });

  test("repotruck_move relocates a repository and marks it custom", async () => {
    const client = await connect();
    const moved = jsonOf<{ ok: boolean; message: string }>(
      await call(client, "repotruck_move", {
        root: wsRoot,
        repo: "acme/api",
        destination: "acme/custom/api",
      }),
    );
    expect(moved.ok).toBe(true);
    expect(existsSync(path.join(wsRoot, "acme", "custom", "api", "file.txt"))).toBe(true);
    expect(existsSync(path.join(wsRoot, "acme", "source", "api"))).toBe(false);
  });

  test("repotruck_reorganize dry-run plans without touching disk", async () => {
    const client = await connect();
    const result = jsonOf<{ dryRun: boolean; moved: Array<{ key: string }>; summary: string }>(
      await call(client, "repotruck_reorganize", {
        root: wsRoot,
        preset: "flat-by-owner",
        dryRun: true,
      }),
    );
    expect(result.dryRun).toBe(true);
    expect(result.moved.map((move) => move.key).sort()).toEqual(["acme/api", "octo/lib"]);
    expect(existsSync(path.join(wsRoot, "acme", "custom", "api", "file.txt"))).toBe(true);
  });

  test("tools that need a workspace reject unregistered roots", async () => {
    const client = await connect();
    const bare = tempDir("repotruck-mcp-bare2-");
    const result = await call(client, "repotruck_list_repos", { root: bare });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not a repotruck workspace");
  });

  test("repotruck_clone rejects malformed URLs before any network access", async () => {
    const client = await connect();
    const result = await call(client, "repotruck_clone", {
      root: wsRoot,
      url: "gitlab.com/owner/repo",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("invalid GitHub repository URL");
  });

  test("repotruck_sync requires org for scope org", async () => {
    const client = await connect();
    const result = await call(client, "repotruck_sync", { root: wsRoot, scope: "org" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("requires the org parameter");
  });

  test("repotruck_sync rejects an invalid preset before any network access", async () => {
    const client = await connect();
    const result = await call(client, "repotruck_sync", {
      root: wsRoot,
      preset: "bogus",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("invalid preset: bogus");
  });

  test("root resolution walks up from the server working directory", async () => {
    const nested = path.join(wsRoot, "acme", "source", "api");
    const client = await connect({ cwd: nested });
    const result = jsonOf<{ root: string; count: number }>(
      await call(client, "repotruck_list_repos", {}),
    );
    expect(result.root.toLowerCase()).toBe(wsRoot.toLowerCase());
    expect(result.count).toBe(2);
  });

  test("every tool carries complete annotations", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool.annotations ?? {}]));
    for (const tool of tools) {
      expect(tool.annotations).toBeDefined();
    }
    expect(byName.get("repotruck_sync")).toMatchObject({
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(byName.get("repotruck_clone")).toMatchObject({
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(byName.get("repotruck_search_github")).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(byName.get("repotruck_search_code")).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
    expect(byName.get("repotruck_forget")).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(byName.get("repotruck_prune")).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(byName.get("repotruck_archive")).toMatchObject({
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(byName.get("repotruck_status")).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
    expect(byName.get("repotruck_open")).toMatchObject({ idempotentHint: true });
    expect(byName.get("repotruck_move")).toMatchObject({ destructiveHint: true });
    expect(byName.get("repotruck_reorganize")).toMatchObject({ destructiveHint: true });
    expect(byName.get("repotruck_create")).toMatchObject({ openWorldHint: true });
    expect(byName.get("repotruck_list_repos")).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
  });

  test("repotruck_search_code finds symbols with kind filters and index stats", async () => {
    const client = await connect();
    const result = jsonOf<{
      root: string;
      count: number;
      matches: Array<{
        repo: string;
        path: string;
        line: number;
        kind: string;
        name: string;
        exported: boolean;
        formatted: string;
      }>;
      index: { built: boolean; filesIndexed: number; symbols: number };
    }>(await call(client, "repotruck_search_code", { root: wsRoot, pattern: "demohelper" }));
    expect(result.count).toBe(1);
    expect(result.matches[0]!.repo).toBe("acme/api");
    expect(result.matches[0]!.name).toBe("demoHelper");
    expect(result.matches[0]!.kind).toBe("function");
    expect(result.matches[0]!.exported).toBe(true);
    expect(result.matches[0]!.formatted).toContain("acme/api:");
    expect(result.index.filesIndexed).toBeGreaterThanOrEqual(1);
    expect(result.index.symbols).toBeGreaterThanOrEqual(2);

    const classes = jsonOf<{ count: number; matches: Array<{ name: string; kind: string }> }>(
      await call(client, "repotruck_search_code", {
        root: wsRoot,
        pattern: "demo",
        kind: "class",
      }),
    );
    expect(classes.matches.map((match) => match.name)).toEqual(["DemoInternal"]);
    expect(classes.matches.every((match) => match.kind === "class")).toBe(true);

    const none = jsonOf<{ count: number }>(
      await call(client, "repotruck_search_code", { root: wsRoot, pattern: "zzz-no-such-symbol" }),
    );
    expect(none.count).toBe(0);
  });

  test("repotruck_forget untracks a repository and is safe to repeat", async () => {
    const client = await connect();
    const forgotten = jsonOf<{ ok: boolean; message: string }>(
      await call(client, "repotruck_forget", { root: wsRoot, repo: "octo/lib" }),
    );
    expect(forgotten.ok).toBe(true);
    expect(existsSync(path.join(wsRoot, "community", "octo", "source", "lib"))).toBe(true);

    const status = jsonOf<{ totalRepos: number }>(
      await call(client, "repotruck_workspace_status", { root: wsRoot }),
    );
    expect(status.totalRepos).toBe(1);

    const again = await call(client, "repotruck_forget", { root: wsRoot, repo: "octo/lib" });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toContain("not tracked by repotruck");
  });

  test("repotruck_status reports per-repository git health", async () => {
    const client = await connect();
    const result = jsonOf<{
      root: string;
      lastSync: string | null;
      repos: Array<{ key: string; line: string }>;
    }>(await call(client, "repotruck_status", { root: wsRoot }));
    expect(result.repos.length).toBe(1);
    expect(result.repos[0]!.key).toBe("acme/api");
    expect(result.repos[0]!.line).toContain("not a git repository");
  });

  test("repotruck_prune and repotruck_archive reject unregistered roots before network access", async () => {
    const client = await connect();
    const bare = tempDir("repotruck-mcp-bare3-");
    const prune = await call(client, "repotruck_prune", { root: bare });
    expect(prune.isError).toBe(true);
    expect(textOf(prune)).toContain("not a repotruck workspace");
    const archive = await call(client, "repotruck_archive", { root: bare, repo: "a/b" });
    expect(archive.isError).toBe(true);
    expect(textOf(archive)).toContain("not a repotruck workspace");
  });

  test("repotruck_open rejects unknown apps with the detected list", async () => {
    const client = await connect();
    const result = await call(client, "repotruck_open", {
      root: wsRoot,
      repo: "acme/api",
      app: "definitely-not-an-app-xyz",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("unknown app: definitely-not-an-app-xyz");
  });

  test("repotruck_open launches a custom app detached and returns ok", async () => {
    writeFileSync(
      path.join(configDir, APPS_FILENAME),
      JSON.stringify([{ name: "rt-probe", command: process.execPath, args: ["--version"] }]),
      "utf8",
    );
    const client = await connect();
    const result = jsonOf<{ ok: boolean; app: string; message: string }>(
      await call(client, "repotruck_open", { root: wsRoot, repo: "acme/api", app: "rt-probe" }),
    );
    expect(result.ok).toBe(true);
    expect(result.app).toBe("rt-probe");
    expect(result.message).toContain("launched rt-probe");
  });

  test("exposes agents-md, inventory and tree resources over fixed URIs", async () => {
    const client = await connect({ cwd: path.join(wsRoot, "acme") });
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      "repotruck://agents-md",
      "repotruck://inventory",
      "repotruck://tree",
    ]);

    const agentsMd = await client.readResource({ uri: "repotruck://agents-md" });
    const agentsText = (agentsMd.contents[0] as { text: string }).text;
    expect(agentsText).toContain("# Repository Workspace Map");

    const inventory = await client.readResource({ uri: "repotruck://inventory" });
    const inventoryJson = JSON.parse((inventory.contents[0] as { text: string }).text) as {
      preset: string;
      repos: Array<{ owner: string; name: string }>;
    };
    expect(inventoryJson.preset).toBe("categorized");
    expect(inventoryJson.repos.map((repo) => `${repo.owner}/${repo.name}`)).toEqual(["acme/api"]);

    const tree = await client.readResource({ uri: "repotruck://tree" });
    const treeText = (tree.contents[0] as { text: string }).text;
    expect(treeText).toContain("acme/");
    expect(treeText).toContain("community/");
  });

  test("exposes sync-and-summarize and suggest-agent-rules prompts", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      "suggest-agent-rules",
      "sync-and-summarize",
    ]);

    const syncPrompt = await client.getPrompt({
      name: "sync-and-summarize",
      arguments: { scope: "org", org: "acme" },
    });
    const syncText = syncPrompt.messages[0]!.content as { type: string; text: string };
    expect(syncText.type).toBe("text");
    expect(syncText.text).toContain('scope "org"');
    expect(syncText.text).toContain('org "acme"');
    expect(syncText.text).toContain("repotruck_sync");

    const rulesPrompt = await client.getPrompt({ name: "suggest-agent-rules", arguments: {} });
    const rulesText = rulesPrompt.messages[0]!.content as { type: string; text: string };
    expect(rulesText.text).toContain("AGENTS.md");
    expect(rulesText.text).toContain("repotruck_list_repos");
  });

  test("progress sink forwards progressToken notifications through mcpReq.notify", async () => {
    const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
    const sink = progressSinkFromContext({
      mcpReq: {
        _meta: { progressToken: "tok-42" },
        notify: async (notification: { method: string; params: Record<string, unknown> }) => {
          sent.push(notification);
        },
      },
    });
    expect(sink).not.toBeNull();
    sink!(2, 5, "acme/api — cloning");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent).toEqual([
      {
        method: "notifications/progress",
        params: { progressToken: "tok-42", progress: 2, total: 5, message: "acme/api — cloning" },
      },
    ]);

    expect(progressSinkFromContext({ mcpReq: { notify: async () => {} } })).toBeNull();
    expect(progressSinkFromContext({})).toBeNull();
    expect(progressSinkFromContext(null)).toBeNull();
  });

  test("hub bridge maps repo progress events and ignores sync summaries", () => {
    const seen: Array<[number, number | undefined, string]> = [];
    const hub = createProgressHub();
    bridgeHubToSink(hub, (progress, total, message) => seen.push([progress, total, message]));
    hub.publish({
      key: "acme/api",
      owner: "acme",
      name: "api",
      phase: "cloning",
      index: 2,
      total: 5,
    });
    hub.publish({ kind: "sync-summary", done: 1, failed: 0, skipped: 0 });
    expect(seen).toEqual([[2, 5, "acme/api — cloning"]]);
  });
});

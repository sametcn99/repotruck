import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { type CallToolResult, InMemoryTransport } from "@modelcontextprotocol/server";
import { simpleGit } from "simple-git";
import { createRepotruckMcpServer, type McpServerOptions } from "../src/mcp/server.ts";
import type { RepotruckConfig } from "../src/services/config.ts";
import { updateWorkspace } from "../src/services/workspace.ts";

const tempRoots: string[] = [];
let configDir: string;
let savedConfigDir: string | undefined;
let env: Record<string, string | undefined>;
let wsRoot: string;
let bareRemoteUrl: string;
let syncRepoList: Array<Record<string, unknown>> = [];

function tempDir(prefix: string): string {
  const dir = (realpathSync.native ?? realpathSync)(mkdtempSync(path.join(tmpdir(), prefix)));
  tempRoots.push(dir);
  return dir;
}

function textOf(result: CallToolResult): string {
  return (result.content ?? [])
    .map((block) => (block.type === "text" ? (block as { text: string }).text : ""))
    .join("");
}

function jsonOf<T>(result: CallToolResult): T {
  return JSON.parse(textOf(result)) as T;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  progressToken?: string,
) {
  return (await client.callTool({
    name,
    arguments: args,
    ...(progressToken ? { _meta: { progressToken } } : {}),
  })) as CallToolResult;
}

const fakeGithub = {
  getUserLogin: async () => "acme",
  getActiveOrgs: async () => ["acme-org"],
  listUserRepos: async () => syncRepoList,
  listOrgRepos: async () => syncRepoList,
  getRepo: async (owner: string, name: string) => ({
    owner,
    name,
    description: "demo repo",
    isPrivate: false,
    isFork: false,
    isArchived: false,
    language: "TypeScript",
    stars: 5,
    httpsUrl: bareRemoteUrl,
    sshUrl: bareRemoteUrl,
    updatedAt: "2026-01-01T00:00:00Z",
  }),
  archiveRepo: async () => {
    throw new Error("archive permission denied");
  },
  searchRepos: async (q: string, l: number) => {
    fakeGithub.lastQuery = q;
    fakeGithub.lastLimit = l;
    return [
      {
        owner: "acme",
        name: "tool",
        description: "cli tool",
        language: "Go",
        stars: 50,
        isFork: false,
        isArchived: false,
        updatedAt: "2026-01-01",
        httpsUrl: "https://github.com/acme/tool.git",
      },
    ];
  },
  createRepo: async (name: string) => ({
    owner: "acme",
    name,
    description: null,
    isPrivate: true,
    isFork: false,
    isArchived: false,
    language: null,
    httpsUrl: "https://github.com/acme/new.git",
    sshUrl: "git@github.com:acme/new.git",
    updatedAt: null,
  }),
  lastQuery: "",
  lastLimit: 0,
};

async function connect(options: Partial<McpServerOptions> = {}): Promise<Client> {
  const server = await createRepotruckMcpServer({
    env,
    cwd: wsRoot,
    version: "0.0.0-test",
    toolContextOverrides: {
      requireAuth: async () => ({ token: "fake-tok", github: fakeGithub as never }),
    },
    ...options,
  });
  const client = new Client({ name: "repotruck-mcp-edge", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeAll(async () => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  configDir = tempDir("rt-mcp-edge-cfg-");
  process.env.REPOTRUCK_CONFIG_DIR = configDir;
  env = { REPOTRUCK_CONFIG_DIR: configDir, REPOTRUCK_TOKEN: "mcp-test-token" };

  wsRoot = tempDir("rt-mcp-edge-ws-");
  const bareDir = tempDir("rt-mcp-edge-bare-");
  const srcDir = tempDir("rt-mcp-edge-src-");
  const git = simpleGit(srcDir);
  await git.init(["-b", "main"]);
  await git.addConfig("user.email", "mcp@test.com");
  await git.addConfig("user.name", "MCP Test");
  writeFileSync(path.join(srcDir, "sample.txt"), "hello", "utf8");
  await git.add(".");
  await git.commit("init");
  await simpleGit().raw(["clone", "--bare", srcDir, bareDir]);
  bareRemoteUrl = `file:///${bareDir.replace(/\\/g, "/")}`;

  const config: RepotruckConfig = {
    version: 1,
    root: wsRoot,
    preset: "categorized",
    lastSync: null,
    pinned: ["acme/api"],
    profiles: {
      backend: ["acme/api"],
    },
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
    ],
  };
  const apiDir = path.join(wsRoot, "acme", "source", "api");
  mkdirSync(apiDir, { recursive: true });
  writeFileSync(
    path.join(apiDir, "index.ts"),
    "export const ok = 1;\nexport function findMe() {}\n",
    "utf8",
  );
  const gApi = simpleGit(apiDir);
  await gApi.init(["-b", "main"]);
  await gApi.addConfig("user.email", "mcp@test.com");
  await gApi.addConfig("user.name", "MCP Test");
  await gApi.addRemote("origin", bareRemoteUrl);
  await gApi.add(".");
  await gApi.commit("initial in api");

  await updateWorkspace(wsRoot, () => ({ config, result: undefined }), env);
});

afterAll(() => {
  if (savedConfigDir === undefined) delete process.env.REPOTRUCK_CONFIG_DIR;
  else process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("MCP tools edge cases", () => {
  test("repotruck_search_github with structured qualifiers and plain query", async () => {
    const client = await connect();
    const res = jsonOf<{ query: string; count: number; repos: Array<{ key: string }> }>(
      await call(client, "repotruck_search_github", {
        query: "cli",
        org: "acme",
        lang: "Go",
        minStars: 20,
        topics: ["tools"],
        limit: 5,
      }),
    );

    expect(res.count).toBe(1);
    expect(res.repos[0]!.key).toBe("acme/tool");
    expect(fakeGithub.lastQuery).toContain("cli org:acme language:Go stars:>=20 topic:tools");
    expect(fakeGithub.lastLimit).toBe(5);

    await call(client, "repotruck_search_github", { query: "simple term" });
    expect(fakeGithub.lastQuery).toBe("simple term");
  });

  test("repotruck_sync empty match and local bare clone with include/exclude/limit + progress", async () => {
    const client = await connect();
    const emptyRes = jsonOf<{ summary: string; synced: unknown[] }>(
      await call(client, "repotruck_sync", { root: wsRoot, scope: "user" }),
    );
    expect(emptyRes.synced).toEqual([]);
    expect(emptyRes.summary).toContain("0 synced");

    syncRepoList = [
      {
        owner: "acme",
        name: "synced-one",
        description: "one",
        isPrivate: false,
        isFork: false,
        isArchived: false,
        language: "TypeScript",
        stars: 1,
        httpsUrl: bareRemoteUrl,
        sshUrl: bareRemoteUrl,
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        owner: "acme",
        name: "excluded-two",
        description: "two",
        isPrivate: false,
        isFork: false,
        isArchived: false,
        language: "Go",
        stars: 1,
        httpsUrl: bareRemoteUrl,
        sshUrl: bareRemoteUrl,
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const syncRes = jsonOf<{ summary: string; synced: Array<{ key: string }> }>(
      await call(
        client,
        "repotruck_sync",
        {
          root: wsRoot,
          scope: "all",
          include: ["acme/*"],
          exclude: ["acme/excluded-*"],
          limit: 5,
        },
        "sync-tok-1",
      ),
    );
    syncRepoList = [];
    expect(syncRes.synced.some((s) => s.key === "acme/synced-one")).toBe(true);
    expect(syncRes.synced.some((s) => s.key === "acme/excluded-two")).toBe(false);
  });

  test("repotruck_clone clones local bare remote and reports progress", async () => {
    const client = await connect();
    const cloneRes = jsonOf<{ key: string; relativePath: string; preset: string }>(
      await call(
        client,
        "repotruck_clone",
        {
          url: "https://github.com/acme/cloned-demo",
          root: wsRoot,
        },
        "clone-tok-1",
      ),
    );
    expect(cloneRes.key).toBe("acme/cloned-demo");
    expect(cloneRes.relativePath).toContain("cloned-demo");
  });

  test("repotruck_create validation: invalid name and missing source directory", async () => {
    const client = await connect();
    const badName = await call(client, "repotruck_create", { root: wsRoot, name: ".leading-dot" });
    expect(badName.isError).toBe(true);
    expect(textOf(badName)).toContain("invalid repository name");

    const badFrom = await call(client, "repotruck_create", {
      root: wsRoot,
      name: "valid-name",
      from: path.join(wsRoot, "nonexistent-dir-xyz"),
    });
    expect(badFrom.isError).toBe(true);
    expect(textOf(badFrom)).toContain("source directory does not exist");
  });

  test("repotruck_search_code searches across workspace repos and respects text mode", async () => {
    const client = await connect();
    const hitRes = jsonOf<{ matches: Array<{ path: string; line: number }>; count: number }>(
      await call(client, "repotruck_search_code", {
        root: wsRoot,
        pattern: "findMe",
      }),
    );
    expect(hitRes.count).toBeGreaterThanOrEqual(1);
    expect(hitRes.matches.some((m) => m.path.includes("index.ts"))).toBe(true);

    const textRes = jsonOf<{ matches: Array<{ file: string; line: number }>; count: number }>(
      await call(client, "repotruck_search_code", {
        root: wsRoot,
        pattern: "export const ok",
        text: true,
      }),
    );
    expect(textRes.count).toBeGreaterThanOrEqual(1);
  });

  test("repotruck_run executes commands inside repo directory", async () => {
    const client = await connect();
    const runRes = jsonOf<{
      results: Array<{ key: string; ok: boolean; exitCode: number; stdout: string }>;
    }>(
      await call(client, "repotruck_run", {
        root: wsRoot,
        repos: ["acme/api"],
        command: "git",
        args: ["branch", "--show-current"],
      }),
    );
    expect(runRes.results.length).toBe(1);
    expect(runRes.results[0]!.ok).toBe(true);
    expect(runRes.results[0]!.exitCode).toBe(0);
    expect(runRes.results[0]!.stdout.trim()).toBe("main");
  });

  test("repotruck_reorganize with scan=true and dryRun=true previews adoptions", async () => {
    const client = await connect();
    const unmanagedDir = path.join(wsRoot, "unmanaged-box");
    mkdirSync(unmanagedDir, { recursive: true });
    const uGit = simpleGit(unmanagedDir);
    await uGit.init(["-b", "main"]);
    await uGit.addRemote("origin", "https://github.com/acme/unmanaged-box.git");

    const reorgRes = jsonOf<{
      moved: unknown[];
      dryRun: boolean;
      summary: string;
    }>(
      await call(client, "repotruck_reorganize", {
        root: wsRoot,
        preset: "flat",
        scan: true,
        dryRun: true,
      }),
    );
    expect(reorgRes.dryRun).toBe(true);
    expect(typeof reorgRes.summary).toBe("string");
  });

  test("repotruck_alias_set, remove, resolve, list_repos filters, and status detail", async () => {
    const client = await connect();
    const setRes = jsonOf<{ ok: boolean; message: string }>(
      await call(client, "repotruck_alias_set", {
        root: wsRoot,
        alias: "core-api",
        repo: "acme/api",
      }),
    );
    expect(setRes.ok).toBe(true);

    const resolveRes = jsonOf<{
      repo: { key: string; relativePath: string; absolutePath: string };
    }>(
      await call(client, "repotruck_resolve_repo", {
        root: wsRoot,
        ref: "core-api",
      }),
    );
    expect(resolveRes.repo.key).toBe("acme/api");
    expect(resolveRes.repo.absolutePath).toContain("api");

    const listFiltered = jsonOf<{
      count: number;
      totalCount: number;
      repos: Array<{ key: string }>;
    }>(
      await call(client, "repotruck_list_repos", {
        root: wsRoot,
        internal: true,
        category: "source",
        custom: false,
        pinned: true,
        profile: "backend",
        limit: 1,
        offset: 0,
      }),
    );
    expect(listFiltered.repos.some((r) => r.key === "acme/api")).toBe(true);

    const badProfile = await call(client, "repotruck_list_repos", {
      root: wsRoot,
      profile: "no-such-profile",
    });
    expect(badProfile.isError).toBe(true);

    const statusRes = jsonOf<{ repos: unknown[] }>(
      await call(client, "repotruck_status", { root: wsRoot, detail: true, pinned: true }),
    );
    expect(statusRes.repos.length).toBeGreaterThanOrEqual(1);

    const rmAlias = jsonOf<{ ok: boolean }>(
      await call(client, "repotruck_alias_remove", { root: wsRoot, alias: "core-api" }),
    );
    expect(rmAlias.ok).toBe(true);

    const rmMissing = await call(client, "repotruck_alias_remove", {
      root: wsRoot,
      alias: "nonexistent-alias",
    });
    expect(rmMissing.isError).toBe(true);
  });

  test("repotruck_stats, repotruck_doctor, prune, archive error, delete, and workspaces_remove", async () => {
    const client = await connect();

    const statsRes = jsonOf<{ root: string }>(
      await call(client, "repotruck_stats", { root: wsRoot }),
    );
    expect(statsRes.root).toBe(wsRoot);

    const docRes = await call(client, "repotruck_doctor", {});
    expect(textOf(docRes)).toContain("checks");

    const pruneRes = jsonOf<{ ok: boolean; message: string }>(
      await call(client, "repotruck_prune", { root: wsRoot, dryRun: true }),
    );
    expect(pruneRes.ok).toBe(true);

    const archErr = await call(client, "repotruck_archive", {
      root: wsRoot,
      repo: "acme/api",
    });
    expect(archErr.isError).toBe(true);

    const delRes = jsonOf<{ ok: boolean }>(
      await call(client, "repotruck_delete", {
        root: wsRoot,
        repo: "acme/cloned-demo",
        confirm: "yes",
      }),
    );
    expect(delRes.ok).toBe(true);

    const tempWs = tempDir("rt-mcp-rm-ws-");
    await updateWorkspace(
      tempWs,
      () => ({
        config: { version: 1, root: tempWs, preset: "flat", lastSync: null, repos: [] },
        result: undefined,
      }),
      env,
    );
    const rmWs = jsonOf<{ ok: boolean; removed: string }>(
      await call(client, "repotruck_workspaces_remove", { path: tempWs }),
    );
    expect(rmWs.ok).toBe(true);
    expect(rmWs.removed).toBe(tempWs);

    const rmWsMissing = await call(client, "repotruck_workspaces_remove", {
      path: path.join(wsRoot, "not-a-ws"),
    });
    expect(rmWsMissing.isError).toBe(true);

    const missingAgents = await call(client, "repotruck_agents_md", {
      root: path.join(wsRoot, "no-agents-here"),
    });
    expect(missingAgents.isError).toBe(true);
  });

  test("fixed resources and prompts work end to end", async () => {
    const client = await connect();

    const mdRes = await client.readResource({ uri: "repotruck://agents-md" });
    expect((mdRes.contents[0] as { text?: string }).text).toContain("acme/api");

    const invRes = await client.readResource({ uri: "repotruck://inventory" });
    expect((invRes.contents[0] as { text?: string }).text).toContain("categorized");

    const treeRes = await client.readResource({ uri: "repotruck://tree" });
    expect((treeRes.contents[0] as { text?: string }).text).toContain(wsRoot);

    const uninitClient = await connect({ cwd: tempDir("rt-uninit-cwd-") });
    await expect(uninitClient.readResource({ uri: "repotruck://inventory" })).rejects.toThrow();

    const prompt1 = await client.getPrompt({
      name: "sync-and-summarize",
      arguments: { root: wsRoot, scope: "org", org: "acme-org" },
    });
    expect((prompt1.messages[0]!.content as { text: string }).text).toContain("acme-org");

    const prompt2 = await client.getPrompt({
      name: "suggest-agent-rules",
      arguments: { root: wsRoot },
    });
    expect((prompt2.messages[0]!.content as { text: string }).text).toContain("AGENTS.md");
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repoRoot = path.join(import.meta.dir, "..");
const cleanupDirs: string[] = [];
let client: Client;

beforeAll(async () => {
  const configDir = mkdtempSync(path.join(tmpdir(), "repotruck-mcp-e2e-cfg-"));
  cleanupDirs.push(configDir);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, "src", "cli.ts"), "mcp"],
    env: {
      ...process.env,
      REPOTRUCK_CONFIG_DIR: configDir,
      GH_TOKEN: "ghp_fake_token_for_tests",
      NO_COLOR: "1",
    },
    stderr: "pipe",
  });
  client = new Client({ name: "repotruck-mcp-e2e", version: "0.0.0" });
  await client.connect(transport);
}, 30000);

afterAll(async () => {
  await client.close();
  for (const dir of cleanupDirs) {
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

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("");
}

describe("repotruck MCP server over a real stdio subprocess", () => {
  test("handshakes and exposes the full tool, resource and prompt surface", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());

    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      "repotruck://agents-md",
      "repotruck://inventory",
      "repotruck://tree",
    ]);

    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      "suggest-agent-rules",
      "sync-and-summarize",
    ]);
  }, 30000);

  test("REPOTRUCK_CONFIG_DIR isolates the child from the user's workspaces", async () => {
    const result = (await client.callTool({
      name: "repotruck_list_workspaces",
      arguments: {},
    })) as { content?: Array<{ type: string; text?: string }> };
    const parsed = JSON.parse(textOf(result)) as {
      workspaces: Array<{ path: string }>;
    };
    expect(parsed.workspaces).toEqual([]);
  }, 30000);

  test("business failures return isError results, not exceptions", async () => {
    const result = (await client.callTool({
      name: "repotruck_workspace_status",
      arguments: { root: path.join(tmpdir()) },
    })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
    expect(result.isError).toBeUndefined();
  }, 30000);

  test("schema violations come back as isError:true with the validation message", async () => {
    const result = (await client.callTool({
      name: "repotruck_search_repos",
      arguments: { root: path.join(tmpdir()), query: 123 },
    })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Invalid");
  }, 30000);
});

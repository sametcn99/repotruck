import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createRepotruckMcpServer } from "../src/mcp/server.ts";
import { MCP_PROMPT_CATALOG, MCP_TOOL_CATALOG } from "../src/mcp/toolCatalog.ts";

/**
 * The catalog feeds the AGENTS.md MCP guide; this keeps it welded to the
 * server's actual registrations — names AND descriptions — so the guide can
 * never advertise a tool that drifted away.
 */

const tempRoots: string[] = [];
let savedConfigDir: string | undefined;
let cwd: string;

function tempDir(prefix: string): string {
  const dir = (realpathSync.native ?? realpathSync)(mkdtempSync(path.join(tmpdir(), prefix)));
  tempRoots.push(dir);
  return dir;
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  const configDir = tempDir("repotruck-catalog-cfg-");
  process.env.REPOTRUCK_CONFIG_DIR = configDir;
  cwd = tempDir("repotruck-catalog-cwd-");
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

async function connect(): Promise<Client> {
  const server = await createRepotruckMcpServer({
    env: { REPOTRUCK_CONFIG_DIR: process.env.REPOTRUCK_CONFIG_DIR },
    cwd,
    version: "0.0.0-test",
  });
  const client = new Client({ name: "repotruck-catalog-tests", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("MCP tool catalog drift", () => {
  test("registered tools match the catalog exactly (names and descriptions)", async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    const registered = new Map(tools.map((tool) => [tool.name, tool.description]));
    const catalog = new Map(MCP_TOOL_CATALOG.map((tool) => [tool.name, tool.description]));

    expect([...registered.keys()].sort()).toEqual([...catalog.keys()].sort());
    for (const [name, description] of catalog) {
      expect(registered.get(name), `description drift for ${name}`).toBe(description);
    }
  });

  test("registered prompts match the catalog exactly", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();

    const registeredNames = prompts.map((prompt) => prompt.name).sort();
    const catalogNames = MCP_PROMPT_CATALOG.map((prompt) => prompt.name).sort();
    expect(registeredNames).toEqual(catalogNames);

    const byName = new Map(prompts.map((prompt) => [prompt.name, prompt.description]));
    for (const prompt of MCP_PROMPT_CATALOG) {
      expect(byName.get(prompt.name), `description drift for ${prompt.name}`).toBe(
        prompt.description,
      );
    }
  });

  test("catalog has no duplicate names", () => {
    const names = MCP_TOOL_CATALOG.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

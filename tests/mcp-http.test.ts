import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createRepotruckHttpHandler,
  MCP_HTTP_DEFAULT_HOST,
  MCP_HTTP_DEFAULT_PORT,
  validateHttpBindOptions,
} from "../src/mcp/server.ts";

const cleanupDirs: string[] = [];
let configDir: string;
let savedConfigDir: string | undefined;
let env: Record<string, string | undefined>;
let plainHandler: ReturnType<typeof createRepotruckHttpHandler>;
let tokenHandler: ReturnType<typeof createRepotruckHttpHandler>;

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "repotruck-mcp-http-tests", version: "0.0.0" },
  },
};

function post(
  handler: ReturnType<typeof createRepotruckHttpHandler>,
  headers: Record<string, string>,
  body: unknown = INITIALIZE_BODY,
): Promise<Response> {
  return handler.fetch(
    new Request("http://127.0.0.1:3100/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

async function rpc(response: Response): Promise<{
  status: number;
  json: {
    result?: { serverInfo?: { name?: string }; tools?: Array<{ name: string }> };
    error?: { message?: string };
  } | null;
}> {
  const text = await response.text();
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
  let json: unknown = null;
  try {
    json = JSON.parse(dataLine !== undefined ? dataLine.slice("data: ".length) : text);
  } catch {
    json = null;
  }
  return { status: response.status, json: json as Record<string, unknown> | null };
}

beforeAll(() => {
  savedConfigDir = process.env.REPOTRUCK_CONFIG_DIR;
  configDir = mkdtempSync(path.join(tmpdir(), "repotruck-mcp-http-cfg-"));
  cleanupDirs.push(configDir);
  process.env.REPOTRUCK_CONFIG_DIR = configDir;
  env = { REPOTRUCK_CONFIG_DIR: configDir, GH_TOKEN: "fake", NO_COLOR: "1" };
  plainHandler = createRepotruckHttpHandler({ env, version: "0.0.0-test" });
  tokenHandler = createRepotruckHttpHandler({ env, version: "0.0.0-test", token: "sekret" });
});

afterAll(() => {
  if (savedConfigDir === undefined) {
    delete process.env.REPOTRUCK_CONFIG_DIR;
  } else {
    process.env.REPOTRUCK_CONFIG_DIR = savedConfigDir;
  }
  for (const dir of cleanupDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("HTTP bind validation", () => {
  test("defaults are localhost without a token", () => {
    expect(MCP_HTTP_DEFAULT_HOST).toBe("127.0.0.1");
    expect(MCP_HTTP_DEFAULT_PORT).toBe(3000);
    expect(validateHttpBindOptions(undefined, undefined)).toBeNull();
    expect(validateHttpBindOptions("localhost", undefined)).toBeNull();
    expect(validateHttpBindOptions("127.0.0.1", undefined)).toBeNull();
    expect(validateHttpBindOptions("::1", undefined)).toBeNull();
  });

  test("non-localhost hosts require a token", () => {
    const problem = validateHttpBindOptions("0.0.0.0", undefined);
    expect(problem).toContain("--token");
    expect(problem).toContain("0.0.0.0");
    expect(validateHttpBindOptions("0.0.0.0", "sekret")).toBeNull();
    expect(validateHttpBindOptions("10.1.2.3", "sekret")).toBeNull();
    expect(validateHttpBindOptions("  ", undefined)).toContain("--host");
  });
});

describe("tokenless HTTP handler (localhost guards)", () => {
  test("serves initialize for an allowed localhost host", async () => {
    const { status, json } = await rpc(await post(plainHandler, { host: "127.0.0.1:3100" }));
    expect(status).toBe(200);
    expect(json?.result?.serverInfo?.name).toBe("repotruck");
  });

  test("rejects a missing Host header with 403", async () => {
    const { status, json } = await rpc(await post(plainHandler, {}));
    expect(status).toBe(403);
    expect(json?.error?.message).toContain("Host");
  });

  test("rejects a non-localhost Host header with 403 (DNS rebinding guard)", async () => {
    const { status, json } = await rpc(await post(plainHandler, { host: "evil.example" }));
    expect(status).toBe(403);
    expect(json?.error?.message).toContain("evil.example");
  });

  test("rejects a non-localhost Origin header with 403", async () => {
    const { status } = await rpc(
      await post(plainHandler, { host: "127.0.0.1:3100", origin: "https://evil.example" }),
    );
    expect(status).toBe(403);
  });
});

describe("token-protected HTTP handler (non-localhost bind)", () => {
  test("rejects requests without credentials with 401", async () => {
    const response = await post(tokenHandler, { host: "10.0.0.5:3100" });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  test("rejects a wrong bearer token with 401", async () => {
    const response = await post(tokenHandler, {
      host: "10.0.0.5:3100",
      authorization: "Bearer wrong",
    });
    expect(response.status).toBe(401);
  });

  test("accepts the correct bearer token and skips the localhost-only guards", async () => {
    const { status, json } = await rpc(
      await post(tokenHandler, {
        host: "10.0.0.5:3100",
        authorization: "Bearer sekret",
      }),
    );
    expect(status).toBe(200);
    expect(json?.result?.serverInfo?.name).toBe("repotruck");
  });
});

describe("HTTP handler serves tools over the stateless leg", () => {
  test("tools/list returns the full surface", async () => {
    const { status, json } = await rpc(
      await post(
        tokenHandler,
        { host: "10.0.0.5:3100", authorization: "Bearer sekret" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        },
      ),
    );
    expect(status).toBe(200);
    const names = (json?.result?.tools ?? []).map((tool) => tool.name);
    expect(names.length).toBe(25);
    expect(names).toContain("repotruck_forget");
    expect(names).toContain("repotruck_open");
    expect(names).toContain("repotruck_search_code");
  });
});

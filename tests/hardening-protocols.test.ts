import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import { startRepotruckMcpHttpServer } from "../src/mcp/server.ts";
import { beginDeviceLogin } from "../src/services/auth.ts";
import { GitHubService } from "../src/services/github.ts";
import { retryAfterHeaderSeconds, withRateLimitRetry } from "../src/services/rateLimit.ts";
import { waitUntil, workspaceFixture } from "./helpers/hardening.ts";

const fixtures: ReturnType<typeof workspaceFixture>[] = [];
function fixture() {
  const f = workspaceFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "hardening", version: "1" },
  },
};
const headers = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

describe("SDK, protocol and process boundaries", () => {
  test("[E42] real Octokit retries page two without duplicating or re-fetching page one", async () => {
    const pages: number[] = [];
    let rejected = false;
    const octokit = new Octokit({
      request: {
        fetch: async (input: string | URL | Request) => {
          const page = Number(new URL(String(input)).searchParams.get("page"));
          pages.push(page);
          if (page === 2 && !rejected) {
            rejected = true;
            return json({ message: "rate limited" }, 429, { "retry-after": "0" });
          }
          return json(
            Array.from({ length: page === 1 ? 100 : 1 }, (_, i) => ({
              name: `repo-${(page - 1) * 100 + i}`,
              owner: { login: "acme" },
            })),
          );
        },
      },
    });
    const repos = await new GitHubService("unused", { octokit }).listUserRepos();
    expect(pages).toEqual([1, 2, 2]);
    expect(repos.length).toBe(101);
    expect(new Set(repos.map((repo) => repo.name)).size).toBe(101);
  });

  test("[E43] SDK permission 403 with a future reset and remaining budget is never retried", async () => {
    let calls = 0;
    const octokit = new Octokit({
      request: {
        fetch: async () => {
          calls++;
          return json({ message: "Resource not accessible" }, 403, {
            "x-ratelimit-remaining": "10",
            "x-ratelimit-reset": "9999999999",
          });
        },
      },
    });
    await expect(
      new GitHubService("unused", {
        octokit,
        retry: {
          sleep: async () => {
            throw new Error("unexpected retry");
          },
        },
      }).getUserLogin(),
    ).rejects.toThrow("Resource not accessible");
    expect(calls).toBe(1);
  });

  test("[E44] retry headers handle dates, fractions, past resets, junk and bounded extreme values", async () => {
    const now = () => Date.UTC(2026, 0, 1);
    const error = (value: string) => ({
      status: 429,
      response: { headers: { "Retry-After": value } },
    });
    expect(retryAfterHeaderSeconds(error("0.5"), now)).toBe(0.5);
    expect(retryAfterHeaderSeconds(error(new Date(now() + 2000).toUTCString()), now)).toBe(2);
    expect(retryAfterHeaderSeconds(error(new Date(now() - 2000).toUTCString()), now)).toBe(0);
    for (const value of ["", "-1", "Infinity", "1junk", "soon"])
      expect(retryAfterHeaderSeconds(error(value), now)).toBeNull();
    const sleeps: number[] = [];
    let calls = 0;
    expect(
      await withRateLimitRetry(
        async () => {
          if (!calls++) throw error("999999999999999999999");
          return "ok";
        },
        {
          now,
          sleep: async (ms) => {
            sleeps.push(ms);
          },
          maxHeaderWaitMs: 123,
        },
      ),
    ).toBe("ok");
    expect(sleeps).toEqual([123]);
    for (const value of [NaN, Infinity, -1, 0.5])
      await expect(withRateLimitRetry(async () => 1, { maxNetworkRetries: value })).rejects.toThrow(
        "integer",
      );
    calls = 0;
    sleeps.length = 0;
    await withRateLimitRetry(
      async () => {
        if (!calls++) throw { status: 403, response: { headers: { "x-ratelimit-reset": "1" } } };
        return 1;
      },
      {
        now,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    expect(sleeps).toEqual([]);
  });

  test("[E45] ambiguous create POST transport failure performs exactly one request", async () => {
    let calls = 0;
    const octokit = new Octokit({
      request: {
        fetch: async () => {
          calls++;
          throw Object.assign(new Error("connection reset after server accepted POST"), {
            code: "ECONNRESET",
          });
        },
      },
    });
    await expect(
      new GitHubService("unused", { octokit }).createRepo("api", { private: true }),
    ).rejects.toThrow("connection reset");
    expect(calls).toBe(1);
  });

  test("[E46] actual HTTP sockets enforce authorization, Host, Origin, JSON and request size", async () => {
    const f = fixture();
    await f.save();
    const before = readFileSync(path.join(f.configDir, "repotruck.json"), "utf8");
    await expect(startRepotruckMcpHttpServer({ token: "  ", port: 0 })).rejects.toThrow("empty");
    const server = await startRepotruckMcpHttpServer({ port: 0, env: f.env });
    try {
      const post = (body: string, extra = {}) =>
        fetch(server.url, { method: "POST", headers: { ...headers, ...extra }, body });
      expect((await post(JSON.stringify(initialize), { host: "attacker.example" })).status).toBe(
        403,
      );
      expect(
        (await post(JSON.stringify(initialize), { origin: "https://attacker.example" })).status,
      ).toBe(403);
      expect((await post("{")).status).toBe(400);
      expect((await post("x".repeat(1024 * 1024 + 1))).status).toBe(413);
      expect((await post(JSON.stringify(initialize))).status).toBe(200);
    } finally {
      await server.close();
      await server.close();
    }
    const secured = await startRepotruckMcpHttpServer({
      port: 0,
      env: f.env,
      token: "local-secret",
    });
    try {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "repotruck_alias_set",
          arguments: { root: f.root, repo: "acme/api", alias: "changed" },
        },
      });
      expect((await fetch(secured.url, { method: "POST", headers, body })).status).toBe(401);
      expect(
        (
          await fetch(secured.url, {
            method: "POST",
            headers: { ...headers, authorization: "Bearer local-secret" },
            body: JSON.stringify(initialize),
          })
        ).status,
      ).toBe(200);
      expect(readFileSync(path.join(f.configDir, "repotruck.json"), "utf8")).toBe(before);
    } finally {
      await secured.close();
    }
    const ipv6 = await startRepotruckMcpHttpServer({ host: "::1", port: 0, env: f.env });
    try {
      expect(
        (await fetch(ipv6.url, { method: "POST", headers, body: JSON.stringify(initialize) }))
          .status,
      ).toBe(200);
    } finally {
      await ipv6.close();
    }
  });

  test("[E47] malformed stdio input is followed by a valid handshake and usable tool list", async () => {
    const f = fixture();
    const child = spawn(process.execPath, ["src/cli.ts", "mcp"], {
      cwd: path.join(import.meta.dir, ".."),
      env: { ...process.env, ...f.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    try {
      child.stdin.write("not-json\n");
      child.stdin.write(`${JSON.stringify(initialize)}\n`);
      await waitUntil(() => stdout.includes('"id":1'), 10000);
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
      await waitUntil(() => stdout.includes('"id":2'), 10000);
      const messages = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(messages.find((message) => message.id === 2).result.tools.length).toBe(25);
      expect(stdout).not.toContain("listening");
    } finally {
      child.stdin.end();
      child.kill();
      await new Promise<void>((resolve) => child.once("close", () => resolve()));
    }
    expect(stderr).not.toContain("Unhandled");
  }, 20000);

  test("[E48] HTTP CLI survives two seconds and SIGTERM closes a stalled client within a bound", async () => {
    const f = fixture();
    const child = spawn(process.execPath, ["src/cli.ts", "mcp", "--http", "--port", "0"], {
      cwd: path.join(import.meta.dir, ".."),
      env: { ...process.env, ...f.env, REPOTRUCK_MCP_DEBUG_SHUTDOWN: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.info(`[E48] test runtime=bun ${Bun.version}`);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => console.info(`[E48 child] ${String(chunk).trim()}`));
    console.info("[E48] stage=wait-listening");
    let socket: ReturnType<typeof connect> | undefined;
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    try {
      await waitUntil(() => output.includes("listening on"), 10000);
      console.info("[E48] stage=listening");
      const url = new URL(output.match(/http:\/\/[^\s]+/)![0]);
      await new Promise((resolve) => setTimeout(resolve, 2200));
      console.info("[E48] stage=uptime-confirmed");
      expect(child.exitCode).toBeNull();
      socket = connect(Number(url.port), url.hostname);
      socket.on("error", () => {});
      let connectDeadline: ReturnType<typeof setTimeout> | undefined;
      const connected = await Promise.race([
        new Promise<boolean>((resolve) => socket!.once("connect", () => resolve(true))),
        new Promise<boolean>((resolve) => {
          connectDeadline = setTimeout(() => resolve(false), 1000);
        }),
      ]);
      clearTimeout(connectDeadline);
      expect(connected).toBe(true);
      console.info("[E48] stage=socket-connected");
      socket.write(
        `POST / HTTP/1.1\r\nHost: ${url.host}\r\nContent-Length: 100000\r\nContent-Type: application/json\r\n\r\n{`,
      );
      console.info("[E48] stage=partial-request-sent");
      const start = Date.now();
      child.kill("SIGTERM");
      console.info("[E48] stage=sigterm-sent");
      let exitDeadline: ReturnType<typeof setTimeout> | undefined;
      const exitedInBound = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) => {
          exitDeadline = setTimeout(() => resolve(false), 1500);
        }),
      ]);
      clearTimeout(exitDeadline);
      expect(exitedInBound).toBe(true);
      console.info(`[E48] stage=child-closed elapsed=${Date.now() - start}ms`);
      expect(Date.now() - start).toBeLessThan(1500);
      console.info("[E48] stage=port-refusal-check");
      const portRefused = await new Promise<boolean>((resolve) => {
        const probe = connect(Number(url.port), url.hostname);
        const timer = setTimeout(() => {
          probe.destroy();
          resolve(false);
        }, 1000);
        probe.once("connect", () => {
          clearTimeout(timer);
          probe.destroy();
          resolve(false);
        });
        probe.once("error", (error: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          resolve(error.code === "ECONNREFUSED");
        });
      });
      expect(portRefused).toBe(true);
      console.info("[E48] stage=port-refused");
    } finally {
      socket?.destroy();
      child.kill("SIGKILL");
      let cleanupDeadline: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        exited,
        new Promise((resolve) => {
          cleanupDeadline = setTimeout(resolve, 2000);
        }),
      ]);
      clearTimeout(cleanupDeadline);
    }
  }, 20000);

  test("[E49] cancelling real device exchange prevents a late token from reaching the auth cache", async () => {
    const f = fixture();
    const controller = new AbortController();
    let complete!: (value: unknown) => void;
    const request = Object.assign(
      async (route: string) =>
        route.includes("device/code")
          ? {
              data: {
                device_code: "device",
                user_code: "CODE",
                verification_uri: "https://github.com/login/device",
                expires_in: 900,
                interval: 0,
              },
            }
          : await new Promise((resolve) => {
              complete = resolve;
            }),
      { endpoint: { DEFAULTS: { baseUrl: "https://github.com" } } },
    );
    const handle = await beginDeviceLogin({
      env: { ...f.env, REPOTRUCK_OAUTH_CLIENT_ID: "test-client" },
      signal: controller.signal,
      requestImpl: request,
    });
    await waitUntil(() => complete !== undefined);
    controller.abort();
    complete({ data: { access_token: "late-secret", token_type: "bearer", scope: "repo" } });
    await expect(handle.completion).rejects.toThrow();
    expect(existsSync(path.join(f.configDir, "auth.json"))).toBe(false);
  });

  test("[E48] closing HTTP stops a real in-flight run child that ignores SIGTERM", async () => {
    const f = fixture();
    await f.save();
    const marker = path.join(f.base, "run-child.pid");
    const server = await startRepotruckMcpHttpServer({ port: 0, env: f.env });
    let pid: number | undefined;
    const request = fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 80,
        method: "tools/call",
        params: {
          name: "repotruck_run",
          arguments: {
            root: f.root,
            repos: ["acme/api"],
            command: Bun.which("node")!,
            args: [
              "-e",
              `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`,
            ],
          },
        },
      }),
    })
      .then((response) => response.text())
      .catch(() => "closed");
    try {
      await waitUntil(() => existsSync(marker), 5000);
      pid = Number(readFileSync(marker, "utf8"));
      const started = Date.now();
      await server.close();
      expect(Date.now() - started).toBeLessThan(1000);
      await waitUntil(() => {
        try {
          process.kill(pid!, 0);
          return false;
        } catch {
          return true;
        }
      }, 2000);
      await request;
    } finally {
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      await server.close();
    }
  }, 12000);
});

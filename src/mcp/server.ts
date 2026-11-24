import { createServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createToolContext, type ToolContext } from "./toolContext.ts";

export type { ProgressSink } from "./toolHelpers.ts";
// Re-exported helpers that previously lived in this module (tests and external
// consumers import them from here).
export { bridgeHubToSink, progressSinkFromContext } from "./toolHelpers.ts";

import { timingSafeEqual } from "node:crypto";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { firstErrorLine } from "../services/cloner.ts";
import type { EnvLike } from "../services/config.ts";
import { closeProcessScope } from "../services/processScope.ts";
import { readVersion } from "../services/version.ts";
import { registerAliasesTools } from "./tools/aliases.ts";
import { registerGithubTools } from "./tools/github.ts";
import { registerLifecycleTools } from "./tools/lifecycle.ts";
import { registerPrompts } from "./tools/prompts.ts";
import { registerReposTools } from "./tools/repos.ts";
import { registerSearchTools } from "./tools/search.ts";
import { registerSyncTools } from "./tools/sync.ts";

export interface McpServerOptions {
  signal?: AbortSignal;
  env?: EnvLike;
  cwd?: string;
  version?: string;
  /** GitHub Enterprise base URL override (same as the CLI's --base-url). */
  baseUrl?: string;
  /** Optional overrides for testing tool behaviors hermetically without real GitHub credentials. */
  toolContextOverrides?: Partial<ToolContext>;
}

const _ROOT_PARAM_DESCRIPTION =
  "Workspace root directory. Defaults to the configured root in the user config.json, then the OS default. The central repotruck.json tracks registered workspaces.";

import { registerWorkspaceResources, registerWorkspaceTools } from "./tools/workspace.ts";

export async function createRepotruckMcpServer(options: McpServerOptions = {}): Promise<McpServer> {
  const version = options.version ?? (await readVersion());
  const baseCtx = await createToolContext(options);
  const ctx: ToolContext = { ...baseCtx, ...(options.toolContextOverrides ?? {}) };
  const server = new McpServer({ name: "repotruck", version });
  registerWorkspaceTools(server, ctx);
  registerReposTools(server, ctx);
  registerSyncTools(server, ctx);
  registerLifecycleTools(server, ctx);
  registerAliasesTools(server, ctx);
  registerGithubTools(server, ctx);
  registerSearchTools(server, ctx);
  registerPrompts(server, ctx);
  registerWorkspaceResources(server, ctx);
  return server;
}

export async function runRepotruckMcpServer(options: McpServerOptions = {}): Promise<void> {
  const server = await createRepotruckMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export interface McpHttpServerOptions extends McpServerOptions {
  host?: string;
  port?: number;
  token?: string;
}

export const MCP_HTTP_DEFAULT_HOST = "127.0.0.1";
export const MCP_HTTP_DEFAULT_PORT = 3000;

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalHostname(host: string): boolean {
  return LOCAL_HOSTNAMES.has(host.trim().toLowerCase());
}

export function validateHttpBindOptions(
  host: string | undefined,
  token: string | undefined,
): string | null {
  const effectiveHost = (host ?? MCP_HTTP_DEFAULT_HOST).trim();
  if (effectiveHost.length === 0) {
    return "--host cannot be empty";
  }
  if (token !== undefined && token.trim().length === 0) return "--token cannot be empty";
  if (token === undefined && !isLocalHostname(effectiveHost)) {
    return `--host ${effectiveHost} is not a localhost address — binding beyond localhost requires --token <value>`;
  }
  return null;
}

export interface RepotruckHttpMcpHandler {
  fetch: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
}

// Interoperability note: @modelcontextprotocol/node and @modelcontextprotocol/server
// version independently; the node package accepts peer ranges of the server package
// and both sides interoperate cleanly over the fetch-shaped handler.
/** Constant-time comparison so the bearer token is not leaked through timing. */
function tokensEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Compare lengths only after a constant-time run to avoid a length oracle.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function createRepotruckHttpHandler(
  options: McpHttpServerOptions = {},
): RepotruckHttpMcpHandler {
  const token = options.token;
  const problem = validateHttpBindOptions(options.host, token);
  if (problem) throw new Error(problem);
  const controller = new AbortController();
  const handler = createMcpHandler(
    () => createRepotruckMcpServer({ ...options, signal: controller.signal }),
    {
      onerror: (error) => {
        process.stderr.write(`mcp http: ${firstErrorLine(error)}\n`);
      },
    },
  );
  const guardedFetch = async (
    request: Request,
    fetchOptions?: Parameters<typeof handler.fetch>[1],
  ): Promise<Response> => {
    if (token !== undefined) {
      const authorization = request.headers.get("authorization") ?? "";
      if (!tokensEqual(authorization, `Bearer ${token}`)) {
        return new Response("unauthorized: missing or invalid bearer token\n", {
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer realm="repotruck"' },
        });
      }
    } else {
      const hostRejected = hostHeaderValidationResponse(request, localhostAllowedHostnames());
      if (hostRejected !== undefined) return hostRejected;
      const originRejected = originValidationResponse(request, localhostAllowedOrigins());
      if (originRejected !== undefined) return originRejected;
    }
    return handler.fetch(request, fetchOptions);
  };
  return {
    fetch: guardedFetch,
    close: async () => {
      controller.abort();
      await closeProcessScope(controller.signal);
      await handler.close();
    },
  };
}

export const MAX_MCP_HTTP_BODY_BYTES = 1024 * 1024;

/** Programmatic listener with bounded, idempotent shutdown for socket tests. */
export async function startRepotruckMcpHttpServer(options: McpHttpServerOptions = {}) {
  const host = (options.host ?? MCP_HTTP_DEFAULT_HOST).trim();
  const port = options.port ?? MCP_HTTP_DEFAULT_PORT;
  const problem = validateHttpBindOptions(host, options.token);
  if (problem) throw new Error(problem);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("HTTP port must be an integer between 0 and 65535");
  const handler = createRepotruckHttpHandler(options);
  const nodeHandler = toNodeHandler({ fetch: handler.fetch });
  const server = createServer((req, res) => {
    if (Number(req.headers["content-length"] ?? 0) > MAX_MCP_HTTP_BODY_BYTES) {
      res.writeHead(413);
      res.end("request body too large");
      req.resume();
      return;
    }
    let bytes = 0;
    const count = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_MCP_HTTP_BODY_BYTES && !res.writableEnded) {
        res.writeHead(413);
        res.end("request body too large");
        res.once("finish", () => req.destroy());
      }
    };
    req.on("data", count);
    res.once("finish", () => req.off("data", count));
    void nodeHandler(req, res).catch((error: unknown) => {
      if (res.writableEnded) return;
      process.stderr.write(`mcp http: ${firstErrorLine(error)}\n`);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  }).catch(async (error) => {
    await handler.close();
    throw error;
  });
  server.on("error", (error) => process.stderr.write(`mcp http: ${firstErrorLine(error)}\n`));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host.includes(":") ? `[${host.replace(/^\[|\]$/g, "")}]` : host}:${actualPort}`;
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      const drained = new Promise<void>((resolve) => server.close(() => resolve()));
      const force = setTimeout(() => server.closeAllConnections(), 250);
      let handlerTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          handler.close().catch(() => {}),
          new Promise<void>((resolve) => {
            handlerTimer = setTimeout(resolve, 200);
          }),
        ]);
        server.closeAllConnections();
        await drained;
      } finally {
        clearTimeout(force);
        clearTimeout(handlerTimer);
      }
    })();
    return closing;
  };
  return { url, close };
}

export async function runRepotruckMcpHttpServer(options: McpHttpServerOptions = {}): Promise<void> {
  const listener = await startRepotruckMcpHttpServer(options);
  process.stdout.write(`repotruck MCP server (HTTP) listening on ${listener.url}\n`);
  let closed = false;
  const shutdown = () => {
    if (closed) return;
    closed = true;
    // Signal-only process exit: bounded close terminates persistent clients.
    void listener.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

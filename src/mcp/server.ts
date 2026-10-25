import { createServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createToolContext } from "./toolContext.ts";

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
import { readVersion } from "../services/version.ts";
import { registerAliasesTools } from "./tools/aliases.ts";
import { registerGithubTools } from "./tools/github.ts";
import { registerLifecycleTools } from "./tools/lifecycle.ts";
import { registerPrompts } from "./tools/prompts.ts";
import { registerReposTools } from "./tools/repos.ts";
import { registerSearchTools } from "./tools/search.ts";
import { registerSyncTools } from "./tools/sync.ts";

export interface McpServerOptions {
  env?: EnvLike;
  cwd?: string;
  version?: string;
  /** GitHub Enterprise base URL override (same as the CLI's --base-url). */
  baseUrl?: string;
}

const _ROOT_PARAM_DESCRIPTION =
  "Workspace root directory. Default: the nearest registered workspace found walking up from the MCP server's working directory (records live in the central repotruck.json in the app config dir), otherwise the configured default root (settings.json), otherwise the OS default.";

import { registerWorkspaceResources, registerWorkspaceTools } from "./tools/workspace.ts";

export async function createRepotruckMcpServer(options: McpServerOptions = {}): Promise<McpServer> {
  const version = options.version ?? (await readVersion());
  const ctx = await createToolContext(options);
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
  const handler = createMcpHandler(() => createRepotruckMcpServer(options), {
    onerror: (error) => {
      process.stderr.write(`mcp http: ${firstErrorLine(error)}\n`);
    },
  });
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
  return { fetch: guardedFetch, close: () => handler.close() };
}

export async function runRepotruckMcpHttpServer(options: McpHttpServerOptions = {}): Promise<void> {
  const host = options.host ?? MCP_HTTP_DEFAULT_HOST;
  const port = options.port ?? MCP_HTTP_DEFAULT_PORT;
  const bindProblem = validateHttpBindOptions(host, options.token);
  if (bindProblem !== null) {
    throw new Error(bindProblem);
  }
  const handler = createRepotruckHttpHandler(options);
  const nodeHandler = toNodeHandler({ fetch: handler.fetch });
  const httpServer = createServer((req, res) => {
    void nodeHandler(req, res).catch((error: unknown) => {
      process.stderr.write(`mcp http: ${firstErrorLine(error)}\n`);
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    const onListenError = (error: NodeJS.ErrnoException): void => reject(error);
    httpServer.once("error", onListenError);
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", onListenError);
      httpServer.on("error", (error) => {
        process.stderr.write(`mcp http: ${firstErrorLine(error)}\n`);
      });
      resolve();
    });
  });
  process.stdout.write(`repotruck MCP server (HTTP) listening on http://${host}:${port}\n`);
  let closed = false;
  const shutdown = (): void => {
    if (closed) return;
    closed = true;
    void handler.close().finally(() => {
      httpServer.close(() => {
        // Documented process.exit exception: shutdown signal handler for the
        // long-running MCP server; nothing else may keep the process alive here.
        process.exit(0);
      });
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

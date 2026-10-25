import type { Command } from "commander";
import { firstErrorLine } from "../../services/cloner.ts";
import { normalizeBaseUrl } from "../../services/settings.ts";
import { type CliContext, exitFail } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("mcp")
    .description(
      "Run the repotruck MCP server (Model Context Protocol) for coding agents. " +
        'Default transport is stdio: add it to your MCP client (Claude Code, Cursor, ...) with command `repotruck` and args `["mcp"]`. ' +
        "With --http it serves Streamable HTTP instead (never both in one process): `repotruck mcp --http [--port N] [--host H] [--token T]`. " +
        "Exposes tools for workspace discovery, repo listing/search, sync, clone, create, move, reorganize, lifecycle (forget/prune/status/archive/open), aliases, resources (AGENTS.md, inventory, tree) and prompts.",
    )
    .option("--http", "serve Streamable HTTP instead of stdio (either/or, not both)")
    .option("--port <number>", "HTTP listen port (default 3000)", "3000")
    .option(
      "--host <hostname>",
      "HTTP listen address (default 127.0.0.1; non-localhost addresses require --token)",
      "127.0.0.1",
    )
    .option("--token <value>", "require this bearer token on every HTTP request")
    .option("--base-url <url>", "GitHub Enterprise base URL (e.g. https://ghe.example.com)")
    .action(
      async (options: {
        http?: boolean;
        port: string;
        host: string;
        token?: string;
        baseUrl?: string;
      }) => {
        try {
          let baseUrl: string | undefined;
          if (options.baseUrl !== undefined) {
            baseUrl = normalizeBaseUrl(options.baseUrl);
          }
          if (options.http === true) {
            if (!/^\d+$/.test(options.port.trim())) {
              exitFail(
                `invalid --port value: ${options.port} (expected an integer between 1 and 65535)`,
              );
            }
            const port = Number.parseInt(options.port.trim(), 10);
            if (port <= 0 || port > 65535) {
              exitFail(
                `invalid --port value: ${options.port} (expected an integer between 1 and 65535)`,
              );
            }
            const { runRepotruckMcpHttpServer, validateHttpBindOptions } = await import(
              "../../mcp/server.ts"
            );
            const bindProblem = validateHttpBindOptions(options.host, options.token);
            if (bindProblem !== null) exitFail(bindProblem);
            await runRepotruckMcpHttpServer({
              host: options.host,
              port,
              token: options.token,
              baseUrl,
            });
            return;
          }
          const { runRepotruckMcpServer } = await import("../../mcp/server.ts");
          await runRepotruckMcpServer({ baseUrl });
        } catch (error) {
          process.stderr.write(`error: ${firstErrorLine(error)}\n`);
          process.exitCode = 1;
          return;
        }
      },
    );
}

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { searchCode } from "../../services/codeSearch.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import type { ToolContext } from "../toolContext.ts";
import { guarded, ok, rootParam } from "../toolHelpers.ts";

export function registerSearchTools(server: McpServer, ctx: ToolContext): void {
  const { env, requireWorkspaceRoot } = ctx;
  server.registerTool(
    "repotruck_search_code",
    {
      title: "Search code symbols",
      description:
        "Search an indexed symbol name (substring, case-insensitive) across every tracked repository in a workspace, exactly like `repotruck search-code`: a tree-sitter symbol index over ts/tsx/js/python/go/rust sources returning repo:path:line hits with symbol kind and export status. The first search builds the index (~3 MB per second); later searches reuse it unless rebuild is set. Read-only.",
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({
        pattern: z.string().min(1).describe("Symbol name substring to match (case-insensitive)"),
        root: rootParam,
        kind: z
          .enum(["function", "class", "interface", "type", "enum", "method", "const"])
          .optional()
          .describe("Only this symbol kind"),
        lang: z
          .enum(["ts", "tsx", "js", "py", "go", "rs"])
          .optional()
          .describe("Only this source language (py = python, rs = rust)"),
        limit: z.number().int().positive().optional().describe("Max matches (default: all)"),
        rebuild: z.boolean().optional().describe("Force a full index rebuild before searching"),
      }),
    },
    async ({ pattern, root: rootArg, kind, lang, limit, rebuild }) =>
      guarded(async () => {
        const root = await requireWorkspaceRoot(rootArg);
        const config = await loadWorkspace(root, undefined, env);
        const result = await searchCode({
          root,
          config,
          pattern,
          kind,
          lang,
          limit,
          rebuild: rebuild === true,
        });
        return ok({
          root,
          pattern,
          count: result.matches.length,
          matches: result.matches,
          index: result.index,
        });
      }),
  );
}

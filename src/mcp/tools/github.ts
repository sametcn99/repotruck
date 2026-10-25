import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { ToolContext } from "../toolContext.ts";
import { guarded, ok } from "../toolHelpers.ts";

export function registerGithubTools(server: McpServer, ctx: ToolContext): void {
  const { requireAuth } = ctx;
  server.registerTool(
    "repotruck_search_github",
    {
      title: "Search GitHub",
      description:
        "Search public repositories on GitHub by keyword (GitHub search syntax). Use this to find repositories to clone with repotruck_clone. Requires GitHub authentication.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe('GitHub search query (e.g. "language:typescript mcp server")'),
        limit: z.number().int().positive().max(50).optional().describe("Max results (default 10)"),
      }),
    },
    async ({ query, limit }) =>
      guarded(async () => {
        const { github } = await requireAuth();
        const results = await github.searchRepos(query, limit ?? 10);
        return ok({
          query,
          count: results.length,
          repos: results.map((repo) => ({
            key: `${repo.owner}/${repo.name}`,
            description: repo.description,
            language: repo.language,
            stars: repo.stars,
            isFork: repo.isFork,
            isArchived: repo.isArchived,
            updatedAt: repo.updatedAt,
            httpsUrl: repo.httpsUrl,
          })),
        });
      }),
  );
}

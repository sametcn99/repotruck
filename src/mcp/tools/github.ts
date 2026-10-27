import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { buildDiscoverQuery } from "../../services/github.ts";
import type { ToolContext } from "../toolContext.ts";
import { guarded, ok } from "../toolHelpers.ts";

export function registerGithubTools(server: McpServer, ctx: ToolContext): void {
  const { requireAuth } = ctx;
  server.registerTool(
    "repotruck_search_github",
    {
      title: "Search GitHub",
      description:
        "Search repositories on GitHub by keyword and optional qualifiers (org, lang, minStars, topics), just like `repotruck discover`. Use this to find repositories to clone with repotruck_clone. Requires GitHub authentication.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe('GitHub search query (e.g. "language:typescript mcp server")'),
        org: z.string().min(1).optional().describe("Restrict search to a GitHub organization"),
        lang: z.string().min(1).optional().describe("Restrict search to primary language"),
        minStars: z.number().int().min(0).optional().describe("Minimum stargazer count"),
        topics: z.array(z.string().min(1)).optional().describe("Required repository topics"),
        includeArchived: z
          .boolean()
          .optional()
          .describe("Include archived repositories (excluded by default when qualifiers are used)"),
        includeForks: z
          .boolean()
          .optional()
          .describe("Include fork repositories (excluded by default when qualifiers are used)"),
        limit: z.number().int().positive().max(50).optional().describe("Max results (default 10)"),
      }),
    },
    async ({ query, org, lang, minStars, topics, includeArchived, includeForks, limit }) =>
      guarded(async () => {
        const { github } = await requireAuth();
        const hasStructuredQualifiers =
          org !== undefined ||
          lang !== undefined ||
          minStars !== undefined ||
          (topics !== undefined && topics.length > 0) ||
          includeArchived !== undefined ||
          includeForks !== undefined;
        const effectiveQuery = hasStructuredQualifiers
          ? buildDiscoverQuery(query, {
              org,
              lang,
              minStars,
              topics,
              includeArchived,
              includeForks,
            })
          : query;
        const results = await github.searchRepos(effectiveQuery, limit ?? 10);
        return ok({
          query: effectiveQuery,
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

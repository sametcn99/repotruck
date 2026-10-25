import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { ToolContext } from "../toolContext.ts";
import { rootParam } from "../toolHelpers.ts";

export function registerPrompts(server: McpServer, _ctx: ToolContext): void {
  server.registerPrompt(
    "sync-and-summarize",
    {
      title: "Sync workspace and summarize new repositories",
      description:
        "Instructions for running a repotruck sync over the workspace and then summarizing what arrived: new repositories, their languages and paths, and any failures.",
      argsSchema: z.object({
        root: rootParam,
        scope: z
          .enum(["user", "all", "org"])
          .optional()
          .describe(
            'Repositories to sync: "user" (default), "all", or "org" paired with the org argument',
          ),
        org: z
          .string()
          .min(1)
          .optional()
          .describe('Organization name (required when scope is "org")'),
        limit: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe("Sync only the first N repositories of the resolved scope"),
      }),
    },
    ({ root, scope, org, limit }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Synchronize the repotruck workspace${
                root !== undefined && root.length > 0 ? ` at ${root}` : " (default root resolution)"
              } and summarize the result:`,
              `1. Call the repotruck_sync tool with scope "${scope ?? "user"}"${
                org !== undefined ? ` and org "${org}"` : ""
              }${limit !== undefined ? ` and limit ${limit}` : ""}${
                root !== undefined && root.length > 0 ? ` and root "${root}"` : ""
              }.`,
              "2. When it finishes, call repotruck_list_repos for the same workspace.",
              "3. Summarize: how many repositories were newly cloned vs updated vs failed, then a short table of new repositories (key, language, workspace-relative path).",
              "4. If any repository failed to sync, include the failure messages verbatim.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "suggest-agent-rules",
    {
      title: "Suggest agent rules for this workspace",
      description:
        "Instructions for reading the workspace map and inventory and then proposing grounded AGENTS.md agent rules: per-category guidance, language conventions, alias usage, and safe defaults.",
      argsSchema: z.object({ root: rootParam }),
    },
    ({ root }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Propose agent rules for the repotruck workspace${
                root !== undefined && root.length > 0 ? ` at ${root}` : " (default root resolution)"
              }:`,
              "1. Read the AGENTS.md map (the repotruck://agents-md resource or the repotruck_agents_md tool) and the repository inventory (repotruck_list_repos).",
              "2. Draft 5-10 concise agent rules grounded in what you found: per-category guidance (source vs forks vs archived), language-specific conventions where one language dominates, how to use aliases, and which directories are safe to modify.",
              "3. Present the rules as a markdown list ready to paste into the agent rules section of AGENTS.md. Do not invent repositories that are not in the inventory.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

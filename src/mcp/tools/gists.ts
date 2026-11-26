import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { GistService } from "../../services/gists.ts";
import { launchAppInDirectory, resolveApp } from "../../services/launcher.ts";
import type { ToolContext } from "../toolContext.ts";
import { detachedSpawnImpl, guarded, ok, rootParam } from "../toolHelpers.ts";

const refParam = z.string().min(1).describe("GitHub Gist ID or URL");
const fileParam = z.object({ name: z.string().min(1), content: z.string() });
const targetParams = { root: rootParam, ref: refParam };
const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: true };
const mutation = { openWorldHint: true };

export function registerGistTools(server: McpServer, ctx: ToolContext): void {
  async function service(rootArg?: string, remote = true) {
    const root = await ctx.resolveRoot(rootArg);
    const auth = remote ? await ctx.requireAuth() : {};
    return new GistService({ root, env: ctx.env, ...auth });
  }

  server.registerTool(
    "repotruck_gist_list",
    {
      title: "List Gists",
      description:
        "List account and workspace Gists. Set trackedOnly to read the local inventory offline.",
      annotations: readOnly,
      inputSchema: z.object({ root: rootParam, trackedOnly: z.boolean().optional() }),
    },
    async ({ root, trackedOnly }) =>
      guarded(async () => ok(await (await service(root, !trackedOnly)).list(trackedOnly))),
  );

  server.registerTool(
    "repotruck_gist_show",
    {
      title: "Show Gist",
      description:
        "Read remote Gist metadata and available UTF-8 file contents. Use version as expectedVersion when editing.",
      annotations: readOnly,
      inputSchema: z.object(targetParams),
    },
    async ({ root, ref }) => guarded(async () => ok(await (await service(root)).show(ref))),
  );

  server.registerTool(
    "repotruck_gist_clone",
    {
      title: "Clone Gist",
      description: "Clone or fast-forward-update a Gist by ID or URL.",
      annotations: { ...mutation, idempotentHint: true },
      inputSchema: z.object(targetParams),
    },
    async ({ root, ref }) =>
      guarded(async () => {
        const [result] = await (await service(root)).sync([ref]);
        return { ...ok(result), ...(result?.error ? { isError: true } : {}) };
      }),
  );

  server.registerTool(
    "repotruck_gist_sync",
    {
      title: "Sync Gists",
      description:
        "Sync selected Gist IDs or URLs. With no selection, sync account and tracked Gists.",
      annotations: { ...mutation, idempotentHint: true },
      inputSchema: z.object({ root: rootParam, refs: z.array(refParam).optional() }),
    },
    async ({ root, refs }) =>
      guarded(async () => {
        const results = await (await service(root)).sync(refs);
        return { ...ok(results), ...(results.some((item) => item.error) ? { isError: true } : {}) };
      }),
  );

  server.registerTool(
    "repotruck_gist_open",
    {
      title: "Open Gist in an app",
      description: "Launch an editor or agent app in a local Gist checkout.",
      annotations: mutation,
      inputSchema: z.object({ ...targetParams, app: z.string().min(1) }),
    },
    async ({ root, ref, app }) =>
      guarded(async () => {
        const directory = await (await service(root, false)).localPath(ref);
        const resolved = await resolveApp(app, { env: ctx.env });
        if (!resolved) throw new Error("Editor or agent app not found");
        const code = await launchAppInDirectory(directory, resolved, detachedSpawnImpl);
        return {
          ...ok({ directory, app: resolved.name, code }),
          ...(code ? { isError: true } : {}),
        };
      }),
  );

  server.registerTool(
    "repotruck_gist_create",
    {
      title: "Create Gist",
      description:
        "Create a GitHub Gist from UTF-8 files, then clone it. Visibility defaults to secret.",
      annotations: { ...mutation, destructiveHint: false },
      inputSchema: z.object({
        root: rootParam,
        description: z.string().optional(),
        public: z.boolean().optional(),
        files: z.array(fileParam).min(1),
      }),
    },
    async ({ root, ...input }) =>
      guarded(async () => {
        const result = await (await service(root)).create(input);
        return { ...ok(result), ...(result.local.error ? { isError: true } : {}) };
      }),
  );

  server.registerTool(
    "repotruck_gist_edit",
    {
      title: "Edit Gist on GitHub",
      description:
        "Update a Gist description, upsert named text files, rename files or remove them on GitHub.",
      annotations: { ...mutation, destructiveHint: true },
      inputSchema: z.object({
        ...targetParams,
        description: z.string().optional(),
        files: z.array(fileParam).optional(),
        rename: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).optional(),
        remove: z.array(z.string().min(1)).optional(),
        expectedVersion: z.string().optional(),
      }),
    },
    async ({ root, ref, ...input }) =>
      guarded(async () => ok(await (await service(root)).edit(ref, input))),
  );

  server.registerTool(
    "repotruck_gist_push",
    {
      title: "Push Gist commits",
      description:
        "Push committed changes from a local Gist checkout to its verified upstream branch.",
      annotations: { ...mutation, idempotentHint: true },
      inputSchema: z.object(targetParams),
    },
    async ({ root, ref }) => guarded(async () => ok(await (await service(root)).push(ref))),
  );

  server.registerTool(
    "repotruck_gist_delete",
    {
      title: "Delete Gist from GitHub",
      description:
        "Permanently delete a Gist from GitHub and keep the local clone. Requires confirm: yes.",
      annotations: { ...mutation, destructiveHint: true },
      inputSchema: z.object({ ...targetParams, confirm: z.literal("yes") }),
    },
    async ({ root, ref, confirm }) =>
      guarded(async () => ok(await (await service(root)).delete(ref, confirm === "yes"))),
  );
}

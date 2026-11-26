import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import type { GistFile } from "../../services/gistApi.ts";
import { GistService, type GistSyncItem } from "../../services/gists.ts";
import { launchAppInDirectory, resolveApp } from "../../services/launcher.ts";
import { resolveGithubBaseUrl } from "../../services/settings.ts";
import { type CliContext, runAction } from "../shared.ts";

interface OutputOptions {
  dir?: string;
  json?: boolean;
}

function output(
  options: OutputOptions,
  command: string,
  value: unknown,
  lines: string[],
  failed = false,
) {
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ command: `gist ${command}`, ok: !failed, result: value })}\n`,
    );
  } else if (lines.length) {
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  if (failed) process.exitCode = 1;
}

async function readFiles(paths: readonly string[] = []): Promise<GistFile[]> {
  return Promise.all(
    paths.map(async (file) => {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(file));
      if (content.includes("\0")) throw new Error("Gist API files must be UTF-8 text");
      return { name: path.basename(file), content };
    }),
  );
}

function renamePair(value: string) {
  const index = value.indexOf("=");
  if (index <= 0 || index === value.length - 1) throw new Error("Expected --rename old=new");
  return { from: value.slice(0, index), to: value.slice(index + 1) };
}

function rows(items: readonly GistSyncItem[]) {
  return items.map(({ id, action, error }) => `${id}  ${action ?? error}`);
}

export function register(program: Command, ctx: CliContext): void {
  const group = program
    .command("gist")
    .description("Manage GitHub Gists alongside workspace repositories.");
  const command = (name: string, description: string) =>
    group
      .command(name)
      .description(description)
      .option("-d, --dir <root>", "workspace root directory")
      .option("--json", "output results as JSON");

  async function service(options: OutputOptions, remote = true) {
    const root = await ctx.resolveRootOption(options.dir);
    if (!remote) return new GistService({ root, env: process.env });
    const { token } = await ctx.requireAuth();
    const github = ctx.buildGithub(token, await resolveGithubBaseUrl(process.env));
    return new GistService({ root, github, token, env: process.env });
  }

  const action = (name: string, options: OutputOptions, fn: () => Promise<void>) =>
    runAction(fn, { command: `gist ${name}`, json: options.json });

  command("list", "List account and tracked Gists.")
    .option("--tracked", "list local inventory without contacting GitHub")
    .action((options: OutputOptions & { tracked?: boolean }) =>
      action("list", options, async () => {
        const result = await (await service(options, !options.tracked)).list(options.tracked);
        output(
          options,
          "list",
          result,
          result.map(
            ({ id, gist, local }) =>
              `${id}  ${gist ? (gist.public ? "public" : "secret") : "tracked"}  ${local}  ${gist?.description || gist?.files[0] || ""}`,
          ),
        );
      }),
    );

  command("show", "Inspect a Gist and its remote text files.")
    .argument("<ref>", "Gist ID or URL")
    .option("--file <name>", "print the contents of one file")
    .action((ref: string, options: OutputOptions & { file?: string }) =>
      action("show", options, async () => {
        const gist = await (await service(options)).show(ref);
        if (options.file !== undefined) {
          const content = Object.hasOwn(gist.contents, options.file)
            ? gist.contents[options.file]
            : null;
          if (content == null)
            throw new Error(
              "File unavailable through the API; check the file name or use the Git clone",
            );
          if (!options.json) process.stdout.write(content);
          else output(options, "show", { id: gist.id, name: options.file, content }, []);
        } else {
          output(options, "show", gist, [
            gist.url,
            gist.description,
            gist.public ? "public" : "secret",
            ...gist.files,
          ]);
        }
      }),
    );

  command("clone", "Clone or update a Gist by ID or URL.")
    .argument("<ref>", "Gist ID or URL")
    .action((ref: string, options: OutputOptions) =>
      action("clone", options, async () => {
        const result = await (await service(options)).sync([ref]);
        output(
          options,
          "clone",
          result[0],
          rows(result),
          result.some((item) => Boolean(item.error)),
        );
      }),
    );

  command("sync", "Sync selected Gists or all account and tracked Gists.")
    .argument("[refs...]", "Gist IDs or URLs")
    .action((refs: string[], options: OutputOptions) =>
      action("sync", options, async () => {
        const result = await (await service(options)).sync(refs);
        output(
          options,
          "sync",
          result,
          rows(result),
          result.some((item) => Boolean(item.error)),
        );
      }),
    );

  command("open", "Open a local Gist in an editor or agent app.")
    .arguments("<ref> <app>")
    .action((ref: string, app: string, options: OutputOptions) =>
      action("open", options, async () => {
        const directory = await (await service(options, false)).localPath(ref);
        const resolved = await resolveApp(app, { env: process.env });
        if (!resolved) throw new Error("Editor or agent app not found");
        const code = await launchAppInDirectory(directory, resolved);
        output(options, "open", { directory, code }, [], code !== 0);
        process.exitCode = code;
      }),
    );

  command("create", "Create a GitHub Gist and clone it into the workspace.")
    .requiredOption("--file <paths...>", "local UTF-8 files to publish")
    .option("--description <text>", "Gist description")
    .option("--public", "publish as a public Gist")
    .action((options: OutputOptions & { file: string[]; description?: string; public?: boolean }) =>
      action("create", options, async () => {
        const files = await readFiles(options.file);
        const result = await (await service(options)).create({ ...options, files });
        output(
          options,
          "create",
          result,
          [result.gist.url, ...rows([result.local])],
          Boolean(result.local.error),
        );
      }),
    );

  command("edit", "Edit the description and text files directly on GitHub.")
    .argument("<ref>", "Gist ID or URL")
    .option("--description <text>", "replace the Gist description")
    .option("--file <paths...>", "local UTF-8 files to add or replace by name")
    .option("--rename <pairs...>", "rename files using old=new pairs")
    .option("--remove <names...>", "remove files by name")
    .option("--expect-version <token>", "require the version returned by gist show --json")
    .action(
      (
        ref: string,
        options: OutputOptions & {
          description?: string;
          file?: string[];
          rename?: string[];
          remove?: string[];
          expectVersion?: string;
        },
      ) =>
        action("edit", options, async () => {
          const result = await (await service(options)).edit(ref, {
            description: options.description,
            files: await readFiles(options.file),
            rename: options.rename?.map(renamePair),
            remove: options.remove,
            expectedVersion: options.expectVersion,
          });
          output(options, "edit", result, [
            result.gist.url,
            ...(result.syncNeeded ? ["Run gist sync to update the local clone."] : []),
          ]);
        }),
    );

  command("push", "Push local commits to the verified Gist upstream.")
    .argument("<ref>", "Gist ID or URL")
    .action((ref: string, options: OutputOptions) =>
      action("push", options, async () => {
        const result = await (await service(options)).push(ref);
        output(options, "push", result, [`${result.id}  ${result.action}`]);
      }),
    );

  command("delete", "Permanently delete a Gist from GitHub and keep its local clone.")
    .argument("<ref>", "Gist ID or URL")
    .option("--yes", "confirm remote deletion")
    .action((ref: string, options: OutputOptions & { yes?: boolean }) =>
      action("delete", options, async () => {
        if (options.yes !== true)
          throw new Error("Pass --yes to confirm permanent deletion from GitHub");
        const result = await (await service(options)).delete(ref, true);
        output(options, "delete", result, [`Deleted Gist ${result.id}`]);
      }),
    );
}

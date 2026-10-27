import path from "node:path";
import type { Command } from "commander";
import { PRESET_IDS } from "../../presets/index.ts";
import type { EmitProgress } from "../../services/cloner.ts";
import { refreshCodeIndexIfPresent } from "../../services/codeSearch.ts";
import {
  DEFAULT_GITHUB_BASE_URL,
  readCustomPresets,
  resolveGithubBaseUrl,
} from "../../services/settings.ts";
import { cloneSingleRepository, GITHUB_HOST } from "../../services/singleCloner.ts";
import { loadWorkspace, toPosixRelative } from "../../services/workspace.ts";
import {
  type CliContext,
  jsonEmit,
  parseIntStrict,
  progressEmit,
  requirePreset,
  resolveRootOption,
  runAction,
} from "../shared.ts";

export function register(program: Command, ctx: CliContext): void {
  program
    .command("clone")
    .description("Clone a single GitHub repository into the workspace layout.")
    .argument("<url>", "GitHub repository URL or owner/name")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .option("-p, --preset <id>", `preset for the target layout: ${PRESET_IDS.join(", ")}`)
    .option("--depth <n>", "create a shallow clone with the given commit depth")
    .option("--blobless", "create a blobless partial clone (git clone --filter=blob:none)")
    .option("--base-url <url>", "GitHub Enterprise base URL (e.g. https://ghe.example.com)")
    .option("--json", "Output results as JSON")
    .action(
      async (
        url: string,
        options: {
          dir?: string;
          preset?: string;
          depth?: string;
          blobless?: boolean;
          baseUrl?: string;
          json?: boolean;
        },
      ) => {
        await runAction(
          async () => {
            let depth: number | undefined;
            if (options.depth !== undefined) {
              depth = parseIntStrict(options.depth, "depth", options.json, "clone");
            }
            const root = await resolveRootOption(options.dir);
            const presetOverride =
              options.preset === undefined
                ? undefined
                : await requirePreset(options.preset, options.json, "clone");
            const customPresets = await readCustomPresets(process.env);
            const auth = await ctx.requireAuth();
            const baseUrl = await resolveGithubBaseUrl(process.env, options.baseUrl);
            const hosts = [GITHUB_HOST];
            if (baseUrl !== DEFAULT_GITHUB_BASE_URL) {
              try {
                const h = new URL(baseUrl).hostname;
                if (!hosts.includes(h)) hosts.push(h);
              } catch {
                /* noop */
              }
            }
            const github = ctx.buildGithub(auth.token, baseUrl);
            const userLogin = await github.getUserLogin();
            const orgs = await github.getActiveOrgs();
            const emit: EmitProgress = options.json ? jsonEmit() : progressEmit();
            const result = await cloneSingleRepository(url, {
              root,
              github,
              userLogin,
              orgs,
              token: auth.token,
              presetOverride,
              depth,
              blobless: options.blobless === true,
              hosts,
              customPresets,
              emit,
            });
            await refreshCodeIndexIfPresent(
              root,
              await loadWorkspace(root, presetOverride, process.env),
            );
            if (options.json) {
              const payload = {
                command: "clone",
                ok: true,
                root,
                repo: result.repo,
                relativePath: toPosixRelative(root, result.destDir),
                absolutePath: path.resolve(result.destDir),
                internal: result.internal,
                preset: result.preset,
                action: result.progress.message === "updated" ? "updated" : "cloned",
              };
              process.stdout.write(`${JSON.stringify(payload)}\n`);
            }
          },
          { command: "clone", json: options.json },
        );
      },
    );
}

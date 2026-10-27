import type { Command } from "commander";
import { PRESET_IDS } from "../../presets/index.ts";
import type { EmitProgress } from "../../services/cloner.ts";
import { refreshCodeIndexIfPresent } from "../../services/codeSearch.ts";
import { buildDiscoverQuery } from "../../services/github.ts";
import { readCustomPresets, resolveGithubBaseUrl } from "../../services/settings.ts";
import { loadWorkspace, syncRepos } from "../../services/workspace.ts";
import {
  type CliContext,
  exitFail,
  jsonEmit,
  parseIntStrict,
  progressEmit,
  requirePreset,
  resolveRootOption,
  runAction,
} from "../shared.ts";

export function register(program: Command, ctx: CliContext): void {
  program
    .command("discover")
    .description(
      "Search GitHub repositories with rich qualifiers and optionally clone matches into the workspace.",
    )
    .argument("<query>", "GitHub repository search query")
    .option(
      "-d, --dir <root>",
      "workspace root directory when --clone is used (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option(
      "-p, --preset <id>",
      `preset for target layout when --clone is used: ${PRESET_IDS.join(", ")}`,
    )
    .option("--org <org>", "restrict search to a GitHub organization")
    .option("--lang <language>", "restrict search to primary language")
    .option("--min-stars <n>", "minimum stargazer count")
    .option(
      "--topic <topic>",
      "require repository topic (repeatable)",
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .option("--include-archived", "include archived repositories (excluded by default)")
    .option("--include-forks", "include fork repositories (excluded by default)")
    .option("-l, --limit <n>", "maximum results to return (default 20, max 200)")
    .option("--clone", "clone discovered repositories into the workspace")
    .option("--depth <n>", "shallow clone commit depth when --clone is used")
    .option("--blobless", "blobless partial clone when --clone is used")
    .option("--base-url <url>", "GitHub Enterprise base URL (e.g. https://ghe.example.com)")
    .option("--json", "Output results as JSON")
    .action(
      async (
        query: string,
        options: {
          dir?: string;
          preset?: string;
          org?: string;
          lang?: string;
          minStars?: string;
          topic: string[];
          includeArchived?: boolean;
          includeForks?: boolean;
          limit?: string;
          clone?: boolean;
          depth?: string;
          blobless?: boolean;
          baseUrl?: string;
          json?: boolean;
        },
      ) => {
        await runAction(
          async () => {
            const limit =
              options.limit === undefined
                ? 20
                : Math.min(200, parseIntStrict(options.limit, "limit", options.json, "discover"));
            let minStars: number | undefined;
            if (options.minStars !== undefined) {
              const trimmed = options.minStars.trim();
              if (!/^\d+$/.test(trimmed)) {
                exitFail(
                  `invalid min-stars: ${options.minStars} (expected a non-negative integer)`,
                  options.json,
                  "discover",
                );
              }
              minStars = Number.parseInt(trimmed, 10);
            }
            let depth: number | undefined;
            if (options.depth !== undefined) {
              depth = parseIntStrict(options.depth, "depth", options.json, "discover");
            }

            const fullQuery = buildDiscoverQuery(query, {
              org: options.org,
              lang: options.lang,
              minStars,
              topics: options.topic,
              includeArchived: options.includeArchived === true,
              includeForks: options.includeForks === true,
            });
            if (fullQuery.trim().length === 0) {
              exitFail("discover query cannot be empty", options.json, "discover");
            }

            const auth = await ctx.requireAuth();
            const baseUrl = await resolveGithubBaseUrl(process.env, options.baseUrl);
            const github = ctx.buildGithub(auth.token, baseUrl);
            const repos = await github.searchRepos(fullQuery, limit);

            let clonedSummary: { synced: number; skipped: number; failed: number } | undefined;
            let clonedRoot: string | undefined;

            if (options.clone && repos.length > 0) {
              const root = await resolveRootOption(options.dir);
              clonedRoot = root;
              const presetOverride =
                options.preset === undefined
                  ? undefined
                  : await requirePreset(options.preset, options.json, "discover");
              const customPresets = await readCustomPresets(process.env);
              const userLogin = await github.getUserLogin();
              const orgs = await github.getActiveOrgs();
              const config = await loadWorkspace(root, presetOverride, process.env);
              const emit: EmitProgress = options.json ? jsonEmit() : progressEmit();
              const syncResult = await syncRepos({
                root,
                config,
                repos,
                userLogin,
                orgs,
                token: auth.token,
                depth,
                blobless: options.blobless === true,
                customPresets,
                emit,
              });
              await refreshCodeIndexIfPresent(
                root,
                await loadWorkspace(root, presetOverride, process.env),
              );
              clonedSummary = {
                synced: syncResult.done.length,
                skipped: syncResult.skipped.length,
                failed: syncResult.failed.length,
              };
              if (syncResult.failed.length > 0) {
                process.exitCode = 1;
              }
            }

            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({
                  command: "discover",
                  ok: clonedSummary === undefined || clonedSummary.failed === 0,
                  query: fullQuery,
                  count: repos.length,
                  repos: repos.map((r) => ({
                    key: `${r.owner}/${r.name}`,
                    owner: r.owner,
                    name: r.name,
                    description: r.description,
                    language: r.language,
                    stars: r.stars ?? 0,
                    isFork: r.isFork,
                    isArchived: r.isArchived,
                    updatedAt: r.updatedAt,
                    httpsUrl: r.httpsUrl,
                  })),
                  ...(clonedSummary !== undefined
                    ? { root: clonedRoot, clone: clonedSummary }
                    : {}),
                })}\n`,
              );
              return;
            }

            if (repos.length === 0) {
              process.stdout.write(`no repositories matched: ${fullQuery}\n`);
              return;
            }

            for (const repo of repos) {
              const stars =
                repo.stars !== null && repo.stars !== undefined ? `\u2605${repo.stars}` : "\u26050";
              const lang = repo.language ? ` [${repo.language}]` : "";
              const desc = repo.description ? ` \u2014 ${repo.description}` : "";
              process.stdout.write(`${repo.owner}/${repo.name} (${stars})${lang}${desc}\n`);
            }
            if (clonedSummary !== undefined) {
              process.stdout.write(
                `clone summary: ${clonedSummary.synced} synced, ${clonedSummary.skipped} skipped, ${clonedSummary.failed} failed\n`,
              );
            }
          },
          { command: "discover", json: options.json },
        );
      },
    );
}

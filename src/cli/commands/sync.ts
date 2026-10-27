import path from "node:path";
import type { Command } from "commander";
import { collectScopeRepos, describeSyncScope, parseSyncScope } from "../../cliSupport.ts";
import { PRESET_IDS } from "../../presets/index.ts";
import {
  createCloneLimiter,
  type DivergenceStrategy,
  type EmitProgress,
  isDivergenceStrategy,
} from "../../services/cloner.ts";
import { refreshCodeIndexIfPresent } from "../../services/codeSearch.ts";
import { filterReposByKey, parseFilterFlags } from "../../services/filters.ts";
import type { RepoInfo } from "../../services/github.ts";
import { resolveRepoRef } from "../../services/launcher.ts";
import { resolveProfileKeys } from "../../services/profiles.ts";
import {
  readCustomPresets,
  readSettings,
  resolveGithubBaseUrl,
  resolveSyncSettings,
} from "../../services/settings.ts";
import { executeConflictAction, getConflictResolutionGuide } from "../../services/syncResolver.ts";
import { loadWorkspace, syncRepos } from "../../services/workspace.ts";
import {
  type CliContext,
  exitFail,
  jsonEmit,
  parseIntStrict,
  progressEmit,
  requireExistingRoot,
  requirePreset,
  resolveRootOption,
  runAction,
} from "../shared.ts";

export function register(program: Command, ctx: CliContext): void {
  const syncCommand = program
    .command("sync")
    .description("Clone or update repositories in bulk, without the interactive interface.")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .option("-p, --preset <id>", `preset for the target layout: ${PRESET_IDS.join(", ")}`)
    .option(
      "-s, --scope <scope>",
      'repositories to sync: "user" (your own repositories), "org:<name>" (a single organization), or "all" (your repositories plus every active organization)',
      "user",
    )
    .option("--pinned", "sync only repositories pinned in the workspace")
    .option("--profile <name>", "sync only repositories in the named workspace profile")
    .option(
      "-l, --limit <n>",
      "sync only the first N repositories of the resolved scope, in API order",
    )
    .option(
      "-c, --concurrency <n>",
      "how many repositories to sync in parallel (default: 3; also settable as sync.concurrency)",
    )
    .option(
      "--depth <n>",
      "create shallow clones with the given commit depth (applies to new clones only)",
    )
    .option(
      "--blobless",
      "create blobless partial clones (git clone --filter=blob:none; applies to new clones only)",
    )
    .option(
      "--stash",
      "stash uncommitted changes before updating a repository and restore them afterwards",
    )
    .option(
      "--divergence <strategy>",
      'what to do when a repository has local commits ahead of origin: "fail" (default), "rebase", "reset" (discards local commits), or "skip"',
    )
    .option(
      "--include <glob>",
      "include repositories matching glob (repeatable)",
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .option(
      "--exclude <glob>",
      "exclude repositories matching glob (repeatable)",
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .option(
      "--watch [seconds]",
      "keep syncing at a fixed interval (default 300 seconds; Ctrl+C stops)",
    )
    .option("--base-url <url>", "GitHub Enterprise base URL (e.g. https://ghe.example.com)")
    .option("--json", "Output results as JSON")
    .action(
      async (options: {
        dir?: string;
        preset?: string;
        scope: string;
        pinned?: boolean;
        profile?: string;
        limit?: string;
        concurrency?: string;
        depth?: string;
        blobless?: boolean;
        stash?: boolean;
        divergence?: string;
        include?: string[];
        exclude?: string[];
        watch?: string | boolean;
        baseUrl?: string;
        json?: boolean;
      }) => {
        await runAction(
          async () => {
            const scope = parseSyncScope(options.scope);
            if (scope === null) {
              exitFail(
                `invalid scope: ${options.scope} (expected user, org:<name>, or all)`,
                options.json,
                "sync",
              );
            }
            let limit: number | undefined;
            if (options.limit !== undefined) {
              limit = parseIntStrict(options.limit, "limit", options.json, "sync");
            }
            let concurrency: number | undefined;
            const rawConc =
              options.concurrency ?? program.opts<{ concurrency?: string }>().concurrency;
            if (rawConc !== undefined) {
              concurrency = parseIntStrict(rawConc, "concurrency", options.json, "sync");
            }
            let depth: number | undefined;
            if (options.depth !== undefined) {
              depth = parseIntStrict(options.depth, "depth", options.json, "sync");
            }
            let divergence: DivergenceStrategy | undefined;
            if (options.divergence !== undefined) {
              if (!isDivergenceStrategy(options.divergence)) {
                exitFail(
                  `invalid divergence: ${options.divergence} (expected fail, rebase, reset, or skip)`,
                  options.json,
                  "sync",
                );
              }
              divergence = options.divergence;
            }
            let watchSeconds: number | undefined;
            if (options.watch !== undefined && options.watch !== false) {
              watchSeconds =
                options.watch === true
                  ? 300
                  : parseIntStrict(options.watch, "watch interval", options.json, "sync");
            }
            const watching = watchSeconds !== undefined;
            const settings = await readSettings(process.env);
            const syncSettings = resolveSyncSettings(settings, {
              concurrency,
              depth,
              blobless: options.blobless === true ? true : undefined,
              stash: options.stash === true ? true : undefined,
              divergence,
            });
            const root = await resolveRootOption(options.dir);
            const presetOverride =
              options.preset === undefined
                ? undefined
                : await requirePreset(options.preset, options.json, "sync");
            const customPresets = await readCustomPresets(process.env);
            const auth = await ctx.requireAuth();
            const baseUrl = await resolveGithubBaseUrl(process.env, options.baseUrl);
            const github = ctx.buildGithub(auth.token, baseUrl);
            const userLogin = await github.getUserLogin();
            const orgs = await github.getActiveOrgs();

            const runOnce = async (): Promise<void> => {
              const config = await loadWorkspace(root, presetOverride, process.env);
              const scopeLabel = options.profile
                ? `profile:${options.profile}`
                : options.pinned
                  ? "pinned"
                  : describeSyncScope(scope);

              let repos: RepoInfo[];
              if (options.pinned || options.profile !== undefined) {
                const targetKeys = new Map<string, { owner: string; name: string }>();
                if (options.pinned) {
                  for (const key of config.pinned ?? []) {
                    const [owner, name] = key.split("/");
                    if (owner && name) targetKeys.set(key.toLowerCase(), { owner, name });
                  }
                }
                if (options.profile !== undefined) {
                  const profileKeys = resolveProfileKeys(config, options.profile);
                  if (profileKeys === null) {
                    exitFail(`profile not found: ${options.profile}`, options.json, "sync");
                  }
                  for (const key of profileKeys) {
                    const [owner, name] = key.split("/");
                    if (owner && name) targetKeys.set(key.toLowerCase(), { owner, name });
                  }
                }
                if (targetKeys.size === 0) {
                  if (options.json) {
                    process.stdout.write(
                      `${JSON.stringify({
                        command: "sync",
                        ok: true,
                        root,
                        scope: scopeLabel,
                        synced: [],
                        skipped: [],
                        failed: [],
                        summary: { synced: 0, skipped: 0, failed: 0 },
                      })}\n`,
                    );
                    return;
                  }
                  process.stdout.write("nothing to sync (0 repositories in selection)\n");
                  return;
                }
                const fetchLimiter = createCloneLimiter(5);
                repos = await Promise.all(
                  [...targetKeys.values()].map(({ owner, name }) =>
                    fetchLimiter(() => github.getRepo(owner, name)),
                  ),
                );
              } else {
                repos = await collectScopeRepos(github, scope);
              }

              // Apply filters BEFORE limit
              const includes = parseFilterFlags(options.include);
              const excludes = parseFilterFlags(options.exclude);
              if (includes.length > 0 || excludes.length > 0) {
                repos = filterReposByKey(repos, includes, excludes);
                if (repos.length === 0) {
                  if (options.json) {
                    process.stdout.write(
                      `${JSON.stringify({
                        command: "sync",
                        ok: true,
                        root,
                        scope: scopeLabel,
                        synced: [],
                        skipped: [],
                        failed: [],
                        summary: { synced: 0, skipped: 0, failed: 0 },
                      })}\n`,
                    );
                    return;
                  }
                  process.stdout.write("nothing to sync (0 repositories matched the filters)\n");
                  return;
                }
              }

              if (limit !== undefined) repos = repos.slice(0, limit);
              const emit: EmitProgress = options.json ? jsonEmit() : progressEmit();

              const result = await syncRepos({
                root,
                config,
                repos,
                userLogin,
                orgs,
                token: auth.token,
                concurrency: syncSettings.concurrency,
                depth: syncSettings.depth,
                blobless: syncSettings.blobless,
                stash: syncSettings.stash,
                divergence: syncSettings.divergence,
                customPresets,
                emit,
              });
              await refreshCodeIndexIfPresent(
                root,
                await loadWorkspace(root, presetOverride, process.env),
              );

              if (options.json) {
                const payload = {
                  command: "sync",
                  ok: result.failed.length === 0,
                  root,
                  scope: scopeLabel,
                  synced: result.done.map((entry) => ({
                    key: entry.key,
                    relativePath: entry.relativePath,
                    internal: entry.internal,
                  })),
                  skipped: result.skipped.map((s) => ({ key: s.key, message: s.message })),
                  failed: result.failed.map((f) => ({ key: f.key, message: f.message })),
                  summary: {
                    synced: result.done.length,
                    skipped: result.skipped.length,
                    failed: result.failed.length,
                  },
                };
                process.stdout.write(`${JSON.stringify(payload)}\n`);
                if (result.failed.length > 0 && !watching) {
                  process.exitCode = 1;
                  return;
                }
                return;
              }

              for (const skip of result.skipped) {
                process.stdout.write(`[skipped] ${skip.key} (${skip.message})\n`);
              }
              process.stdout.write(
                `summary: ${result.done.length} synced, ${result.skipped.length} skipped, ${result.failed.length} failed (scope: ${scopeLabel}${limit !== undefined ? `, limit ${limit}` : ""})\n`,
              );
              if (result.failed.length > 0 && !watching) {
                process.exitCode = 1;
                return;
              }
            };

            if (!watching) {
              await runOnce();
              return;
            }
            process.on("SIGINT", () => {
              // Documented process.exit exception: the watch loop keeps timers
              // alive, so the signal handler must terminate the process itself.
              process.exit(0);
            });
            for (;;) {
              await runOnce();
              process.stdout.write(`[watch] next sync in ${watchSeconds}s (Ctrl+C to stop)\n`);
              await new Promise((resolve) => setTimeout(resolve, watchSeconds! * 1000));
            }
          },
          { command: "sync", json: options.json },
        );
      },
    );

  syncCommand
    .command("resolve [repo]")
    .description("Inspect git conflict / rebase state and get actionable resolution steps.")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option("--action <action>", "action to execute: continue or abort")
    .option("--json", "Output resolution guide as JSON")
    .action(
      async (
        repoArg: string | undefined,
        options: { dir?: string; action?: string; json?: boolean },
      ) => {
        await runAction(
          async () => {
            const root = await requireExistingRoot(options.dir);
            const config = await loadWorkspace(root);
            let targetRepoDir = root;
            if (repoArg) {
              const match = resolveRepoRef(config, repoArg);
              if (match === null) {
                exitFail(`repository not found: ${repoArg}`);
              }
              targetRepoDir = path.join(root, ...match.entry.relativePath.split("/"));
            }

            if (options.action) {
              if (options.action !== "continue" && options.action !== "abort") {
                exitFail("action must be 'continue' or 'abort'");
              }
              const res = await executeConflictAction(targetRepoDir, options.action);
              if (!res.ok) {
                exitFail(res.message);
              }
              if (options.json) {
                process.stdout.write(
                  `${JSON.stringify({ command: "sync resolve", ok: true, message: res.message })}\n`,
                );
                return;
              }
              process.stdout.write(`${res.message}\n`);
              return;
            }

            const guide = await getConflictResolutionGuide(targetRepoDir);
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({ command: "sync resolve", ok: true, guide })}\n`,
              );
              return;
            }

            process.stdout.write(`Repository: ${guide.repoPath}\n`);
            process.stdout.write(`Status: ${guide.statusDescription}\n\n`);
            if (guide.suggestedSteps.length > 0) {
              process.stdout.write("Resolution Steps:\n");
              for (const step of guide.suggestedSteps) {
                process.stdout.write(`  ${step}\n`);
              }
            }
          },
          { command: "sync resolve", json: options.json },
        );
      },
    );
}

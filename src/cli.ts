import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Command, Option, program } from "commander";
import {
  collectScopeRepos,
  describeSyncScope,
  detectTuiRuntimeError,
  formatWorkspaceLine,
  parseSyncScope,
} from "./cliSupport.ts";
import { isThemeName, THEME_NAMES } from "./components/theme.ts";
import { isPresetId, PRESET_IDS, type PresetRef, validateCustomPreset } from "./presets/index.ts";
import {
  AuthError,
  cachedLoginExists,
  deviceLogin,
  getAuthInfo,
  logout,
  probeAuth,
} from "./services/auth.ts";
import { listWorkspaceSnapshots } from "./services/backups.ts";
import {
  type CloneProgress,
  type DivergenceStrategy,
  type EmitProgress,
  firstErrorLine,
  isDivergenceStrategy,
} from "./services/cloner.ts";
import {
  type GrammarLang,
  LANG_ALIASES,
  refreshCodeIndexIfPresent,
  SYMBOL_KINDS,
  type SymbolKind,
  searchCode,
} from "./services/codeSearch.ts";
import {
  buildCompletions,
  type CompletionCommand,
  isSupportedShell,
} from "./services/completions.ts";
import { appConfigDir, CONFIG_FILENAME } from "./services/config.ts";
import { createRepository } from "./services/creator.ts";
import { runDoctor } from "./services/doctor.ts";
import { filterReposByKey, parseFilterFlags } from "./services/filters.ts";
import { fileEtagCache, GitHubService } from "./services/github.ts";
import {
  detectApps,
  listAliases,
  removeAlias,
  resolveApp,
  resolveRepoRef,
  runAppInRepo,
  setAlias,
} from "./services/launcher.ts";
import {
  archiveRepository,
  deleteRepository,
  forgetRepository,
  pruneWorkspace,
  workspaceStatus,
} from "./services/lifecycle.ts";
import { moveRepository } from "./services/mover.ts";
import { reorganizeWorkspace } from "./services/reorganizer.ts";
import { runInRepos } from "./services/runner.ts";
import {
  DEFAULT_GITHUB_BASE_URL,
  effectiveRoot,
  normalizeBaseUrl,
  osDefaultRoot,
  type RepotruckSettings,
  readCustomPresets,
  readSettings,
  resolveGithubBaseUrl,
  resolveSyncSettings,
  validateRootInput,
  writeSettings,
} from "./services/settings.ts";
import { cloneSingleRepository, GITHUB_HOST } from "./services/singleCloner.ts";
import { calculateWorkspaceStats, walkRepositoriesOnDisk } from "./services/stats.ts";
import {
  applyAgentsMdTemplate,
  clearAgentsMdTemplate,
  listAgentsMdTemplates,
} from "./services/templates.ts";
import { checkForUpdate, performSelfUpdate } from "./services/updater.ts";
import { readVersion } from "./services/version.ts";
import { loadWorkspace, saveWorkspace, syncRepos, toPosixRelative } from "./services/workspace.ts";
import {
  centralStorePath,
  isRegisteredWorkspace,
  listWorkspaces,
  removeWorkspace,
  resolveWorkspaceRoot,
  restoreWorkspaceSnapshot,
} from "./services/workspaceRegistry.ts";

function exitFail(message: string, isJson?: boolean, command?: string): never {
  if (isJson) {
    process.stdout.write(
      `${JSON.stringify({ command: command ?? "repotruck", ok: false, error: message })}\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

async function runAction(
  action: () => Promise<void>,
  options?: { command?: string; json?: boolean },
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (options?.json) {
      const err = error instanceof AuthError ? error.message : firstErrorLine(error);
      process.stdout.write(
        `${JSON.stringify({ command: options.command ?? "repotruck", ok: false, error: err })}\n`,
      );
      process.exit(1);
    }
    if (error instanceof AuthError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`error: ${firstErrorLine(error)}\n`);
    }
    process.exit(1);
  }
}

async function resolveRootOption(dirOption?: string): Promise<string> {
  if (dirOption !== undefined) return path.resolve(dirOption);
  const walked = await resolveWorkspaceRoot(process.cwd());
  if (walked.found) return walked.root;
  const effective = await effectiveRoot(process.env);
  return effective.root;
}

async function requireExistingRoot(dirOption?: string): Promise<string> {
  const root = await resolveRootOption(dirOption);
  const registered = await isRegisteredWorkspace(root);
  const legacy = existsSync(path.join(root, CONFIG_FILENAME));
  if (!registered && !legacy) {
    throw new Error(
      `not a repotruck workspace (no record for it in the central repotruck.json): ${root}`,
    );
  }
  return root;
}

function requirePreset(value: string, json?: boolean, command?: string): Promise<PresetRef> {
  return (async () => {
    if (isPresetId(value)) return value;
    const customs = await readCustomPresets(process.env);
    if (customs.some((preset) => preset.id === value)) return value;
    exitFail(
      `invalid preset: ${value} (expected ${PRESET_IDS.join(", ")}, or a custom preset defined with 'repotruck preset add')`,
      json,
      command,
    );
  })();
}

/** Parses a positive integer, rejecting trailing garbage like "3.5" or "10abc". */
function parseIntStrict(value: string, label: string, json?: boolean, command?: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    exitFail(`invalid ${label}: ${value} (expected a positive integer)`, json, command);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed <= 0) {
    exitFail(`invalid ${label}: ${value} (expected a positive integer)`, json, command);
  }
  return parsed;
}

function jsonEmit(): (p: CloneProgress) => void {
  return (p) => {
    process.stderr.write(`[${p.phase}] ${p.key}\n`);
  };
}

function requireAuth() {
  return getAuthInfo(process.env);
}

/**
 * Shared GitHubService factory: enables the etag conditional-request cache
 * (github-cache.json in the app config dir) unless REPOTRUCK_NO_API_CACHE is
 * set. Unchanged repositories then answer 304 with no payload, which mostly
 * benefits prune's per-repository checks across runs.
 */
function buildGithub(token: string, baseUrl?: string): GitHubService {
  return new GitHubService(token, {
    baseUrl,
    ...(process.env.REPOTRUCK_NO_API_CACHE
      ? {}
      : { etagCache: fileEtagCache(path.join(appConfigDir(process.env), "github-cache.json")) }),
  });
}

function progressEmit(): EmitProgress {
  return (progress) => {
    if (progress.phase === "cloning") {
      process.stdout.write(`[cloning] ${progress.key}\n`);
    } else if (progress.phase === "pulling") {
      process.stdout.write(`[pulling] ${progress.key}\n`);
    } else if (progress.phase === "done") {
      process.stdout.write(`✓ ${progress.key} — ${progress.message ?? "done"}\n`);
    } else {
      process.stdout.write(`✗ ${progress.key} — ${progress.message ?? "failed"}\n`);
    }
  };
}

program
  .name("repotruck")
  .description("Clone and mirror your GitHub repositories into organized local directory layouts.")
  .version(await readVersion())
  .option("-c, --concurrency <number>", "Maximum concurrent git operations (default 3)")
  .option("--verbose", "Show verbose diagnostic warnings and command outputs")
  .option("--no-color", "Disable colors");

program.hook("preAction", (thisCommand) => {
  const opts = thisCommand.opts<{ concurrency?: string; verbose?: boolean; noColor?: boolean }>();
  if (opts.verbose || process.env.REPOTRUCK_VERBOSE === "1") {
    process.env.REPOTRUCK_VERBOSE = "1";
  }
  if (opts.noColor) {
    process.env.NO_COLOR = "1";
  }
});

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
          const auth = await requireAuth();
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
          const github = buildGithub(auth.token, baseUrl);
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

program
  .command("create")
  .description("Create a new GitHub repository and register it in the workspace.")
  .argument("<name>", "new repository name")
  .option(
    "--from <dir>",
    "import an existing local directory (a Git repository must have a clean tree)",
  )
  .option("--at <relative-path>", "place the repository at a custom workspace-relative path")
  .option("--public", "create the repository as public (default: private)")
  .addOption(
    new Option("--private", "create the repository as private (the default)").conflicts("public"),
  )
  .option("--description <text>", "short repository description")
  .option("--org <name>", "create the repository inside this organization")
  .option("--base-url <url>", "GitHub Enterprise base URL (e.g. https://ghe.example.com)")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .action(
    async (
      name: string,
      options: {
        dir?: string;
        from?: string;
        at?: string;
        public?: boolean;
        private?: boolean;
        description?: string;
        org?: string;
        baseUrl?: string;
      },
    ) => {
      await runAction(async () => {
        const root = await resolveRootOption(options.dir);
        const auth = await requireAuth();
        const baseUrl = await resolveGithubBaseUrl(process.env, options.baseUrl);
        const github = buildGithub(auth.token, baseUrl);
        const userLogin = await github.getUserLogin();
        const orgs = await github.getActiveOrgs();
        const config = await loadWorkspace(root);
        const result = await createRepository({
          root,
          config,
          github,
          token: auth.token,
          userLogin,
          orgs,
          customPresets: await readCustomPresets(process.env),
          options: {
            name,
            org: options.org,
            isPrivate: options.public !== true,
            description: options.description,
            customPath: options.at,
            fromDir: options.from,
          },
          emit: (message) => process.stdout.write(`${message}\n`),
        });
        if (!result.ok) exitFail(result.message);
        process.stdout.write(`✓ ${result.message}\n`);
      });
    },
  );

program
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
          const auth = await requireAuth();
          const baseUrl = await resolveGithubBaseUrl(process.env, options.baseUrl);
          const github = buildGithub(auth.token, baseUrl);
          const userLogin = await github.getUserLogin();
          const orgs = await github.getActiveOrgs();

          const runOnce = async (): Promise<void> => {
            let repos = await collectScopeRepos(github, scope);

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
                      scope: describeSyncScope(scope),
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
            const config = await loadWorkspace(root, presetOverride, process.env);
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
                scope: describeSyncScope(scope),
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
              if (result.failed.length > 0 && !watching) process.exit(1);
              return;
            }

            for (const skip of result.skipped) {
              process.stdout.write(`[skipped] ${skip.key} (${skip.message})\n`);
            }
            process.stdout.write(
              `summary: ${result.done.length} synced, ${result.skipped.length} skipped, ${result.failed.length} failed (scope: ${describeSyncScope(scope)}${limit !== undefined ? `, limit ${limit}` : ""})\n`,
            );
            if (result.failed.length > 0 && !watching) process.exit(1);
          };

          if (!watching) {
            await runOnce();
            return;
          }
          process.on("SIGINT", () => {
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

program
  .command("reorganize")
  .description("Move every tracked repository to its path for a new preset.")
  .argument("<preset>", `target preset: ${PRESET_IDS.join(", ")} or a custom preset id`)
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .option("--scan", "also discover untracked Git repositories on disk and adopt them")
  .option("--dry-run", "show the move plan without touching anything")
  .option("--keep-custom", "keep manually placed (custom) repositories where they are")
  .option("--json", "Output the plan/result as JSON")
  .action(
    async (
      preset: string,
      options: {
        dir?: string;
        scan?: boolean;
        dryRun?: boolean;
        keepCustom?: boolean;
        json?: boolean;
      },
    ) => {
      await runAction(
        async () => {
          const target = await requirePreset(preset, options.json, "reorganize");
          const root = await requireExistingRoot(options.dir);
          const result = await reorganizeWorkspace(root, target, {
            scan: options.scan === true,
            dryRun: options.dryRun === true,
            keepCustom: options.keepCustom === true,
            env: process.env,
            customPresets: await readCustomPresets(process.env),
          });
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ command: "reorganize", ok: true, dryRun: options.dryRun === true, ...result })}\n`,
            );
            if (result.failed.length > 0 || result.collisions.length > 0) process.exit(1);
            return;
          }
          const prefix = options.dryRun === true ? "[dry-run] " : "";
          for (const move of result.moved) {
            process.stdout.write(`${prefix}moved: ${move.key} (${move.from} -> ${move.to})\n`);
          }
          for (const skip of result.skipped) {
            process.stdout.write(`${prefix}skipped: ${skip.key} (${skip.reason})\n`);
          }
          for (const collision of result.collisions) {
            process.stdout.write(
              `${prefix}collision: ${collision.key} -> ${collision.target} (occupied by ${collision.occupiedBy})\n`,
            );
          }
          for (const failure of result.failed) {
            process.stdout.write(`${prefix}failed: ${failure.key} (${failure.message})\n`);
          }
          process.stdout.write(
            `${prefix}summary: ${result.moved.length} moved, ${result.skipped.length} skipped, ${result.collisions.length} collisions, ${result.failed.length} failed\n`,
          );
          if (result.failed.length > 0 || result.collisions.length > 0) process.exit(1);
        },
        { command: "reorganize", json: options.json },
      );
    },
  );

program
  .command("move")
  .description("Move a tracked repository to a custom path and mark it as manually placed.")
  .argument("<owner/name>", 'repository key as "owner/name"')
  .argument("<relative-path>", "new workspace-relative destination path")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .action(async (key: string, destRelative: string, options: { dir?: string }) => {
    await runAction(async () => {
      const root = await requireExistingRoot(options.dir);
      const config = await loadWorkspace(root);
      const result = await moveRepository(root, config, key, destRelative, {
        emit: (message) => process.stdout.write(`${message}\n`),
      });
      if (!result.ok) exitFail(result.message);
      process.stdout.write(`✓ ${result.message}\n`);
    });
  });

program
  .command("forget")
  .description("Stop tracking a repository; the clone stays on disk untouched.")
  .argument("<repo>", 'repository to forget: "owner/name", an alias, or a workspace-relative path')
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .action(async (ref: string, options: { dir?: string }) => {
    await runAction(async () => {
      const root = await requireExistingRoot(options.dir);
      const config = await loadWorkspace(root);
      const result = await forgetRepository(root, config, ref);
      if (!result.ok) exitFail(result.message);
      process.stdout.write(`✓ ${result.message}\n`);
    });
  });

program
  .command("prune")
  .description(
    "Untrack repositories that were deleted on GitHub (or became inaccessible). Repositories with unclear answers are kept and reported.",
  )
  .option("--dry-run", "only list what would be pruned; change nothing")
  .option("--base-url <url>", "GitHub Enterprise base URL (e.g. https://ghe.example.com)")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .option("--json", "Output results as JSON")
  .action(async (options: { dryRun?: boolean; dir?: string; baseUrl?: string; json?: boolean }) => {
    await runAction(
      async () => {
        const root = await requireExistingRoot(options.dir);
        const config = await loadWorkspace(root);
        const auth = await requireAuth();
        const baseUrl = await resolveGithubBaseUrl(process.env, options.baseUrl);
        const github = buildGithub(auth.token, baseUrl);
        const result = await pruneWorkspace(
          root,
          config,
          github,
          {
            dryRun: options.dryRun === true,
          },
          process.env,
        );
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify({
              command: "prune",
              ok: result.ok,
              message: result.message,
              lines: result.lines ?? [],
            })}\n`,
          );
          if (!result.ok) process.exit(1);
          return;
        }
        for (const line of result.lines ?? []) {
          process.stdout.write(`${line}\n`);
        }
        if (!result.ok) exitFail(result.message);
        process.stdout.write(`✓ ${result.message}\n`);
      },
      { command: "prune", json: options.json },
    );
  });

program
  .command("delete")
  .description("Stop tracking a repository and permanently remove its directory from disk.")
  .argument("<repo>", 'repository to delete: "owner/name", an alias, or a workspace-relative path')
  .option("--yes", "confirm the deletion (required; this permanently removes the directory)")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .action(async (ref: string, options: { yes?: boolean; dir?: string }) => {
    await runAction(async () => {
      const root = await requireExistingRoot(options.dir);
      const config = await loadWorkspace(root);
      const result = await deleteRepository(root, config, ref, {
        yes: options.yes === true,
      });
      if (!result.ok) exitFail(result.message);
      process.stdout.write(`✓ ${result.message}\n`);
    });
  });

program
  .command("archive")
  .description("Archive the repository on GitHub and re-file it under the archived category.")
  .argument("<repo>", 'repository to archive: "owner/name", an alias, or a workspace-relative path')
  .option("--base-url <url>", "GitHub Enterprise base URL (e.g. https://ghe.example.com)")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .action(async (ref: string, options: { dir?: string; baseUrl?: string }) => {
    await runAction(async () => {
      const root = await requireExistingRoot(options.dir);
      const config = await loadWorkspace(root);
      const auth = await requireAuth();
      const baseUrl = await resolveGithubBaseUrl(process.env, options.baseUrl);
      const github = buildGithub(auth.token, baseUrl);
      const result = await archiveRepository(root, config, ref, github);
      if (!result.ok) exitFail(result.message);
      process.stdout.write(`✓ ${result.message}\n`);
    });
  });

program
  .command("status")
  .description("Show per-repository health: dirty state, ahead/behind, category, aliases.")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .option("--json", "Output results as JSON")
  .action(async (options: { dir?: string; json?: boolean }) => {
    await runAction(
      async () => {
        const root = await requireExistingRoot(options.dir);
        const config = await loadWorkspace(root);
        const status = await workspaceStatus(root, config);
        if (options.json) {
          const payload = {
            command: "status",
            ok: true,
            root,
            lastSync: status.lastSync,
            repos: status.repos.map((r) => ({ key: r.key, line: r.line })),
          };
          process.stdout.write(`${JSON.stringify(payload)}\n`);
          return;
        }
        process.stdout.write(`last sync (workspace): ${status.lastSync ?? "never"}\n`);
        if (status.repos.length === 0) {
          process.stdout.write("no repositories tracked\n");
          return;
        }
        for (const repo of status.repos) {
          process.stdout.write(`${repo.line}\n`);
        }
      },
      { command: "status", json: options.json },
    );
  });

program
  .command("workspaces")
  .description("List or remove registered repotruck workspaces.")
  .argument("[action]", '"list" (the default) or "remove"')
  .argument("[path]", 'workspace path to remove (required with "remove")')
  .option("--json", "Output the workspace listing as JSON")
  .action(
    async (action: string | undefined, wsPath: string | undefined, options: { json?: boolean }) => {
      await runAction(
        async () => {
          const verb = action ?? "list";
          if (verb !== "list" && verb !== "remove") {
            exitFail(
              `unknown action: ${verb} (expected "list" or "remove")`,
              options.json,
              "workspaces",
            );
          }
          if (verb === "list") {
            process.stdout.write(`workspace records: ${centralStorePath()}\n`);
            const listing = await listWorkspaces();
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({ command: "workspaces", ok: true, workspaces: listing })}\n`,
              );
              return;
            }
            if (listing.length === 0) {
              process.stdout.write("no registered workspaces\n");
              return;
            }
            for (const item of listing) {
              process.stdout.write(`${formatWorkspaceLine(item)}\n`);
            }
            return;
          }
          if (wsPath === undefined || wsPath.length === 0) {
            exitFail(
              "workspaces remove requires a path (see: repotruck workspaces --help)",
              options.json,
              "workspaces",
            );
          }
          const removed = await removeWorkspace(wsPath);
          if (removed === null) {
            exitFail(
              `workspace not found: ${wsPath} (records: ${centralStorePath()})`,
              options.json,
              "workspaces",
            );
          }
          process.stdout.write(
            `✓ removed workspace: ${removed.root} — records: ${centralStorePath()}\n`,
          );
        },
        { command: "workspaces", json: options.json },
      );
    },
  );

program
  .command("config")
  .description("Read and write repotruck settings (settings.json in the app config dir).")
  .argument("<action>", "get, set, unset, or list")
  .argument(
    "[key]",
    "settings key (defaultRoot, sync.concurrency, sync.depth, sync.blobless, sync.stash, sync.divergence, github.baseUrl)",
  )
  .argument("[value]", "new value for 'config set'")
  .action(async (action: string, key?: string, value?: string) => {
    await runAction(async () => {
      if (action !== "get" && action !== "set" && action !== "unset" && action !== "list") {
        exitFail(`unknown action: ${action} (expected get, set, unset, or list)`);
      }
      const settings = await readSettings(process.env);
      const resolved = resolveSyncSettings(settings);
      const rows: Array<{ key: string; value: string; source: "settings" | "default" }> = [
        {
          key: "defaultRoot",
          value: settings.defaultRoot ?? "(not set)",
          source: settings.defaultRoot === undefined ? "default" : "settings",
        },
        {
          key: "sync.concurrency",
          value: String(resolved.concurrency),
          source: settings.sync?.concurrency === undefined ? "default" : "settings",
        },
        {
          key: "sync.depth",
          value: resolved.depth === undefined ? "(off)" : String(resolved.depth),
          source: settings.sync?.depth === undefined ? "default" : "settings",
        },
        {
          key: "sync.blobless",
          value: resolved.blobless ? "true" : "false",
          source: settings.sync?.blobless === undefined ? "default" : "settings",
        },
        {
          key: "sync.stash",
          value: resolved.stash ? "true" : "false",
          source: settings.sync?.stash === undefined ? "default" : "settings",
        },
        {
          key: "sync.divergence",
          value: resolved.divergence,
          source: settings.sync?.divergence === undefined ? "default" : "settings",
        },
        {
          key: "github.baseUrl",
          value: settings.github?.baseUrl ?? DEFAULT_GITHUB_BASE_URL,
          source: settings.github?.baseUrl === undefined ? "default" : "settings",
        },
        {
          key: "theme",
          value: settings.theme ?? "default",
          source: settings.theme === undefined ? "default" : "settings",
        },
      ];
      const validKeys = rows.map((row) => row.key);

      if (action === "list") {
        if (key !== undefined) {
          exitFail(`config list takes no key (got ${key})`);
        }
        for (const row of rows) {
          process.stdout.write(`${row.key}: ${row.value} (${row.source})\n`);
        }
        return;
      }

      if (key === undefined || key.length === 0) {
        exitFail(`config ${action} requires a key (expected ${validKeys.join(", ")})`);
      }
      const row = rows.find((item) => item.key === key);
      if (row === undefined) {
        exitFail(`unknown config key: ${key} (expected ${validKeys.join(", ")})`);
      }

      if (action === "get") {
        process.stdout.write(`${row.key}: ${row.value} (${row.source})\n`);
        return;
      }

      if (action === "unset") {
        let next: RepotruckSettings = { ...settings };
        if (key === "defaultRoot") {
          const { defaultRoot: _removed, ...rest } = next;
          void _removed;
          next = rest;
        } else if (key.startsWith("sync.")) {
          const sub = key.slice("sync.".length);
          const sync = { ...(next.sync ?? {}) } as Record<string, unknown>;
          delete sync[sub];
          next = { ...next, sync };
        } else if (key === "github.baseUrl") {
          const { baseUrl: _removed, ...githubRest } = next.github ?? {};
          void _removed;
          next = {
            ...next,
            ...(Object.keys(githubRest).length > 0 ? { github: githubRest } : {}),
          };
        } else if (key === "theme") {
          const { theme: _removed, ...rest } = next;
          void _removed;
          next = rest;
        }
        await writeSettings(process.env, next);
        process.stdout.write(`✓ ${key} unset\n`);
        return;
      }

      if (value === undefined) {
        exitFail(`config set requires a value for ${key}`);
      }
      let next: RepotruckSettings = { ...settings };
      if (key === "defaultRoot") {
        const validated = validateRootInput(value);
        if (!validated.ok) exitFail(validated.error);
        next = { ...next, defaultRoot: validated.root };
      } else if (key === "sync.concurrency" || key === "sync.depth") {
        const parsed = parseIntStrict(value, `value for ${key}`);
        const sync = { ...(next.sync ?? {}) };
        if (key === "sync.concurrency") sync.concurrency = parsed;
        else sync.depth = parsed;
        next = { ...next, sync };
      } else if (key === "sync.blobless" || key === "sync.stash") {
        const parsed = value === "true" ? true : value === "false" ? false : null;
        if (parsed === null) {
          exitFail(`invalid value for ${key}: ${value} (expected true or false)`);
        }
        const sync = { ...(next.sync ?? {}) };
        if (key === "sync.blobless") sync.blobless = parsed;
        else sync.stash = parsed;
        next = { ...next, sync };
      } else if (key === "github.baseUrl") {
        try {
          const normalized = normalizeBaseUrl(value);
          next = { ...next, github: { ...(next.github ?? {}), baseUrl: normalized } };
        } catch (error) {
          exitFail(firstErrorLine(error));
        }
      } else if (key === "theme") {
        if (!isThemeName(value)) {
          exitFail(`invalid value for theme: ${value} (expected ${THEME_NAMES.join(", ")})`);
        }
        next = { ...next, theme: value };
      } else {
        if (!isDivergenceStrategy(value)) {
          exitFail(
            `invalid value for sync.divergence: ${value} (expected fail, rebase, reset, or skip)`,
          );
        }
        next = { ...next, sync: { ...(next.sync ?? {}), divergence: value } };
      }
      await writeSettings(process.env, next);
      process.stdout.write(`✓ ${key} set\n`);
    });
  });

program
  .command("update")
  .description("Check for a newer repotruck release and self-update global installs.")
  .option("--json", "Output the check result as JSON")
  .action(async (options: { json?: boolean }) => {
    await runAction(
      async () => {
        if (process.env.REPOTRUCK_NO_UPDATE_CHECK) {
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({ command: "update", ok: true, disabled: true, currentVersion: await readVersion() })}\n`,
            );
            process.exit(0);
          }
          process.stdout.write("update checks are disabled (REPOTRUCK_NO_UPDATE_CHECK is set)\n");
          process.exit(0);
        }
        const result = await checkForUpdate(process.env, { force: true });
        if (!result.updateAvailable || result.latestVersion === null) {
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify({
                command: "update",
                ok: true,
                currentVersion: result.currentVersion,
                latestVersion: result.latestVersion,
                updateAvailable: false,
              })}\n`,
            );
            process.exit(0);
          }
          process.stdout.write(`already up to date (${result.currentVersion})\n`);
          process.exit(0);
        }
        if (!options.json) {
          process.stdout.write(
            `updating repotruck ${result.currentVersion} -> ${result.latestVersion}\n`,
          );
        }
        const outcome = await performSelfUpdate();
        if (!outcome.updated) {
          exitFail(outcome.message, options.json, "update");
        }
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify({
              command: "update",
              ok: true,
              currentVersion: result.currentVersion,
              latestVersion: result.latestVersion,
              updateAvailable: true,
              updated: true,
              message: outcome.message,
            })}\n`,
          );
          return;
        }
        process.stdout.write(`✓ ${outcome.message}\n`);
      },
      { command: "update", json: options.json },
    );
  });

program
  .command("root")
  .description("Show, set, or reset the default workspace root used when no workspace is found.")
  .argument("[path]", "new default root (absolute path, ~ allowed)")
  .option("--reset", "clear the saved default root and return to the OS default")
  .action(async (pathArg: string | undefined, options: { reset?: boolean }) => {
    await runAction(async () => {
      if (options.reset === true) {
        if (pathArg !== undefined) {
          exitFail("root --reset takes no path argument (see: repotruck root --help)");
        }
        const settings = await readSettings(process.env);
        const { defaultRoot: _cleared, ...rest } = settings;
        void _cleared;
        await writeSettings(process.env, rest);
        process.stdout.write(
          `✓ default root cleared; new sessions use the OS default: ${osDefaultRoot(process.env)}\n`,
        );
        return;
      }
      if (pathArg === undefined) {
        const effective = await effectiveRoot(process.env);
        process.stdout.write(
          `default root: ${effective.root}${effective.fromOverride ? " (settings override)" : " (OS default)"}\n`,
        );
        return;
      }
      const validated = validateRootInput(pathArg, process.env);
      if (!validated.ok) exitFail(validated.error);
      const settings = await readSettings(process.env);
      await writeSettings(process.env, { ...settings, defaultRoot: validated.root });
      process.stdout.write(`✓ default root set: ${validated.root}\n`);
    });
  });

program
  .command("open")
  .description("Open a tracked repository in an editor or agent app.")
  .argument("<repo>", "repository alias, workspace-relative path, or owner/name")
  .argument("[app]", "app name (builtin, custom apps.json entry, or bare PATH executable)")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .action(async (repo: string, app: string | undefined, options: { dir?: string }) => {
    await runAction(async () => {
      const root = await requireExistingRoot(options.dir);
      const config = await loadWorkspace(root);
      if (app === undefined) {
        const detected = await detectApps({ env: process.env });
        process.stdout.write("Detected apps:\n");
        if (detected.length === 0) {
          process.stdout.write("  (none — add entries to apps.json in the app config dir)\n");
        } else {
          for (const detectedApp of detected) {
            process.stdout.write(`  ${detectedApp.name}\n`);
          }
        }
        process.stdout.write("usage: repotruck open <repo> <app>\n");
        return;
      }
      const resolved = await resolveApp(app, { env: process.env });
      if (resolved === null) {
        const detected = await detectApps({ env: process.env });
        exitFail(
          `unknown app: ${app}. Available apps: ${
            detected.map((item) => item.name).join(", ") || "none detected"
          }`,
        );
      }
      const match = resolveRepoRef(config, repo);
      if (match === null) {
        const candidates = [
          ...listAliases(config).map((item) => item.alias),
          ...config.repos.map((item) => item.relativePath),
          ...config.repos.map((item) => `${item.owner}/${item.name}`),
        ];
        const needle = repo.toLowerCase();
        const close = candidates.filter((candidate) => candidate.toLowerCase().includes(needle));
        exitFail(
          `repository not found: ${repo}.${
            close.length > 0
              ? ` Did you mean: ${close.slice(0, 5).join(", ")}?`
              : " Tracked repositories: none match."
          }`,
        );
      }
      process.stdout.write(`opening ${match.dir} in ${resolved.name}...\n`);
      const result = await runAppInRepo({
        root,
        config,
        ref: repo,
        app: resolved,
        mode: "foreground",
      });
      if (result.message !== undefined && !result.ok) {
        exitFail(result.message);
      }
      process.exit(result.code ?? 1);
    });
  });

const aliasCommand = program
  .command("alias")
  .description("Manage repository aliases (short names usable with `open`).");

aliasCommand
  .command("set")
  .description("Set an alias for a tracked repository.")
  .argument("<alias>", "alias name (letters, digits, dots, dashes, underscores)")
  .argument("<repo>", "repository alias, workspace-relative path, or owner/name")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .action(async (alias: string, repo: string, options: { dir?: string }) => {
    await runAction(async () => {
      const root = await requireExistingRoot(options.dir);
      const config = await loadWorkspace(root);
      const result = setAlias(config, alias, repo);
      if (!result.ok) exitFail(result.message);
      await saveWorkspace(root, result.config);
      process.stdout.write(`✓ ${result.message}\n`);
    });
  });

aliasCommand
  .command("remove")
  .description("Remove a repository alias.")
  .argument("<alias>", "alias name")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .action(async (alias: string, options: { dir?: string }) => {
    await runAction(async () => {
      const root = await requireExistingRoot(options.dir);
      const config = await loadWorkspace(root);
      const result = removeAlias(config, alias);
      if (!result.ok) exitFail(result.message);
      await saveWorkspace(root, result.config);
      process.stdout.write(`✓ ${result.message}\n`);
    });
  });

aliasCommand
  .command("list")
  .description("List all repository aliases.")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .option("--json", "Output aliases as JSON")
  .action(async (options: { dir?: string; json?: boolean }) => {
    await runAction(
      async () => {
        const root = await resolveRootOption(options.dir);
        const config = await loadWorkspace(root);
        const listings = listAliases(config);
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify({ command: "alias list", ok: true, aliases: listings })}\n`,
          );
          return;
        }
        if (listings.length === 0) {
          process.stdout.write("no aliases defined\n");
          return;
        }
        for (const item of listings) {
          process.stdout.write(`${item.alias} -> ${item.target}\n`);
        }
      },
      { command: "alias list", json: options.json },
    );
  });

const authCommand = program.command("auth").description("Manage GitHub authentication.");

authCommand
  .command("login")
  .description("Authenticate repotruck with GitHub using the OAuth device flow.")
  .option("--base-url <url>", "GitHub Enterprise base URL (e.g. https://ghe.example.com)")
  .action(async (options: { baseUrl?: string }) => {
    await runAction(async () => {
      if (process.env.REPOTRUCK_TOKEN !== undefined && process.env.REPOTRUCK_TOKEN.length > 0) {
        process.stdout.write(
          "already logged in (method: env) - unset REPOTRUCK_TOKEN to use the device flow\n",
        );
        return;
      }
      if (await cachedLoginExists(process.env)) {
        process.stdout.write(
          "already logged in (method: cached) - run 'repotruck auth logout' first\n",
        );
        return;
      }
      let baseUrl: string | undefined;
      if (options.baseUrl !== undefined) {
        baseUrl = normalizeBaseUrl(options.baseUrl);
      }
      await deviceLogin({ env: process.env, baseUrl });
      if (baseUrl !== undefined) {
        const settings = await readSettings(process.env);
        await writeSettings(process.env, {
          ...settings,
          github: { ...(settings.github ?? {}), baseUrl },
        });
      }
      process.stdout.write("✓ logged in via device flow\n");
    });
  });

authCommand
  .command("logout")
  .description("Log out of cached GitHub credentials.")
  .action(async () => {
    await runAction(async () => {
      const removed = await logout(process.env);
      if (removed) {
        process.stdout.write("✓ logged out\n");
      } else {
        process.stdout.write("no cached login to log out\n");
      }
    });
  });

authCommand
  .command("status")
  .description("Show current authentication method and status.")
  .option("--json", "Output the auth status as JSON")
  .action(async (options: { json?: boolean }) => {
    await runAction(
      async () => {
        const probe = await probeAuth(process.env);
        const settings = await readSettings(process.env);
        const baseUrl = settings.github?.baseUrl;
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify({
              command: "auth status",
              ok: probe.method !== "none",
              authenticated: probe.method !== "none",
              method: probe.method,
              ...(baseUrl !== undefined && baseUrl !== DEFAULT_GITHUB_BASE_URL ? { baseUrl } : {}),
            })}\n`,
          );
          if (probe.method === "none") process.exit(1);
          return;
        }
        if (probe.method === "none") {
          process.stdout.write("not authenticated\n");
          process.exit(1);
        }
        process.stdout.write(`method: ${probe.method}\n`);
        process.stdout.write("login: unknown - verified lazily\n");
        if (baseUrl && baseUrl !== DEFAULT_GITHUB_BASE_URL) {
          process.stdout.write(`baseUrl: ${baseUrl}\n`);
        }
      },
      { command: "auth status", json: options.json },
    );
  });

program
  .command("doctor")
  .description("Check system dependencies, configuration, and workspace health.")
  .option("--json", "Output the checks as JSON")
  .option(
    "--fix",
    "attempt to fix what it can: starts 'repotruck auth login' when no token is found",
  )
  .action(async (options: { json?: boolean; fix?: boolean }) => {
    await runAction(
      async () => {
        let result = await runDoctor({ env: process.env });
        if (!result.ok && options.fix === true) {
          const authCheck = result.checks.find((check) => check.check === "token");
          if (authCheck !== undefined && authCheck.status === "fail") {
            process.stdout.write("fix: no GitHub token found — starting device flow login\n");
            await deviceLogin({ env: process.env });
            process.stdout.write("✓ logged in via device flow\n");
            result = await runDoctor({ env: process.env });
          }
        }
        if (options.json) {
          process.stdout.write(
            `${JSON.stringify({
              command: "doctor",
              ok: result.ok,
              checks: result.checks.map(({ formatted, ...check }) => {
                void formatted;
                return check;
              }),
            })}\n`,
          );
          if (!result.ok) process.exit(1);
          return;
        }
        for (const check of result.checks) {
          process.stdout.write(`${check.formatted}\n`);
        }
        if (!result.ok) {
          process.exit(1);
        }
      },
      { command: "doctor", json: options.json },
    );
  });

program
  .command("stats")
  .description("Display repository statistics, language breakdown, and disk usage.")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .option("--json", "Output the statistics as JSON")
  .action(async (options: { dir?: string; json?: boolean }) => {
    await runAction(
      async () => {
        const root = await requireExistingRoot(options.dir);
        const config = await loadWorkspace(root);
        const disk = walkRepositoriesOnDisk(root);
        const calculated = calculateWorkspaceStats(config, disk);
        if (options.json) {
          const { formatted: _formatted, ...data } = calculated;
          void _formatted;
          process.stdout.write(
            `${JSON.stringify({ command: "stats", ok: true, root, ...data })}\n`,
          );
          return;
        }
        process.stdout.write(`${calculated.formatted}\n`);
      },
      { command: "stats", json: options.json },
    );
  });

program
  .command("completions")
  .description("Generate shell completion scripts (bash, zsh, fish, powershell).")
  .argument("<shell>", "Target shell: bash, zsh, fish, or powershell")
  .action(async (shell: string) => {
    await runAction(async () => {
      if (!isSupportedShell(shell)) {
        exitFail(`unsupported shell: ${shell} (expected bash, zsh, fish, powershell)`);
      }
      const collect = (cmds: readonly Command[]): CompletionCommand[] =>
        cmds.map((cmd) => ({
          name: cmd.name(),
          description: cmd.description(),
          options: cmd.options.map((opt) => ({
            flags: opt.flags,
            long: opt.long,
            short: opt.short,
            description: opt.description,
          })),
          ...(cmd.commands.length > 0 ? { subcommands: collect(cmd.commands) } : {}),
        }));
      const script = buildCompletions(
        shell,
        collect(program.commands.filter((cmd) => cmd.name() !== "__complete")),
      );
      process.stdout.write(`${script}\n`);
    });
  });

const completeCommand = program
  .command("__complete", { hidden: true })
  .description("Print whitespace-separated completion candidates (used by shell completions).");

completeCommand.command("presets", { hidden: true }).action(async () => {
  const customs = await readCustomPresets(process.env);
  process.stdout.write(`${[...PRESET_IDS, ...customs.map((p) => p.id)].join(" ")}\n`);
});

completeCommand.command("apps", { hidden: true }).action(async () => {
  const apps = await detectApps({ env: process.env });
  process.stdout.write(`${apps.map((app) => app.name).join(" ")}\n`);
});

completeCommand.command("aliases", { hidden: true }).action(async () => {
  try {
    const root = await resolveRootOption();
    const config = await loadWorkspace(root);
    process.stdout.write(
      `${listAliases(config)
        .map((item) => item.alias)
        .join(" ")}\n`,
    );
  } catch {
    process.stdout.write("\n");
  }
});

completeCommand.command("scopes", { hidden: true }).action(async () => {
  process.stdout.write("user all org:\n");
});

completeCommand.command("kinds", { hidden: true }).action(async () => {
  process.stdout.write(`${SYMBOL_KINDS.join(" ")}\n`);
});

completeCommand.command("langs", { hidden: true }).action(async () => {
  process.stdout.write(`${Object.keys(LANG_ALIASES).join(" ")}\n`);
});

completeCommand.command("divergence", { hidden: true }).action(async () => {
  process.stdout.write("fail rebase reset skip\n");
});

program
  .command("search-code")
  .description("Search an indexed symbol name across every tracked repository.")
  .argument("<pattern>", "Symbol name or substring to search for")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .option(
    "--kind <kind>",
    "Filter by symbol kind (function, class, interface, type, enum, method, const)",
  )
  .option("--lang <lang>", "Filter by source language (ts, tsx, js, py, go, rs)")
  .option("--limit <number>", "Maximum number of matches to return")
  .option("--rebuild", "Force rebuilding the symbol index")
  .option("--regex", "Treat the pattern as a case-insensitive regular expression")
  .option("--json", "Output results as JSON")
  .action(
    async (
      pattern: string,
      options: {
        dir?: string;
        kind?: string;
        lang?: string;
        limit?: string;
        rebuild?: boolean;
        regex?: boolean;
        json?: boolean;
      },
    ) => {
      await runAction(
        async () => {
          if (pattern.trim().length === 0) {
            exitFail("pattern cannot be empty", options.json, "search-code");
          }
          let limit: number | undefined;
          if (options.limit !== undefined) {
            limit = parseIntStrict(options.limit, "limit", options.json, "search-code");
          }
          if (options.kind !== undefined) {
            const kind = options.kind.toLowerCase();
            if (!(SYMBOL_KINDS as readonly string[]).includes(kind)) {
              exitFail(
                `invalid --kind: ${options.kind} (expected ${SYMBOL_KINDS.join(", ")})`,
                options.json,
                "search-code",
              );
            }
          }
          if (options.lang !== undefined) {
            if (LANG_ALIASES[options.lang.toLowerCase()] === undefined) {
              exitFail(
                `invalid --lang: ${options.lang} (expected ${Object.keys(LANG_ALIASES).join(", ")})`,
                options.json,
                "search-code",
              );
            }
          }
          const root = await requireExistingRoot(options.dir);
          const config = await loadWorkspace(root);
          const result = await searchCode({
            root,
            config,
            pattern,
            kind: options.kind as SymbolKind | undefined,
            lang: options.lang as GrammarLang | undefined,
            limit,
            rebuild: options.rebuild === true,
            regex: options.regex === true,
          });
          if (result.index.built) {
            process.stderr.write(
              `indexed ${result.index.filesIndexed} files (${result.index.symbols} symbols) in ${result.index.durationMs}ms\n`,
            );
          }
          if (options.json) {
            process.stdout.write(`${JSON.stringify(result)}\n`);
            return;
          }
          for (const match of result.matches) {
            process.stdout.write(`${match.formatted}\n`);
          }
        },
        { command: "search-code", json: options.json },
      );
    },
  );

program
  .command("run")
  .description(
    "Run a command in every selected repository in parallel and report per-repo results.",
  )
  .argument("<command...>", "Command and arguments to execute")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .option(
    "-r, --repo <ref>",
    "Target repository by owner/name, alias, or path (repeatable)",
    (val: string, acc: string[]) => {
      acc.push(val);
      return acc;
    },
    [] as string[],
  )
  .option("-c, --concurrency <number>", "Maximum concurrent processes (default 3)")
  .option("--json", "Output results as JSON")
  .action(
    async (
      commandParts: string[],
      options: {
        dir?: string;
        repo: string[];
        concurrency?: string;
        json?: boolean;
      },
    ) => {
      await runAction(
        async () => {
          if (commandParts.length === 0 || commandParts[0]!.trim().length === 0) {
            exitFail("command cannot be empty", options.json, "run");
          }
          let concurrency: number | undefined;
          const rawConc =
            options.concurrency ?? program.opts<{ concurrency?: string }>().concurrency;
          if (rawConc !== undefined) {
            concurrency = parseIntStrict(rawConc, "concurrency", options.json, "run");
          }
          const root = await requireExistingRoot(options.dir);
          const config = await loadWorkspace(root);
          const result = await runInRepos({
            root,
            config,
            refs: options.repo,
            command: commandParts[0]!,
            args: commandParts.slice(1),
            concurrency,
          });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(result)}\n`);
            if (result.results.some((r) => !r.ok)) process.exit(1);
            return;
          }

          for (const r of result.results) {
            process.stdout.write(`${r.relativePath}|${r.exitCode ?? "null"}|${r.durationMs}ms\n`);
            if (process.env.REPOTRUCK_VERBOSE === "1") {
              const firstOut = r.stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
              if (firstOut) process.stdout.write(`  stdout: ${firstOut}\n`);
              const firstErr = r.stderr.split(/\r?\n/).find((l) => l.trim().length > 0);
              if (firstErr) process.stdout.write(`  stderr: ${firstErr}\n`);
            }
          }
          for (const s of result.skipped) {
            process.stdout.write(`[skipped] ${s.key}: ${s.message}\n`);
          }
          if (result.results.some((r) => !r.ok)) {
            process.exit(1);
          }
        },
        { command: "run", json: options.json },
      );
    },
  );

const presetCommand = program
  .command("preset")
  .description(`Manage custom directory-layout presets (built-ins: ${PRESET_IDS.join(", ")}).`);

presetCommand
  .command("list")
  .description("List built-in and custom presets.")
  .action(async () => {
    await runAction(async () => {
      for (const id of PRESET_IDS) {
        process.stdout.write(`${id} (built-in)\n`);
      }
      const customs = await readCustomPresets(process.env);
      if (customs.length === 0) {
        process.stdout.write(
          "(no custom presets — add one with: repotruck preset add <id> <segments...>)\n",
        );
        return;
      }
      for (const preset of customs) {
        process.stdout.write(`${preset.id} -> ${preset.segments.join("/")}\n`);
      }
    });
  });

presetCommand
  .command("add")
  .description(
    'Define a custom preset from segment tokens: owner, category, language, name (name must come last). Example: repotruck preset add lang-owner "language" "owner" "name"',
  )
  .argument("<id>", "preset id (lowercase letters, digits, dashes; cannot shadow a built-in)")
  .argument("<segments...>", "ordered segment tokens from: owner, category, language, name")
  .action(async (id: string, segments: string[]) => {
    await runAction(async () => {
      const validated = validateCustomPreset({ id, segments });
      if (validated === null) {
        exitFail(
          `invalid preset: ${id} ${segments.join(" ")} (segments must be 1-4 distinct tokens from owner, category, language, name, ending with name; the id must not shadow a built-in preset)`,
        );
      }
      const settings = await readSettings(process.env);
      await writeSettings(process.env, {
        ...settings,
        presets: { ...(settings.presets ?? {}), [validated.id]: { segments: validated.segments } },
      });
      process.stdout.write(`✓ preset ${validated.id} -> ${validated.segments.join("/")}\n`);
    });
  });

presetCommand
  .command("remove")
  .description("Remove a custom preset.")
  .argument("<id>", "preset id to remove")
  .action(async (id: string) => {
    await runAction(async () => {
      const settings = await readSettings(process.env);
      if (settings.presets?.[id] === undefined) {
        exitFail(`preset not found: ${id}`);
      }
      const presets = { ...settings.presets };
      delete presets[id];
      await writeSettings(process.env, { ...settings, presets });
      process.stdout.write(`✓ preset ${id} removed\n`);
    });
  });

program
  .command("backup")
  .description("List and restore automatic workspace snapshots (<root>/.repotruck/backups).")
  .argument("[action]", '"list" (the default) or "restore"')
  .argument("[snapshot]", 'snapshot filename to restore (required with "restore")')
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .option("--yes", "confirm the restore (required; it replaces the current inventory)")
  .option("--json", "Output the snapshot listing as JSON")
  .action(
    async (
      action: string | undefined,
      snapshot: string | undefined,
      options: { dir?: string; yes?: boolean; json?: boolean },
    ) => {
      await runAction(
        async () => {
          const verb = action ?? "list";
          if (verb !== "list" && verb !== "restore") {
            exitFail(
              `unknown action: ${verb} (expected "list" or "restore")`,
              options.json,
              "backup",
            );
          }
          const root = await requireExistingRoot(options.dir);
          if (verb === "list") {
            const entries = await listWorkspaceSnapshots(root);
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify({ command: "backup", ok: true, snapshots: entries })}\n`,
              );
              return;
            }
            if (entries.length === 0) {
              process.stdout.write("no snapshots yet (one is written on every workspace change)\n");
              return;
            }
            for (const entry of entries) {
              process.stdout.write(
                `${entry.file} — ${entry.repoCount} repos (${entry.createdAt})\n`,
              );
            }
            return;
          }
          if (snapshot === undefined || snapshot.length === 0) {
            exitFail(
              "backup restore requires a snapshot filename (see: repotruck backup list)",
              options.json,
              "backup",
            );
          }
          if (options.yes !== true) {
            exitFail(
              "backup restore requires --yes (it replaces the current workspace inventory)",
              options.json,
              "backup",
            );
          }
          const result = await restoreWorkspaceSnapshot(root, snapshot, process.env);
          if (!result.ok) exitFail(result.message, options.json, "backup");
          process.stdout.write(`✓ ${result.message}\n`);
        },
        { command: "backup", json: options.json },
      );
    },
  );

const instructionsCommand = program
  .command("instructions")
  .description("Manage the generated AGENTS.md workspace map.");

instructionsCommand
  .command("template")
  .description("Manage the AGENTS.md instruction templates.")
  .argument("[name]", "Template name to apply (node, python, monorepo)")
  .option(
    "-d, --dir <root>",
    "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
  )
  .option("--clear", "Clear any applied template rules from AGENTS.md")
  .action(async (name: string | undefined, options: { dir?: string; clear?: boolean }) => {
    await runAction(async () => {
      if (options.clear === true) {
        const root = await requireExistingRoot(options.dir);
        const config = await loadWorkspace(root);
        const res = await clearAgentsMdTemplate({
          root,
          repos: config.repos,
          preset: config.preset,
          lastSync: config.lastSync,
          aliases: config.aliases,
        });
        process.stdout.write(`${res.message}\n`);
        return;
      }
      if (name === undefined || name.trim().length === 0) {
        const templates = listAgentsMdTemplates();
        for (const t of templates) {
          process.stdout.write(`${t.name} - ${t.description}\n`);
        }
        return;
      }
      const root = await requireExistingRoot(options.dir);
      const config = await loadWorkspace(root);
      const res = await applyAgentsMdTemplate(
        {
          root,
          repos: config.repos,
          preset: config.preset,
          lastSync: config.lastSync,
          aliases: config.aliases,
        },
        name,
      );
      if (!res.ok) {
        exitFail(res.message);
      }
      process.stdout.write(`${res.message}\n`);
    });
  });

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
            "./mcp/server.ts"
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
        const { runRepotruckMcpServer } = await import("./mcp/server.ts");
        await runRepotruckMcpServer({ baseUrl });
      } catch (error) {
        process.stderr.write(`error: ${firstErrorLine(error)}\n`);
        process.exit(1);
      }
    },
  );

program.action(async () => {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write(
      "the interactive interface requires a TTY; run repotruck inside an interactive terminal, or use a subcommand such as sync, clone, move, reorganize, create, or workspaces\n",
    );
    process.exit(1);
  }
  const runtimeProblem = detectTuiRuntimeError();
  if (runtimeProblem !== null) {
    process.stderr.write(`${runtimeProblem}\n`);
    process.exit(1);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  let tuiEntry: string | null = null;
  for (const candidate of ["index.tsx", "index.js"]) {
    const candidatePath = path.join(here, candidate);
    if (existsSync(candidatePath)) {
      tuiEntry = candidatePath;
      break;
    }
  }
  if (tuiEntry === null) {
    process.stderr.write(
      "the interactive interface is not available: the TUI module is missing. Build first: bun install && bun run build\nuse the headless subcommands instead (sync, clone, move, reorganize, create, workspaces)\n",
    );
    process.exit(1);
  }
  try {
    await import(pathToFileURL(tuiEntry).href);
  } catch (error) {
    process.stderr.write(
      `the interactive interface is not available: ${firstErrorLine(error)}\nuse the headless subcommands instead (sync, clone, move, reorganize, create, workspaces)\n`,
    );
    process.exit(1);
  }
});

// Docs tooling imports this module to introspect the command tree without
// running the CLI; REPOTRUCK_NO_PARSE skips the parse step for that case.
if (process.env.REPOTRUCK_NO_PARSE !== "1") {
  await program.parseAsync();
}

import type { Command } from "commander";
import { resolveProfileKeys } from "../../services/profiles.ts";
import { runInRepos } from "../../services/runner.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import {
  type CliContext,
  exitFail,
  parseIntStrict,
  requireExistingRoot,
  runAction,
} from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
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
    .option("--pinned", "Run only in repositories pinned in the workspace")
    .option("--profile <name>", "Run only in repositories belonging to the named profile")
    .option("-c, --concurrency <number>", "Maximum concurrent processes (default 3)")
    .option("--json", "Output results as JSON")
    .action(
      async (
        commandParts: string[],
        options: {
          dir?: string;
          repo: string[];
          pinned?: boolean;
          profile?: string;
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
            const config = await loadWorkspace(root, undefined, process.env);

            const refs = [...options.repo];
            const filteredBySelection = options.pinned === true || options.profile !== undefined;
            if (options.pinned) {
              refs.push(...(config.pinned ?? []));
            }
            if (options.profile !== undefined) {
              const profileKeys = resolveProfileKeys(config, options.profile);
              if (profileKeys === null) {
                exitFail(`profile not found: ${options.profile}`, options.json, "run");
              }
              refs.push(...profileKeys);
            }

            if (filteredBySelection && refs.length === 0) {
              if (options.json) {
                process.stdout.write(`${JSON.stringify({ results: [], skipped: [] })}\n`);
                return;
              }
              process.stdout.write("nothing to run (0 repositories in selection)\n");
              return;
            }

            const result = await runInRepos({
              root,
              config,
              refs,
              command: commandParts[0]!,
              args: commandParts.slice(1),
              concurrency,
            });

            if (options.json) {
              process.stdout.write(`${JSON.stringify(result)}\n`);
              if (result.results.some((r) => !r.ok)) {
                process.exitCode = 1;
                return;
              }
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
              process.exitCode = 1;
              return;
            }
          },
          { command: "run", json: options.json },
        );
      },
    );
}

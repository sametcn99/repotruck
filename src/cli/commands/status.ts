import type { Command } from "commander";
import { getWorkspaceStatus } from "../../core/inspect.ts";
import { formatDiffBar } from "../../services/gitState.ts";
import type { RemoteHealthReader } from "../../services/lifecycle.ts";
import { resolveGithubBaseUrl } from "../../services/settings.ts";
import { type CliContext, requireExistingRoot, runAction } from "../shared.ts";

export function register(program: Command, ctx: CliContext): void {
  program
    .command("status")
    .description("Show per-repository health: dirty state, ahead/behind, category, aliases.")
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: the nearest registered workspace found walking up, otherwise the configured default root, otherwise the OS default)",
    )
    .option("-D, --detail", "Show detailed unpushed commits and modified files with diff stats")
    .option(
      "-f, --filter <type>",
      "Filter repos by status: dirty, uncommitted, unpushed, unpulled, all",
    )
    .option("--pinned", "Only inspect pinned repositories")
    .option("--profile <name>", "Only inspect repositories in the named profile")
    .option("--remote", "Fetch open PR counts and default-branch CI check state from GitHub")
    .option("--base-url <url>", "GitHub Enterprise base URL (used with --remote)")
    .option(
      "-c, --check",
      "Exit with non-zero exit code if any repo has uncommitted/unpushed changes",
    )
    .option("--json", "Output results as JSON")
    .action(
      async (options: {
        dir?: string;
        json?: boolean;
        detail?: boolean;
        filter?: string;
        pinned?: boolean;
        profile?: string;
        remote?: boolean;
        baseUrl?: string;
        check?: boolean;
      }) => {
        await runAction(
          async () => {
            const root = await requireExistingRoot(options.dir);
            let github: RemoteHealthReader | undefined;
            if (options.remote) {
              const auth = await ctx.requireAuth();
              const baseUrl = await resolveGithubBaseUrl(process.env, options.baseUrl);
              github = ctx.buildGithub(auth.token, baseUrl);
            }
            const status = await getWorkspaceStatus(root, process.env, {
              detail: options.detail,
              pinned: options.pinned === true,
              profile: options.profile,
              remote: options.remote === true,
              github,
            });

            // Filter logic
            let repos = status.repos;
            if (options.filter && options.filter !== "all") {
              const f = options.filter.toLowerCase();
              if (f === "dirty" || f === "uncommitted") {
                repos = repos.filter((r) => r.dirty === true);
              } else if (f === "unpushed") {
                repos = repos.filter((r) => (r.ahead ?? 0) > 0);
              } else if (f === "unpulled") {
                repos = repos.filter((r) => (r.behind ?? 0) > 0);
              }
            }

            if (options.json) {
              const payload = {
                command: "status",
                ok: true,
                root,
                lastSync: status.lastSync,
                repos: repos.map((r) => ({
                  key: r.key,
                  line: r.line,
                  dirty: r.dirty,
                  ahead: r.ahead,
                  behind: r.behind,
                  missing: r.missing,
                  ...(r.worktree ? { worktree: true } : {}),
                  ...(options.detail && r.details ? { details: r.details } : {}),
                  ...(r.remote ? { remote: r.remote } : {}),
                })),
              };
              process.stdout.write(`${JSON.stringify(payload)}\n`);
            } else {
              process.stdout.write(`last sync (workspace): ${status.lastSync ?? "never"}\n`);
              if (status.repos.length === 0) {
                process.stdout.write("no repositories tracked\n");
              } else if (repos.length === 0) {
                process.stdout.write("no repositories match\n");
              } else {
                for (const repo of repos) {
                  process.stdout.write(`${repo.line}\n`);
                  if (options.detail && repo.details) {
                    const d = repo.details;
                    if (d.outgoingCommits.length > 0) {
                      process.stdout.write(`  outgoing commits (${d.outgoingCommits.length}):\n`);
                      for (const c of d.outgoingCommits) {
                        process.stdout.write(`    \u2191 ${c.hash} ${c.subject}\n`);
                      }
                    }
                    if (d.modifiedFiles.length > 0 || d.untrackedFiles.length > 0) {
                      const maxTotal = d.modifiedFiles.reduce(
                        (max, f) => Math.max(max, (f.added ?? 0) + (f.removed ?? 0)),
                        0,
                      );
                      process.stdout.write(
                        `  modified files (${d.modifiedFiles.length} modified, ${d.untrackedFiles.length} untracked):\n`,
                      );
                      for (const f of d.modifiedFiles) {
                        const bar = formatDiffBar(f.added, f.removed, maxTotal, 15);
                        const addStr = f.added !== null ? `+${f.added}` : "";
                        const remStr = f.removed !== null ? `-${f.removed}` : "";
                        process.stdout.write(
                          `    * ${f.path.padEnd(35)} ${bar.padEnd(16)} ${addStr.padStart(5)} ${remStr.padStart(5)}\n`,
                        );
                      }
                      for (const u of d.untrackedFiles) {
                        process.stdout.write(`    ? ${u} (untracked)\n`);
                      }
                    }
                  }
                }
              }
            }

            if (options.check) {
              const needsAttention = repos.some((r) => r.dirty || (r.ahead ?? 0) > 0 || r.missing);
              if (needsAttention) {
                process.exitCode = 1;
              }
            }
          },
          { command: "status", json: options.json },
        );
      },
    );
}

import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { formatChangelogMarkdown, getWorkspaceChangelog } from "../../services/changelog.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { type CliContext, exitFail, requireExistingRoot, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  program
    .command("changelog")
    .description(
      "Synthesize git commits across workspace repositories into a structured changelog.",
    )
    .option(
      "-d, --dir <root>",
      "workspace root directory (default: nearest registered workspace, configured default root, or OS default)",
    )
    .option(
      "--since <duration>",
      "git log since expression (e.g. '7 days ago', '2026-01-01', 'v1.0.0')",
      "7 days ago",
    )
    .option("--until <duration>", "git log until expression (e.g. 'yesterday')")
    .option("--author <author>", "filter commits by author name or email")
    .option("--repo <ref>", "filter commits to a single repository alias or owner/name")
    .option("--format <fmt>", "output format: markdown or json (default: markdown)", "markdown")
    .option("-o, --out <file>", "write changelog to output file instead of stdout")
    .option("--json", "alias for --format json")
    .action(
      async (options: {
        dir?: string;
        since?: string;
        until?: string;
        author?: string;
        repo?: string;
        format?: string;
        out?: string;
        json?: boolean;
      }) => {
        await runAction(
          async () => {
            const root = await requireExistingRoot(options.dir);
            const config = await loadWorkspace(root);
            const format = options.json ? "json" : (options.format ?? "markdown");
            if (format !== "markdown" && format !== "json") {
              exitFail("invalid format: must be 'markdown' or 'json'");
            }

            const since = options.since ?? "7 days ago";
            const changelogs = await getWorkspaceChangelog(root, config, {
              since,
              until: options.until,
              author: options.author,
              repoRef: options.repo,
            });

            let output = "";
            if (format === "json") {
              output = `${JSON.stringify(
                {
                  command: "changelog",
                  ok: true,
                  since,
                  count: changelogs.length,
                  repos: changelogs,
                },
                null,
                2,
              )}\n`;
            } else {
              output = `${formatChangelogMarkdown(changelogs, since)}\n`;
            }

            if (options.out) {
              await writeFile(options.out, output, "utf8");
              process.stdout.write(`changelog written to ${options.out}\n`);
            } else {
              process.stdout.write(output);
            }
          },
          { command: "changelog", json: options.json || options.format === "json" },
        );
      },
    );
}

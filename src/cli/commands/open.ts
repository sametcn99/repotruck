import type { Command } from "commander";
import {
  detectApps,
  listAliases,
  resolveApp,
  resolveRepoRef,
  runAppInRepo,
} from "../../services/launcher.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { type CliContext, exitFail, requireExistingRoot, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
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
        process.exitCode = result.code ?? 1;
        return;
      });
    });
}

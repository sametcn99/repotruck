import { type Command, Option } from "commander";
import { createRepository } from "../../services/creator.ts";
import { readCustomPresets, resolveGithubBaseUrl } from "../../services/settings.ts";
import { loadWorkspace } from "../../services/workspace.ts";
import { type CliContext, exitFail, resolveRootOption, runAction } from "../shared.ts";

export function register(program: Command, ctx: CliContext): void {
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
          const auth = await ctx.requireAuth();
          const baseUrl = await resolveGithubBaseUrl(process.env, options.baseUrl);
          const github = ctx.buildGithub(auth.token, baseUrl);
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
          process.stdout.write(`\u2713 ${result.message}\n`);
        });
      },
    );
}

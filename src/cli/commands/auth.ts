import type { Command } from "commander";
import { cachedLoginExists, deviceLogin, logout, probeAuth } from "../../services/auth.ts";
import {
  DEFAULT_GITHUB_BASE_URL,
  normalizeBaseUrl,
  readSettings,
  writeSettings,
} from "../../services/settings.ts";
import { type CliContext, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
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
                ...(baseUrl !== undefined && baseUrl !== DEFAULT_GITHUB_BASE_URL
                  ? { baseUrl }
                  : {}),
              })}\n`,
            );
            if (probe.method === "none") {
              process.exitCode = 1;
              return;
            }
            return;
          }
          if (probe.method === "none") {
            process.stdout.write("not authenticated\n");
            process.exitCode = 1;
            return;
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
}

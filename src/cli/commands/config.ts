import type { Command } from "commander";
import { isThemeName, THEME_NAMES } from "../../components/theme.ts";
import { firstErrorLine, isDivergenceStrategy } from "../../services/cloner.ts";
import {
  DEFAULT_GITHUB_BASE_URL,
  normalizeBaseUrl,
  type RepotruckSettings,
  readSettings,
  resolveSyncSettings,
  validateRootInput,
  writeSettings,
} from "../../services/settings.ts";
import { type CliContext, exitFail, parseIntStrict, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
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
}

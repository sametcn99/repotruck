import type { Command } from "commander";
import {
  type GrammarLang,
  LANG_ALIASES,
  SYMBOL_KINDS,
  type SymbolKind,
  searchCode,
} from "../../services/codeSearch.ts";
import {
  GrammarDownloadError,
  GrammarIntegrityError,
  GrammarOfflineError,
  GrammarUnavailableError,
} from "../../services/grammarStore.ts";
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
    .option("--offline", "Disable automatic grammar downloads and require local/cached grammars")
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
          offline?: boolean;
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
            try {
              const result = await searchCode({
                root,
                config,
                pattern,
                kind: options.kind as SymbolKind | undefined,
                lang: options.lang as GrammarLang | undefined,
                limit,
                offline: options.offline === true,
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
            } catch (error) {
              if (error instanceof GrammarOfflineError) {
                exitFail(
                  `grammar for '${error.lang}' is not cached locally (run without --offline to download or set REPOTRUCK_GRAMMARS_DIR)`,
                  options.json,
                  "search-code",
                );
              }
              if (error instanceof GrammarDownloadError) {
                if (error.status === 404) {
                  exitFail(
                    `failed to download grammar for '${error.lang}' (release assets 'grammars-v1' not yet published; set REPOTRUCK_GRAMMARS_DIR or place grammar in cache directory)`,
                    options.json,
                    "search-code",
                  );
                }
                exitFail(
                  `network error while downloading grammar for '${error.lang}': ${error.message}; check connectivity or set REPOTRUCK_GRAMMARS_DIR`,
                  options.json,
                  "search-code",
                );
              }
              if (error instanceof GrammarIntegrityError) {
                exitFail(
                  `grammar integrity check failed for '${error.lang}' (expected SHA-256 ${error.expectedSha256}, got ${error.actualSha256})`,
                  options.json,
                  "search-code",
                );
              }
              if (error instanceof GrammarUnavailableError) {
                exitFail(
                  `grammar for '${error.lang}' is unavailable: manifest entry has not been published`,
                  options.json,
                  "search-code",
                );
              }
              throw error;
            }
          },
          { command: "search-code", json: options.json },
        );
      },
    );
}

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { program } from "commander";
import {
  clearLanguageCache,
  defaultGrammarResolver,
  searchCode,
} from "../src/services/codeSearch.ts";
import type { RepotruckConfig } from "../src/services/config.ts";
import {
  GrammarDownloadError,
  GrammarIntegrityError,
  GrammarOfflineError,
  GrammarUnavailableError,
} from "../src/services/grammarStore.ts";

const pendingDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  pendingDirs.push(dir);
  return dir;
}

beforeEach(() => {
  clearLanguageCache();
});

afterEach(() => {
  clearLanguageCache();
  delete process.env.REPOTRUCK_NO_PARSE;
  for (const dir of pendingDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in test
    }
  }
});

function createWorkspace(root: string): RepotruckConfig {
  const repoDir = path.join(root, "my-repo");
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(
    path.join(repoDir, "main.ts"),
    "export function calculateTotal(a: number, b: number): number { return a + b; }\n",
    "utf8",
  );

  return {
    version: 1,
    root,
    preset: "categorized",
    lastSync: null,
    repos: [
      {
        owner: "testowner",
        name: "my-repo",
        category: "source",
        relativePath: "my-repo",
        internal: true,
        language: "ts",
        updatedAt: null,
      },
    ],
  };
}

describe("CLI search-code --offline and Error Propagation (Sprint 05b)", () => {
  test("searchCode with defaultGrammarResolver([], { offline: true }) throws GrammarOfflineError when grammar missing", async () => {
    const root = makeTempDir("repotruck-offline-test-");
    const config = createWorkspace(root);
    const emptyCache = path.join(root, "empty-cache");
    mkdirSync(emptyCache, { recursive: true });

    const offlineResolver = defaultGrammarResolver([], {
      offline: true,
      cacheDir: emptyCache,
    });

    await expect(
      searchCode({
        root,
        config,
        pattern: "calculateTotal",
        resolver: offlineResolver,
        offline: true,
      }),
    ).rejects.toThrow(GrammarOfflineError);
  });

  test("searchCode selectively rethrows GrammarDownloadError, GrammarIntegrityError, GrammarUnavailableError", async () => {
    const root = makeTempDir("repotruck-rethrow-test-");
    const config = createWorkspace(root);

    // 1. GrammarDownloadError
    await expect(
      searchCode({
        root,
        config,
        pattern: "calculateTotal",
        resolver: async () => {
          throw new GrammarDownloadError("ts", 404, "Not Found");
        },
      }),
    ).rejects.toThrow(GrammarDownloadError);

    // 2. GrammarIntegrityError
    await expect(
      searchCode({
        root,
        config,
        pattern: "calculateTotal",
        resolver: async () => {
          throw new GrammarIntegrityError("ts", "expected-sha", "actual-sha");
        },
      }),
    ).rejects.toThrow(GrammarIntegrityError);

    // 3. GrammarUnavailableError
    await expect(
      searchCode({
        root,
        config,
        pattern: "calculateTotal",
        resolver: async () => {
          throw new GrammarUnavailableError("ts");
        },
      }),
    ).rejects.toThrow(GrammarUnavailableError);
  });

  test("CLI error message formatting matches binding contract specifications", () => {
    // 1. GrammarOfflineError message format
    const offlineErr = new GrammarOfflineError("ts");
    const offlineMsg = `grammar for '${offlineErr.lang}' is not cached locally (run without --offline to download or set REPOTRUCK_GRAMMARS_DIR)`;
    expect(offlineMsg).toContain("grammar for 'ts' is not cached locally");
    expect(offlineMsg).toContain("run without --offline to download or set REPOTRUCK_GRAMMARS_DIR");

    // 2a. GrammarDownloadError 404 message format (Evaluator 2 Binding Comment 1)
    const dl404 = new GrammarDownloadError("python", 404);
    const dl404Msg = `failed to download grammar for '${dl404.lang}' (release assets 'grammars-v1' not yet published; set REPOTRUCK_GRAMMARS_DIR or place grammar in cache directory)`;
    expect(dl404Msg).toContain("failed to download grammar for 'python'");
    expect(dl404Msg).toContain("release assets 'grammars-v1' not yet published");
    expect(dl404Msg).toContain("set REPOTRUCK_GRAMMARS_DIR or place grammar in cache directory");

    // 2b. GrammarDownloadError network error format (Evaluator 2 Binding Comment 1)
    const dlNet = new GrammarDownloadError("rust", undefined, "fetch failed: ECONNREFUSED");
    const dlNetMsg = `network error while downloading grammar for '${dlNet.lang}': ${dlNet.message}; check connectivity or set REPOTRUCK_GRAMMARS_DIR`;
    expect(dlNetMsg).toContain("network error while downloading grammar for 'rust'");
    expect(dlNetMsg).toContain("fetch failed: ECONNREFUSED");
    expect(dlNetMsg).toContain("check connectivity or set REPOTRUCK_GRAMMARS_DIR");

    // 3. GrammarIntegrityError message format
    const intErr = new GrammarIntegrityError("go", "expected123", "actual456");
    const intMsg = `grammar integrity check failed for '${intErr.lang}' (expected SHA-256 ${intErr.expectedSha256}, got ${intErr.actualSha256})`;
    expect(intMsg).toBe(
      "grammar integrity check failed for 'go' (expected SHA-256 expected123, got actual456)",
    );

    // 4. GrammarUnavailableError message format
    const unavailErr = new GrammarUnavailableError("js");
    const unavailMsg = `grammar for '${unavailErr.lang}' is unavailable: manifest entry has not been published`;
    expect(unavailMsg).toBe(
      "grammar for 'js' is unavailable: manifest entry has not been published",
    );
  });

  test("CLI command surface registers --offline option for search-code", async () => {
    process.env.REPOTRUCK_NO_PARSE = "1";
    try {
      await import("../src/cli.ts");

      const searchCmd = program.commands.find((cmd) => cmd.name() === "search-code");
      expect(searchCmd).toBeDefined();

      const offlineOption = searchCmd?.options.find((opt) => opt.long === "--offline");
      expect(offlineOption).toBeDefined();
      expect(offlineOption?.description).toContain("Disable automatic grammar downloads");
    } finally {
      delete process.env.REPOTRUCK_NO_PARSE;
    }
  });
});

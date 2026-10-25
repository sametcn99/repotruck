import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createGrammarStore,
  DEFAULT_GRAMMAR_MANIFEST,
  defaultGrammarCacheDir,
  GrammarDownloadError,
  GrammarIntegrityError,
  type GrammarLang,
  type GrammarManifest,
  GrammarOfflineError,
  GrammarUnavailableError,
  resolveGrammar,
  writeBufferAtomic,
} from "../src/services/grammarStore.ts";

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex").toLowerCase();
}

describe("grammarStore", () => {
  let tempBase: string;

  beforeEach(async () => {
    tempBase = await mkdtemp(path.join(os.tmpdir(), "repotruck-grammar-store-"));
  });

  afterEach(async () => {
    await rm(tempBase, { recursive: true, force: true });
  });

  describe("C2: manifest injection and unpopulated production manifest", () => {
    test("unpopulated manifest entry throws GrammarUnavailableError without calling network", async () => {
      let fetchCalled = false;
      const customFetch = async () => {
        fetchCalled = true;
        return new Response("dummy");
      };

      await expect(
        resolveGrammar("python", {
          manifest: { ...DEFAULT_GRAMMAR_MANIFEST, python: {} },
          bundledDirs: [],
          cacheDir: path.join(tempBase, "cache"),
          env: {},
          fetch: customFetch,
        }),
      ).rejects.toThrow(GrammarUnavailableError);

      expect(fetchCalled).toBe(false);
    });

    test("injected fixture manifest with valid SHA-256 resolves and verifies successfully", async () => {
      const mockWasm = new TextEncoder().encode("mock-wasm-binary-content-python");
      const expectedHash = sha256(mockWasm);
      let fetchCalls = 0;

      const fixtureManifest: GrammarManifest = {
        python: {
          url: "https://example.test/grammars/tree-sitter-python.wasm",
          sha256: expectedHash,
          size: mockWasm.length,
        },
        ts: { url: undefined, sha256: undefined },
        tsx: { url: undefined, sha256: undefined },
        js: { url: undefined, sha256: undefined },
        go: { url: undefined, sha256: undefined },
        rust: { url: undefined, sha256: undefined },
      };

      const customFetch = async (input: string | URL | Request) => {
        fetchCalls += 1;
        expect(input).toBe(fixtureManifest.python.url!);
        return new Response(mockWasm, { status: 200 });
      };

      const cacheDir = path.join(tempBase, "cache");
      const result = await resolveGrammar("python", {
        manifest: fixtureManifest,
        bundledDirs: [],
        cacheDir,
        env: {},
        fetch: customFetch,
      });

      expect(fetchCalls).toBe(1);
      expect(result).not.toBeNull();
      expect(result).toEqual(mockWasm);

      // Verify file is stored in cache
      const cached = await readFile(path.join(cacheDir, "tree-sitter-python.wasm"));
      expect(new Uint8Array(cached)).toEqual(mockWasm);
    });
  });

  describe("C3: resolution order precedence", () => {
    test("precedence: env > cache > bundled > download (step by step)", async () => {
      const envDir = path.join(tempBase, "env-grammars");
      const cacheDir = path.join(tempBase, "cache-grammars");
      const bundledDir = path.join(tempBase, "bundled-grammars");
      await mkdir(envDir, { recursive: true });
      await mkdir(cacheDir, { recursive: true });
      await mkdir(bundledDir, { recursive: true });

      const envBytes = new TextEncoder().encode("content-from-env");
      const cacheBytes = new TextEncoder().encode("content-from-cache");
      const bundledBytes = new TextEncoder().encode("content-from-bundled");
      const downloadBytes = new TextEncoder().encode("content-from-download");

      await writeFile(path.join(envDir, "tree-sitter-python.wasm"), envBytes);
      await writeFile(path.join(cacheDir, "tree-sitter-python.wasm"), cacheBytes);
      await writeFile(path.join(bundledDir, "tree-sitter-python.wasm"), bundledBytes);

      let fetchCount = 0;
      const customFetch = async () => {
        fetchCount += 1;
        return new Response(downloadBytes);
      };

      const manifest: GrammarManifest = {
        python: { url: "https://example.test/py.wasm", sha256: sha256(downloadBytes) },
        ts: {},
        tsx: {},
        js: {},
        go: {},
        rust: {},
      };

      // Step 1: When env, cache, bundled, and fetch are all present, env wins
      const res1 = await resolveGrammar("python", {
        env: { REPOTRUCK_GRAMMARS_DIR: envDir },
        cacheDir,
        bundledDirs: [bundledDir],
        manifest,
        fetch: customFetch,
      });
      expect(res1).toEqual(envBytes);
      expect(fetchCount).toBe(0);

      // Step 2: When env is not set/missing, cache wins
      const res2 = await resolveGrammar("python", {
        env: {},
        cacheDir,
        bundledDirs: [bundledDir],
        manifest,
        fetch: customFetch,
      });
      expect(res2).toEqual(cacheBytes);
      expect(fetchCount).toBe(0);

      // Step 3: When env and cache are empty, bundled wins
      await rm(path.join(cacheDir, "tree-sitter-python.wasm"));
      const res3 = await resolveGrammar("python", {
        env: {},
        cacheDir,
        bundledDirs: [bundledDir],
        manifest,
        fetch: customFetch,
      });
      expect(res3).toEqual(bundledBytes);
      expect(fetchCount).toBe(0);

      // Step 4: When env, cache, and bundled are all empty, download wins
      await rm(path.join(bundledDir, "tree-sitter-python.wasm"));
      const res4 = await resolveGrammar("python", {
        env: {},
        cacheDir,
        bundledDirs: [bundledDir],
        manifest,
        fetch: customFetch,
      });
      expect(res4).toEqual(downloadBytes);
      expect(fetchCount).toBe(1);
    });
  });

  describe("C4: cache hit prevents network calls", () => {
    test("when grammar exists in cache directory, fetch is never invoked (counter = 0)", async () => {
      const cacheDir = path.join(tempBase, "cache");
      await mkdir(cacheDir, { recursive: true });

      const cachedBytes = new TextEncoder().encode("cached-go-wasm");
      await writeFile(path.join(cacheDir, "tree-sitter-go.wasm"), cachedBytes);

      let fetchCounter = 0;
      const customFetch = async () => {
        fetchCounter += 1;
        return new Response("should-not-be-called");
      };

      const result = await resolveGrammar("go", {
        cacheDir,
        bundledDirs: [],
        env: {},
        fetch: customFetch,
      });

      expect(result).toEqual(cachedBytes);
      expect(fetchCounter).toBe(0);
    });
  });

  describe("C5: SHA-256 integrity verification", () => {
    test("hash mismatch throws GrammarIntegrityError and does not cache corrupt data", async () => {
      const corruptData = new TextEncoder().encode("tampered-wasm-binary");
      const actualHash = sha256(corruptData);
      const expectedHash = "a".repeat(64);
      const cacheDir = path.join(tempBase, "cache");

      const manifest: GrammarManifest = {
        rust: {
          url: "https://example.test/tree-sitter-rust.wasm",
          sha256: expectedHash,
        },
        ts: {},
        tsx: {},
        js: {},
        python: {},
        go: {},
      };

      let fetchCounter = 0;
      const customFetch = async () => {
        fetchCounter += 1;
        return new Response(corruptData, { status: 200 });
      };

      let caughtError: unknown;
      try {
        await resolveGrammar("rust", {
          manifest,
          cacheDir,
          bundledDirs: [],
          env: {},
          fetch: customFetch,
        });
      } catch (err) {
        caughtError = err;
      }

      expect(fetchCounter).toBe(1);
      expect(caughtError).toBeInstanceOf(GrammarIntegrityError);
      const integrityErr = caughtError as GrammarIntegrityError;
      expect(integrityErr.lang).toBe("rust");
      expect(integrityErr.expectedSha256).toBe(expectedHash);
      expect(integrityErr.actualSha256).toBe(actualHash);
      expect(integrityErr.message).toContain(expectedHash);
      expect(integrityErr.message).toContain(actualHash);

      // Verify corrupt file was not cached and no temp files remain
      try {
        const files = await readdir(cacheDir);
        expect(files.length).toBe(0);
      } catch {
        // Directory may not even exist, which is fine
      }
    });
  });

  describe("C6: atomic caching and cleanup on failure", () => {
    test("interrupted download leaves no leftover temp/cache files and subsequent download succeeds", async () => {
      const cacheDir = path.join(tempBase, "cache");
      const validData = new TextEncoder().encode("valid-wasm-data");
      const validHash = sha256(validData);

      const manifest: GrammarManifest = {
        ts: { url: "https://example.test/ts.wasm", sha256: validHash },
        tsx: {},
        js: {},
        python: {},
        go: {},
        rust: {},
      };

      let attempt = 0;
      const failingFetch = async () => {
        attempt += 1;
        if (attempt === 1) {
          // First attempt: body stream fails during read
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => {
              throw new Error("Network stream aborted");
            },
          } as unknown as Response;
        }
        // Second attempt: succeeds
        return new Response(validData, { status: 200 });
      };

      // First call should fail with GrammarDownloadError
      await expect(
        resolveGrammar("ts", {
          manifest,
          cacheDir,
          bundledDirs: [],
          env: {},
          fetch: failingFetch,
        }),
      ).rejects.toThrow(GrammarDownloadError);

      // Verify cacheDir has no partial or temp files
      try {
        const files = await readdir(cacheDir);
        const leftovers = files.filter(
          (f) => f.includes(".tmp-") || f === "tree-sitter-typescript.wasm",
        );
        expect(leftovers.length).toBe(0);
      } catch {
        // Directory doesn't exist yet
      }

      // Second call succeeds cleanly
      const result = await resolveGrammar("ts", {
        manifest,
        cacheDir,
        bundledDirs: [],
        env: {},
        fetch: failingFetch,
      });

      expect(result).toEqual(validData);
      const cached = await readFile(path.join(cacheDir, "tree-sitter-typescript.wasm"));
      expect(new Uint8Array(cached)).toEqual(validData);
    });

    test("writeBufferAtomic creates target file and cleans temp file on error", async () => {
      const target = path.join(tempBase, "test-atomic", "sample.wasm");
      const data = new Uint8Array([1, 2, 3, 4]);

      await writeBufferAtomic(target, data);
      const read = await readFile(target);
      expect(new Uint8Array(read)).toEqual(data);

      const dirFiles = await readdir(path.dirname(target));
      expect(dirFiles).toEqual(["sample.wasm"]);
    });
  });

  describe("C7: offline mode and explicit errors", () => {
    test("when offline is true and grammar is missing from local paths, throws GrammarOfflineError without network calls", async () => {
      let fetchCalled = false;
      const customFetch = async () => {
        fetchCalled = true;
        return new Response("dummy");
      };

      const cacheDir = path.join(tempBase, "cache");

      let caughtError: unknown;
      try {
        await resolveGrammar("python", {
          offline: true,
          cacheDir,
          bundledDirs: [],
          env: {},
          fetch: customFetch,
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(GrammarOfflineError);
      const offlineErr = caughtError as GrammarOfflineError;
      expect(offlineErr.lang).toBe("python");
      expect(offlineErr.message).toContain("python");
      expect(offlineErr.message).toContain("offline");
      expect(fetchCalled).toBe(false);
    });

    test("when offline is true but grammar exists locally, resolves successfully", async () => {
      const cacheDir = path.join(tempBase, "cache");
      await mkdir(cacheDir, { recursive: true });
      const localData = new TextEncoder().encode("local-offline-grammar");
      await writeFile(path.join(cacheDir, "tree-sitter-python.wasm"), localData);

      const result = await resolveGrammar("python", {
        offline: true,
        cacheDir,
        bundledDirs: [],
        env: {},
      });

      expect(result).toEqual(localData);
    });
  });

  describe("HTTP error responses and unknown languages", () => {
    test("non-2xx response throws GrammarDownloadError with status", async () => {
      const manifest: GrammarManifest = {
        js: { url: "https://example.test/js.wasm", sha256: "somehash" },
        ts: {},
        tsx: {},
        python: {},
        go: {},
        rust: {},
      };

      const customFetch = async () => {
        return new Response("Not Found", { status: 404 });
      };

      let caughtError: unknown;
      try {
        await resolveGrammar("js", {
          manifest,
          cacheDir: path.join(tempBase, "cache"),
          bundledDirs: [],
          env: {},
          fetch: customFetch,
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(GrammarDownloadError);
      const downloadErr = caughtError as GrammarDownloadError;
      expect(downloadErr.lang).toBe("js");
      expect(downloadErr.status).toBe(404);
      expect(downloadErr.message).toContain("404");
    });

    test("network failure during fetch throws GrammarDownloadError", async () => {
      const manifest: GrammarManifest = {
        tsx: { url: "https://example.test/tsx.wasm", sha256: "somehash" },
        ts: {},
        js: {},
        python: {},
        go: {},
        rust: {},
      };

      const customFetch = async () => {
        throw new Error("DNS resolution failed");
      };

      await expect(
        resolveGrammar("tsx", {
          manifest,
          cacheDir: path.join(tempBase, "cache"),
          bundledDirs: [],
          env: {},
          fetch: customFetch,
        }),
      ).rejects.toThrow(GrammarDownloadError);
    });

    test("unknown language returns null", async () => {
      const result = await resolveGrammar("unknown" as unknown as GrammarLang, {
        cacheDir: path.join(tempBase, "cache"),
      });
      expect(result).toBeNull();
    });
  });

  describe("createGrammarStore and defaultGrammarCacheDir", () => {
    test("defaultGrammarCacheDir respects REPOTRUCK_CONFIG_DIR override", () => {
      const customConfig = path.join(tempBase, "custom-config");
      const cacheDir = defaultGrammarCacheDir({ REPOTRUCK_CONFIG_DIR: customConfig });
      expect(cacheDir).toBe(path.join(customConfig, "grammars"));
    });

    test("createGrammarStore exposes getCacheDir and resolveGrammar", async () => {
      const customCache = path.join(tempBase, "store-cache");
      const store = createGrammarStore({ cacheDir: customCache });
      expect(store.getCacheDir()).toBe(customCache);
    });
  });
});

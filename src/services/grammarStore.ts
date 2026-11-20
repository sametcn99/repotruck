import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appConfigDir } from "./config.ts";

export const GRAMMAR_CACHE_DIRECTORY = "grammars-v2";
export const GRAMMAR_ASSET_BASE_URL =
  "https://raw.githubusercontent.com/sametcn99/repotruck/v1.0.1/vendor/grammars";

export type GrammarLang = "ts" | "tsx" | "js" | "python" | "go" | "rust";

export const GRAMMAR_FILES: Record<GrammarLang, string> = {
  ts: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  js: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
};

export interface GrammarManifestEntry {
  url?: string;
  sha256?: string;
  size?: number;
}

export type GrammarManifest = Record<GrammarLang, GrammarManifestEntry>;

/**
 * Default production grammar manifest.
 * Download URLs use the tagged release source. Hashes and sizes match the vendored binaries.
 */
export const DEFAULT_GRAMMAR_MANIFEST: GrammarManifest = {
  ts: {
    url: `${GRAMMAR_ASSET_BASE_URL}/tree-sitter-typescript.wasm`,
    sha256: "778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d",
    size: 1413849,
  },
  tsx: {
    url: `${GRAMMAR_ASSET_BASE_URL}/tree-sitter-tsx.wasm`,
    sha256: "79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8",
    size: 1445638,
  },
  js: {
    url: `${GRAMMAR_ASSET_BASE_URL}/tree-sitter-javascript.wasm`,
    sha256: "5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240",
    size: 411770,
  },
  python: {
    url: `${GRAMMAR_ASSET_BASE_URL}/tree-sitter-python.wasm`,
    sha256: "16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47",
    size: 457883,
  },
  go: {
    url: `${GRAMMAR_ASSET_BASE_URL}/tree-sitter-go.wasm`,
    sha256: "9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7",
    size: 217182,
  },
  rust: {
    url: `${GRAMMAR_ASSET_BASE_URL}/tree-sitter-rust.wasm`,
    sha256: "f65f354215611fd94ad34134b3427eb3d58cbb745df7b6509ba722184db73d57",
    size: 1102547,
  },
};

export class GrammarOfflineError extends Error {
  readonly lang: GrammarLang;

  constructor(lang: GrammarLang, message?: string) {
    super(
      message ??
        `Grammar for '${lang}' was not found locally and network downloads are disabled in offline mode.`,
    );
    this.name = "GrammarOfflineError";
    this.lang = lang;
  }
}

export class GrammarIntegrityError extends Error {
  readonly lang: GrammarLang;
  readonly expectedSha256: string;
  readonly actualSha256: string;

  constructor(lang: GrammarLang, expectedSha256: string, actualSha256: string, message?: string) {
    super(
      message ??
        `Integrity verification failed for '${lang}' grammar. Expected SHA-256 ${expectedSha256}, got ${actualSha256}.`,
    );
    this.name = "GrammarIntegrityError";
    this.lang = lang;
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

export class GrammarUnavailableError extends Error {
  readonly lang: GrammarLang;

  constructor(lang: GrammarLang, message?: string) {
    super(
      message ??
        `Grammar for '${lang}' is unavailable: manifest entry has not been published or download URL is missing.`,
    );
    this.name = "GrammarUnavailableError";
    this.lang = lang;
  }
}

export class GrammarDownloadError extends Error {
  readonly lang: GrammarLang;
  readonly status?: number;

  constructor(lang: GrammarLang, status?: number, message?: string) {
    super(
      message ??
        `Failed to download grammar for '${lang}'${status !== undefined ? ` (HTTP ${status})` : ""}.`,
    );
    this.name = "GrammarDownloadError";
    this.lang = lang;
    this.status = status;
  }
}

let atomicCounter = 0;

/**
 * Writes a binary buffer atomically using a temp file + rename,
 * ensuring temp files are cleaned up on error.
 */
export async function writeBufferAtomic(file: string, data: Uint8Array): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  atomicCounter += 1;
  const tmp = `${file}.tmp-${process.pid}-${atomicCounter}`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (error) {
    try {
      await rm(tmp, { force: true });
    } catch {
      /* best effort cleanup */
    }
    throw error;
  }
}

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface GrammarStoreOptions {
  env?: Record<string, string | undefined>;
  cacheDir?: string;
  bundledDirs?: readonly string[];
  manifest?: GrammarManifest;
  fetch?: FetchFn;
  offline?: boolean;
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_BUNDLED_GRAMMAR_DIRS: readonly string[] = [
  path.join(MODULE_DIR, "grammars"),
  path.join(MODULE_DIR, "..", "grammars"),
  path.join(MODULE_DIR, "..", "vendor", "grammars"),
  path.join(MODULE_DIR, "..", "..", "vendor", "grammars"),
];

export function defaultGrammarCacheDir(
  env: Record<string, string | undefined> = process.env,
): string {
  // Older web-tree-sitter releases use a different WebAssembly linking format.
  return path.join(appConfigDir(env), GRAMMAR_CACHE_DIRECTORY);
}

export interface GrammarStore {
  resolveGrammar(lang: GrammarLang): Promise<Uint8Array | null>;
  getCacheDir(): string;
}

export function createGrammarStore(options: GrammarStoreOptions = {}): GrammarStore {
  const env = options.env ?? process.env;
  const cacheDir = options.cacheDir ?? defaultGrammarCacheDir(env);
  const bundledDirs = options.bundledDirs ?? DEFAULT_BUNDLED_GRAMMAR_DIRS;

  return {
    getCacheDir(): string {
      return cacheDir;
    },

    async resolveGrammar(lang: GrammarLang): Promise<Uint8Array | null> {
      const fileName = GRAMMAR_FILES[lang];
      if (fileName === undefined) return null;

      // 1. Environment variable override
      const envDir = env.REPOTRUCK_GRAMMARS_DIR;
      if (envDir && envDir.trim().length > 0) {
        try {
          const content = await readFile(path.join(envDir, fileName));
          return new Uint8Array(content);
        } catch {
          /* continue to cache */
        }
      }

      // 2. Application cache directory
      const cachedPath = path.join(cacheDir, fileName);
      try {
        const content = await readFile(cachedPath);
        return new Uint8Array(content);
      } catch {
        /* continue to bundled */
      }

      // 3. Bundled / vendored directories
      for (const dir of bundledDirs) {
        try {
          const content = await readFile(path.join(dir, fileName));
          return new Uint8Array(content);
        } catch {
          /* continue to next candidate */
        }
      }

      // 4. Download via fetch
      if (options.offline === true) {
        throw new GrammarOfflineError(lang);
      }

      const manifest = options.manifest ?? DEFAULT_GRAMMAR_MANIFEST;
      const entry = manifest[lang];
      if (!entry?.url || !entry.sha256) {
        throw new GrammarUnavailableError(lang);
      }

      const fetchFn = options.fetch ?? globalThis.fetch;
      let response: Response;
      try {
        response = await fetchFn(entry.url);
      } catch (err) {
        throw new GrammarDownloadError(
          lang,
          undefined,
          `Network error downloading grammar for '${lang}': ${(err as Error).message}`,
        );
      }

      if (!response.ok) {
        throw new GrammarDownloadError(
          lang,
          response.status,
          `Failed to download grammar for '${lang}' (HTTP ${response.status})`,
        );
      }

      let arrayBuf: ArrayBuffer;
      try {
        arrayBuf = await response.arrayBuffer();
      } catch (err) {
        throw new GrammarDownloadError(
          lang,
          undefined,
          `Failed to read download stream for '${lang}': ${(err as Error).message}`,
        );
      }

      const bytes = new Uint8Array(arrayBuf);
      const actualHash = createHash("sha256").update(bytes).digest("hex").toLowerCase();
      const expectedHash = entry.sha256.toLowerCase();

      if (actualHash !== expectedHash) {
        throw new GrammarIntegrityError(lang, expectedHash, actualHash);
      }

      await writeBufferAtomic(cachedPath, bytes);
      return bytes;
    },
  };
}

export async function resolveGrammar(
  lang: GrammarLang,
  options: GrammarStoreOptions = {},
): Promise<Uint8Array | null> {
  return createGrammarStore(options).resolveGrammar(lang);
}

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appConfigDir } from "./config.ts";

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
 * Release asset download URLs point to the official repotruck grammars-v1 release.
 * Hashes and sizes are computed deterministically from the canonical vendor wasm binaries.
 */
export const DEFAULT_GRAMMAR_MANIFEST: GrammarManifest = {
  ts: {
    url: "https://github.com/sametcn99/repotruck/releases/download/grammars-v1/tree-sitter-typescript.wasm",
    sha256: "8515404dceed38e1ed86aa34b09fcf3379fff1b4ff9dd3967bcd6d1eb5ac3d8f",
    size: 2342690,
  },
  tsx: {
    url: "https://github.com/sametcn99/repotruck/releases/download/grammars-v1/tree-sitter-tsx.wasm",
    sha256: "6aa3b2c70e76f5d48eafef1093e9c4de383e13f2fdde2f4e9b98a378f6a8f1b6",
    size: 2411272,
  },
  js: {
    url: "https://github.com/sametcn99/repotruck/releases/download/grammars-v1/tree-sitter-javascript.wasm",
    sha256: "63812b9e275d26851264734868d27a1656bd44a2ef6eb3e85e6b03728c595ab5",
    size: 647334,
  },
  python: {
    url: "https://github.com/sametcn99/repotruck/releases/download/grammars-v1/tree-sitter-python.wasm",
    sha256: "9056d0fb0c337810d019fae350e8167786119da98f0f282aceae7ab89ee8253b",
    size: 476105,
  },
  go: {
    url: "https://github.com/sametcn99/repotruck/releases/download/grammars-v1/tree-sitter-go.wasm",
    sha256: "9963ca89b616eaf04b08a43bc1fb0f07b85395bec313330851f1f1ead2f755b6",
    size: 235957,
  },
  rust: {
    url: "https://github.com/sametcn99/repotruck/releases/download/grammars-v1/tree-sitter-rust.wasm",
    sha256: "4409921a70d0aa5bec7d1d7ce809a557a8ee1cf6ace901e3ac6a76e62cfea903",
    size: 818756,
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
  path.join(MODULE_DIR, "..", "..", "vendor", "grammars"),
];

export function defaultGrammarCacheDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return path.join(appConfigDir(env), "grammars");
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

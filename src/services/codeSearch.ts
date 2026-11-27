import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Language, Parser } from "web-tree-sitter";
import { type GrammarLang, LANG_ALIASES, type SymbolKind } from "./codeSearchLang.ts";
import { extractSymbols } from "./codeSearchSymbols.ts";

export { extractSymbols } from "./codeSearchSymbols.ts";

import { BoundedRegex } from "./codeSearchRegex.ts";
import { walkSourceFiles } from "./codeSearchWalk.ts";
import type { RepotruckConfig } from "./config.ts";
import { distributionDirectory } from "./distribution.ts";
import { writeFileAtomic } from "./fsUtils.ts";
import {
  GrammarDownloadError,
  GrammarIntegrityError,
  GrammarOfflineError,
  type GrammarStoreOptions,
  GrammarUnavailableError,
  resolveGrammar,
} from "./grammarStore.ts";
import { withWorkspaceLock } from "./workspaceLock.ts";
import { workspacePath } from "./workspacePaths.ts";

export type { GrammarLang, SymbolKind } from "./codeSearchLang.ts";
export { LANG_ALIASES, SYMBOL_KINDS } from "./codeSearchLang.ts";
export {
  type IgnoreRule,
  parseGitignore,
  type WalkedFile,
  walkSourceFiles,
} from "./codeSearchWalk.ts";

export const CODE_INDEX_VERSION = 1;
export const MAX_INDEXED_FILE_BYTES = 1024 * 1024;

const GRAMMAR_FILES: Record<GrammarLang, string> = {
  ts: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  js: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
};

const EXTENSION_LANGS: Record<string, GrammarLang> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "js",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
};

export const GRAMMAR_LANGS: readonly GrammarLang[] = Object.keys(GRAMMAR_FILES) as GrammarLang[];

export type GrammarResolver = (lang: GrammarLang) => Promise<Uint8Array | null>;

export interface IndexedSymbol {
  kind: SymbolKind;
  name: string;
  line: number;
  exported: boolean;
}

export interface IndexedFile {
  path: string;
  repo: string;
  mtimeMs: number;
  size: number;
  hash?: string;
  symbols: IndexedSymbol[];
}

export interface CodeIndex {
  version: 1;
  grammars: GrammarLang[];
  files: IndexedFile[];
}

export interface CodeIndexStats {
  built: boolean;
  filesIndexed: number;
  filesReused: number;
  filesSkippedUnknown: number;
  filesSkippedLarge: number;
  symbols: number;
  durationMs: number;
}

export type CodeSearchMatchKind = SymbolKind | "text";

export interface CodeSearchMatch {
  repo: string;
  path: string;
  line: number;
  kind: CodeSearchMatchKind;
  name: string;
  exported: boolean;
  formatted: string;
}

export interface CodeSearchResult {
  matches: CodeSearchMatch[];
  index: CodeIndexStats;
}

export function defaultGrammarResolver(
  dirs?: readonly string[],
  options?: GrammarStoreOptions,
): GrammarResolver {
  return async (lang: GrammarLang): Promise<Uint8Array | null> => {
    return await resolveGrammar(lang, {
      ...options,
      bundledDirs: dirs ?? options?.bundledDirs,
    });
  };
}

export function codeIndexPath(root: string): string {
  return path.join(root, ".repotruck", "code-index.json");
}

let parserInit: Promise<void> | null = null;

function ensureParserInit(): Promise<void> {
  const distribution = distributionDirectory();
  parserInit ??= Parser.init(
    distribution
      ? { locateFile: () => path.join(distribution, "assets", "web-tree-sitter.wasm") }
      : undefined,
  );
  return parserInit;
}

const languageCache = new Map<GrammarLang, Language | null>();

export function clearLanguageCache(): void {
  languageCache.clear();
}

async function loadLanguage(
  lang: GrammarLang,
  resolver: GrammarResolver,
  useCache = true,
): Promise<Language | null> {
  if (useCache && languageCache.has(lang)) return languageCache.get(lang) ?? null;
  let loaded: Language | null = null;
  try {
    const bytes = await resolver(lang);
    if (bytes !== null) {
      await ensureParserInit();
      loaded = await Language.load(bytes);
    }
  } catch (error) {
    if (
      error instanceof GrammarOfflineError ||
      error instanceof GrammarDownloadError ||
      error instanceof GrammarIntegrityError ||
      error instanceof GrammarUnavailableError
    ) {
      throw error;
    }
    loaded = null;
  }
  if (useCache) languageCache.set(lang, loaded);
  return loaded;
}

function isIndexedFile(value: unknown): value is IndexedFile {
  if (value === null || typeof value !== "object") return false;
  const file = value as Partial<IndexedFile>;
  return (
    typeof file.path === "string" &&
    typeof file.repo === "string" &&
    typeof file.mtimeMs === "number" &&
    typeof file.size === "number" &&
    Array.isArray(file.symbols) &&
    file.symbols.every(
      (symbol) =>
        symbol !== null &&
        typeof symbol === "object" &&
        typeof (symbol as IndexedSymbol).kind === "string" &&
        typeof (symbol as IndexedSymbol).name === "string" &&
        typeof (symbol as IndexedSymbol).line === "number" &&
        typeof (symbol as IndexedSymbol).exported === "boolean",
    )
  );
}

export function isCodeIndex(value: unknown): value is CodeIndex {
  if (value === null || typeof value !== "object") return false;
  const index = value as Partial<CodeIndex>;
  return (
    index.version === CODE_INDEX_VERSION &&
    Array.isArray(index.files) &&
    index.files.every(isIndexedFile)
  );
}

async function readCodeIndex(root: string): Promise<CodeIndex | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(codeIndexPath(root), "utf8"));
    return isCodeIndex(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCodeIndex(root: string, index: CodeIndex): Promise<void> {
  const target = codeIndexPath(root);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFileAtomic(target, `${JSON.stringify(index, null, 2)}\n`);
}

export interface BuildCodeIndexOptions {
  root: string;
  config: RepotruckConfig;
  resolver?: GrammarResolver;
  force?: boolean;
  offline?: boolean;
}

export async function buildCodeIndex(
  options: BuildCodeIndexOptions,
): Promise<{ index: CodeIndex; stats: CodeIndexStats }> {
  const directory = await workspacePath(options.root, ".repotruck");
  return withWorkspaceLock(() => buildCodeIndexUnlocked(options), {
    env: { REPOTRUCK_CONFIG_DIR: directory },
    lockName: "code-index",
  });
}

async function buildCodeIndexUnlocked(
  options: BuildCodeIndexOptions,
): Promise<{ index: CodeIndex; stats: CodeIndexStats }> {
  const startedAt = Date.now();
  const resolver =
    options.resolver ??
    defaultGrammarResolver(undefined, {
      offline: options.offline,
    });
  const previous = options.force === true ? null : await readCodeIndex(options.root);
  const previousByPath = new Map((previous?.files ?? []).map((file) => [file.path, file]));
  const languages = new Map<GrammarLang, Language | null>();
  const grammarsSeen = new Set<GrammarLang>();
  const files: IndexedFile[] = [];
  let filesIndexed = 0;
  let filesReused = 0;
  let filesSkippedUnknown = 0;
  let filesSkippedLarge = 0;
  let parser: Parser | null = null;

  const parserFor = async (): Promise<Parser> => {
    if (parser === null) {
      await ensureParserInit();
      parser = new Parser();
    }
    return parser;
  };

  try {
    for (const repo of options.config.repos) {
      const repoDir = await workspacePath(options.root, repo.relativePath);
      const walked = await walkSourceFiles(repoDir);
      for (const walkedFile of walked) {
        const lang = EXTENSION_LANGS[path.extname(walkedFile.relPath).toLowerCase()];
        if (lang === undefined) {
          filesSkippedUnknown += 1;
          continue;
        }
        let fileStat: Stats;
        try {
          fileStat = await stat(walkedFile.absPath);
        } catch {
          continue;
        }
        if (fileStat.size > MAX_INDEXED_FILE_BYTES) {
          filesSkippedLarge += 1;
          continue;
        }
        let source: string;
        let hash: string;
        try {
          const bytes = await readFile(walkedFile.absPath);
          if (bytes.includes(0)) continue;
          source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          hash = createHash("sha256").update(bytes).digest("hex");
        } catch {
          continue;
        }
        const relPath = `${repo.relativePath}/${walkedFile.relPath}`;
        const cached = previousByPath.get(relPath);
        if (
          cached !== undefined &&
          cached.mtimeMs === fileStat.mtimeMs &&
          cached.size === fileStat.size &&
          cached.hash === hash
        ) {
          files.push({ ...cached, path: relPath });
          grammarsSeen.add(lang);
          filesReused += 1;
          continue;
        }
        let language = languages.get(lang);
        if (language === undefined) {
          const useCache = options.resolver === undefined && options.offline !== true;
          language = await loadLanguage(lang, resolver, useCache);
          languages.set(lang, language);
        }
        if (language === null) {
          filesSkippedUnknown += 1;
          continue;
        }
        grammarsSeen.add(lang);
        let symbols: IndexedSymbol[];
        try {
          const activeParser = await parserFor();
          activeParser.setLanguage(language);
          const tree = activeParser.parse(source);
          if (tree === null || tree.rootNode === null) continue;
          try {
            symbols = extractSymbols(tree.rootNode);
          } finally {
            tree.delete();
          }
        } catch {
          continue;
        }
        files.push({
          path: relPath,
          repo: `${repo.owner}/${repo.name}`,
          mtimeMs: fileStat.mtimeMs,
          size: fileStat.size,
          hash,
          symbols,
        });
        filesIndexed += 1;
      }
    }
  } finally {
    (parser as Parser | null)?.delete();
  }

  const index: CodeIndex = {
    version: CODE_INDEX_VERSION,
    grammars: [...grammarsSeen].sort(),
    files,
  };
  await writeCodeIndex(options.root, index);

  return {
    index,
    stats: {
      built: previous === null || filesIndexed > 0 || options.force === true,
      filesIndexed,
      filesReused,
      filesSkippedUnknown,
      filesSkippedLarge,
      symbols: files.reduce((total, file) => total + file.symbols.length, 0),
      durationMs: Date.now() - startedAt,
    },
  };
}

export interface SearchCodeOptions {
  root: string;
  config: RepotruckConfig;
  pattern: string;
  kind?: string;
  lang?: string;
  limit?: number;
  rebuild?: boolean;
  /** Treat `pattern` as a case-insensitive regular expression. */
  regex?: boolean;
  /** Perform full-text line search across tracked source files instead of AST symbol search. */
  text?: boolean;
  resolver?: GrammarResolver;
  offline?: boolean;
}

export function formatCodeSearchMatch(match: Omit<CodeSearchMatch, "formatted">): string {
  if (match.kind === "text") {
    return `${match.repo}:${match.path}:${match.line}: ${match.name}`;
  }
  const exportedPrefix = match.exported ? "export " : "";
  return `${match.repo}:${match.path}:${match.line}: ${exportedPrefix}${match.kind} ${match.name}`;
}

async function searchCodeText(options: SearchCodeOptions): Promise<CodeSearchResult> {
  const startedAt = Date.now();
  const regex = options.regex ? new BoundedRegex(options.pattern) : null;
  const needle = options.pattern.toLowerCase();

  const lang =
    options.lang === undefined ? null : (LANG_ALIASES[options.lang.toLowerCase()] ?? null);
  const limit = options.limit === undefined ? Infinity : options.limit;

  const matches: CodeSearchMatch[] = [];
  let filesScanned = 0;
  let filesSkippedLarge = 0;

  try {
    outer: for (const repo of options.config.repos) {
      const repoKey = `${repo.owner}/${repo.name}`;
      const repoDir = await workspacePath(options.root, repo.relativePath);
      const walked = await walkSourceFiles(repoDir);
      for (const walkedFile of walked) {
        if (lang !== null) {
          const fileLang = EXTENSION_LANGS[path.extname(walkedFile.relPath).toLowerCase()];
          if (fileLang !== lang) continue;
        }
        let fileStat: Stats;
        try {
          fileStat = await stat(walkedFile.absPath);
        } catch {
          continue;
        }
        if (fileStat.size > MAX_INDEXED_FILE_BYTES) {
          filesSkippedLarge += 1;
          continue;
        }
        let content: string;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(
            await readFile(walkedFile.absPath),
          );
        } catch {
          continue;
        }
        if (content.includes("\0")) continue;
        filesScanned += 1;
        const relPath = `${repo.relativePath}/${walkedFile.relPath}`;
        const lines = content.split(/\r?\n/);
        const matched = regex
          ? await regex.test(lines)
          : lines.map((line) => line.toLowerCase().includes(needle));
        for (let i = 0; i < lines.length; i += 1) {
          const rawLine = lines[i]!;
          if (!matched[i]) continue;
          const snippet = rawLine.trim().slice(0, 180);
          const partial: Omit<CodeSearchMatch, "formatted"> = {
            repo: repoKey,
            path: relPath,
            line: i + 1,
            kind: "text",
            name: snippet,
            exported: false,
          };
          matches.push({ ...partial, formatted: formatCodeSearchMatch(partial) });
          if (matches.length >= limit) break outer;
        }
      }
    }
  } finally {
    await regex?.close();
  }
  return {
    matches,
    index: {
      built: false,
      filesIndexed: filesScanned,
      filesReused: 0,
      filesSkippedUnknown: 0,
      filesSkippedLarge,
      symbols: 0,
      durationMs: Date.now() - startedAt,
    },
  };
}

export async function searchCode(options: SearchCodeOptions): Promise<CodeSearchResult> {
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit <= 0))
    throw new Error("search limit must be a positive integer");
  if (options.lang !== undefined && LANG_ALIASES[options.lang.toLowerCase()] === undefined)
    throw new Error(`unsupported language: ${options.lang}`);
  if (options.text === true) {
    return await searchCodeText(options);
  }

  const built = await buildCodeIndex({
    root: options.root,
    config: options.config,
    resolver: options.resolver,
    force: options.rebuild === true,
    offline: options.offline,
  });
  const index = built.index;
  const stats = built.stats;

  const regex = options.regex ? new BoundedRegex(options.pattern) : null;
  const needle = options.pattern.toLowerCase();
  const kind = options.kind === undefined ? null : options.kind.toLowerCase();
  const lang =
    options.lang === undefined ? null : (LANG_ALIASES[options.lang.toLowerCase()] ?? null);
  const limit = options.limit === undefined ? Infinity : options.limit;

  const matches: CodeSearchMatch[] = [];
  try {
    outer: for (const file of index.files) {
      const fileLang = EXTENSION_LANGS[path.extname(file.path).toLowerCase()];
      if (fileLang === undefined) continue;
      if (lang !== null && fileLang !== lang) continue;
      const matched = regex
        ? await regex.test(file.symbols.map((symbol) => symbol.name))
        : file.symbols.map((symbol) => symbol.name.toLowerCase().includes(needle));
      for (const [i, symbol] of file.symbols.entries()) {
        if (!matched[i]) continue;
        if (kind !== null && symbol.kind !== kind) continue;
        const partial = {
          repo: file.repo,
          path: file.path,
          line: symbol.line,
          kind: symbol.kind,
          name: symbol.name,
          exported: symbol.exported,
        };
        matches.push({ ...partial, formatted: formatCodeSearchMatch(partial) });
        if (matches.length >= limit) break outer;
      }
    }
  } finally {
    await regex?.close();
  }
  return { matches, index: stats };
}

/**
 * Refreshes the code index after a sync, but only when the user has built one
 * before - unchanged content reuses its parsed symbols, and skipping it
 * for never-indexed workspaces keeps sync fast for everyone else.
 */
export async function refreshCodeIndexIfPresent(
  root: string,
  config: RepotruckConfig,
): Promise<boolean> {
  try {
    await stat(codeIndexPath(root));
  } catch {
    return false;
  }
  await buildCodeIndex({ root, config });
  return true;
}

import type { Dirent, Stats } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Language, type Node, Parser } from "web-tree-sitter";
import { firstErrorLine } from "./cloner.ts";
import { type GrammarLang, LANG_ALIASES, type SymbolKind } from "./codeSearchLang.ts";
import type { RepotruckConfig } from "./config.ts";
import { writeFileAtomic } from "./fsUtils.ts";

export type { GrammarLang, SymbolKind } from "./codeSearchLang.ts";
export { LANG_ALIASES, SYMBOL_KINDS } from "./codeSearchLang.ts";

import {
  GrammarDownloadError,
  GrammarIntegrityError,
  GrammarOfflineError,
  type GrammarStoreOptions,
  GrammarUnavailableError,
  resolveGrammar,
} from "./grammarStore.ts";

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

const SYMBOL_TYPES: Record<string, SymbolKind> = {
  function_declaration: "function",
  class_declaration: "class",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum",
  method_definition: "method",
  lexical_declaration: "const",
  function_definition: "function",
  function_item: "function",
  struct_item: "class",
  impl_item: "class",
};

const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "__pycache__",
  "venv",
  "coverage",
  "site-packages",
]);

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

export interface CodeSearchMatch {
  repo: string;
  path: string;
  line: number;
  kind: SymbolKind;
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
  parserInit ??= Parser.init();
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

function nodeName(node: Node): string | null {
  const direct = node.childForFieldName("name");
  if (direct !== null) return direct.text;
  const first = node.namedChildren.find((child): child is Node => child !== null);
  if (first === undefined) return null;
  const nested = first.childForFieldName("name");
  return nested !== null ? nested.text : null;
}

export function extractSymbols(root: Node): IndexedSymbol[] {
  const symbols: IndexedSymbol[] = [];
  const visit = (node: Node): void => {
    const kind = SYMBOL_TYPES[node.type];
    if (kind !== undefined) {
      const name = nodeName(node);
      if (name !== null && name.length > 0) {
        symbols.push({
          kind,
          name,
          line: node.startPosition.row + 1,
          exported: node.parent?.type === "export_statement",
        });
      }
    }
    for (const child of node.children) {
      if (child?.isNamed) visit(child);
    }
  };
  visit(root);
  symbols.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return symbols;
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

function shouldSkipDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIRS.has(name);
}

interface IgnoreRule {
  negated: boolean;
  regex: RegExp;
}

/** Compiles a root .gitignore into matchers (basename or anchored-path globs). */
export function parseGitignore(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    if (negated) line = line.slice(1);
    if (line.length === 0) continue;
    const anchored = line.includes("/");
    line = line.replace(/^\//, "").replace(/\/+$/, "");
    if (line.length === 0) continue;
    const pattern = anchored ? `**/${line}` : `**/${line}**`;
    const regex = globLikeToRegex(pattern);
    if (regex !== null) rules.push({ negated, regex });
  }
  return rules;
}

function globLikeToRegex(pattern: string): RegExp | null {
  let source = "";
  let index = 0;
  while (index < pattern.length) {
    const ch = pattern[index]!;
    if (ch === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 2;
        if (pattern[index] === "/") index += 1;
        continue;
      }
      source += "[^/]*";
      index += 1;
      continue;
    }
    if (ch === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }
  try {
    return new RegExp(`^${source}$`, "i");
  } catch {
    return null;
  }
}

function isIgnoredByRules(relPath: string, rules: readonly IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.regex.test(relPath)) {
      if (rule.negated) {
        ignored = false;
      } else {
        ignored = true;
      }
    }
  }
  return ignored;
}

async function readRootGitignore(repoDir: string): Promise<IgnoreRule[]> {
  try {
    return parseGitignore(await readFile(path.join(repoDir, ".gitignore"), "utf8"));
  } catch {
    return [];
  }
}

export interface WalkedFile {
  absPath: string;
  relPath: string;
}

export async function walkSourceFiles(repoDir: string): Promise<WalkedFile[]> {
  const files: WalkedFile[] = [];
  const ignoreRules = await readRootGitignore(repoDir);
  const visit = async (dir: string, prefix: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (shouldSkipDir(entry.name)) continue;
      const absPath = path.join(dir, entry.name);
      const relPath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(absPath, relPath);
      } else if (entry.isFile()) {
        if (ignoreRules.length > 0 && isIgnoredByRules(relPath, ignoreRules)) continue;
        files.push({ absPath, relPath });
      }
    }
  };
  await visit(repoDir, "");
  files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return files;
}

export interface BuildCodeIndexOptions {
  root: string;
  config: RepotruckConfig;
  resolver?: GrammarResolver;
  force?: boolean;
  offline?: boolean;
}

export async function buildCodeIndex(options: BuildCodeIndexOptions): Promise<{
  index: CodeIndex;
  stats: CodeIndexStats;
}> {
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

  for (const repo of options.config.repos) {
    const repoDir = path.join(options.root, ...repo.relativePath.split("/"));
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
      const relPath = `${repo.relativePath}/${walkedFile.relPath}`;
      const cached = previousByPath.get(relPath);
      if (
        cached !== undefined &&
        cached.mtimeMs === fileStat.mtimeMs &&
        cached.size === fileStat.size
      ) {
        files.push({ ...cached, path: relPath });
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
      let source: string;
      try {
        source = await readFile(walkedFile.absPath, "utf8");
      } catch {
        continue;
      }
      let symbols: IndexedSymbol[];
      try {
        const activeParser = await parserFor();
        activeParser.setLanguage(language);
        const tree = activeParser.parse(source);
        if (tree === null || tree.rootNode === null) continue;
        symbols = extractSymbols(tree.rootNode);
      } catch {
        continue;
      }
      files.push({
        path: relPath,
        repo: `${repo.owner}/${repo.name}`,
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size,
        symbols,
      });
      filesIndexed += 1;
    }
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
  resolver?: GrammarResolver;
  offline?: boolean;
}

export function formatCodeSearchMatch(match: Omit<CodeSearchMatch, "formatted">): string {
  const exportedPrefix = match.exported ? "export " : "";
  return `${match.repo}:${match.path}:${match.line}: ${exportedPrefix}${match.kind} ${match.name}`;
}

export async function searchCode(options: SearchCodeOptions): Promise<CodeSearchResult> {
  const built = await buildCodeIndex({
    root: options.root,
    config: options.config,
    resolver: options.resolver,
    force: options.rebuild === true,
    offline: options.offline,
  });
  const index = built.index;
  const stats = built.stats;

  let matchesSymbol: (name: string) => boolean;
  if (options.regex === true) {
    let matcher: RegExp;
    try {
      matcher = new RegExp(options.pattern, "i");
    } catch (error) {
      throw new Error(`invalid regex pattern: ${options.pattern} (${firstErrorLine(error)})`);
    }
    matchesSymbol = (name) => matcher.test(name);
  } else {
    const needle = options.pattern.toLowerCase();
    matchesSymbol = (name) => name.toLowerCase().includes(needle);
  }
  const kind = options.kind === undefined ? null : options.kind.toLowerCase();
  const lang =
    options.lang === undefined ? null : (LANG_ALIASES[options.lang.toLowerCase()] ?? null);
  const limit = options.limit === undefined ? Infinity : Math.max(1, options.limit);

  const matches: CodeSearchMatch[] = [];
  outer: for (const file of index.files) {
    const fileLang = EXTENSION_LANGS[path.extname(file.path).toLowerCase()];
    if (fileLang === undefined) continue;
    if (lang !== null && fileLang !== lang) continue;
    for (const symbol of file.symbols) {
      if (!matchesSymbol(symbol.name)) continue;
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

  return { matches, index: stats };
}

/**
 * Refreshes the code index after a sync, but only when the user has built one
 * before — a fresh walk is cheap thanks to mtime-based reuse, and skipping it
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

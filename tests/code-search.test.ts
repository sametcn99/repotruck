import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  codeIndexPath,
  defaultGrammarResolver,
  extractSymbols,
  type GrammarResolver,
  searchCode,
  walkSourceFiles,
} from "../src/services/codeSearch.ts";
import type { RepotruckConfig } from "../src/services/config.ts";

const pendingDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  pendingDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of pendingDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* swept again by the next test file run */
    }
  }
});

const OPENUI_ASSETS = path.resolve(
  import.meta.dir,
  "..",
  "node_modules",
  "@opentui",
  "core",
  "assets",
);

const OPENUI_GRAMMAR_FILES: Partial<Record<string, string>> = {
  ts: path.join(OPENUI_ASSETS, "typescript", "tree-sitter-typescript.wasm"),
  tsx: path.join(OPENUI_ASSETS, "typescriptreact", "tree-sitter-tsx.wasm"),
  js: path.join(OPENUI_ASSETS, "javascript", "tree-sitter-javascript.wasm"),
};

const grammarLoads: string[] = [];

const opentuiResolver: GrammarResolver = async (lang) => {
  grammarLoads.push(lang);
  const file = OPENUI_GRAMMAR_FILES[lang];
  if (file === undefined) return null;
  return new Uint8Array(await readFile(file));
};

function makeConfig(root: string): RepotruckConfig {
  return {
    version: 1,
    root,
    preset: "categorized",
    lastSync: null,
    repos: [
      {
        owner: "monalisa",
        name: "api",
        relativePath: "monalisa/source/api",
        category: "source",
        internal: true,
        language: "TypeScript",
        updatedAt: null,
      },
      {
        owner: "octocat",
        name: "tool",
        relativePath: "community/octocat/forks/tool",
        category: "forks",
        internal: false,
        language: "JavaScript",
        updatedAt: null,
      },
      {
        owner: "ghost",
        name: "missing",
        relativePath: "ghost/source/missing",
        category: "source",
        internal: true,
        language: null,
        updatedAt: null,
      },
    ],
  };
}

const API_TS = [
  "export function validateRootInput(input: string): boolean {",
  "  return input.length > 0;",
  "}",
  "",
  "class ApiClient {",
  "  connect(): void {}",
  "}",
  "",
  "interface RepoOptions {",
  "  verbose: boolean;",
  "}",
  "",
  "const DEFAULT_LIMIT = 50;",
  "",
  "function helper(): number {",
  "  return 1;",
  "}",
  "",
].join("\n");

const TOOL_JS = [
  "function parseArgs(args) {",
  "  return args;",
  "}",
  "",
  "module.exports = { parseArgs };",
  "",
].join("\n");

function makeFixture(): { root: string; config: RepotruckConfig } {
  const root = makeTempDir("repotruck-code-search-");
  const apiDir = path.join(root, "monalisa", "source", "api");
  const toolDir = path.join(root, "community", "octocat", "forks", "tool");
  mkdirSync(path.join(apiDir, "src"), { recursive: true });
  mkdirSync(path.join(apiDir, "node_modules", "lib"), { recursive: true });
  mkdirSync(path.join(apiDir, ".hidden"), { recursive: true });
  mkdirSync(toolDir, { recursive: true });
  writeFileSync(path.join(apiDir, "src", "api.ts"), API_TS, "utf8");
  writeFileSync(
    path.join(apiDir, "node_modules", "lib", "skip.ts"),
    "function skipped() {}\n",
    "utf8",
  );
  writeFileSync(path.join(apiDir, ".hidden", "secret.ts"), "function secret() {}\n", "utf8");
  writeFileSync(path.join(apiDir, "notes.txt"), "not source code\n", "utf8");
  writeFileSync(path.join(toolDir, "index.js"), TOOL_JS, "utf8");
  return { root, config: makeConfig(root) };
}

describe("searchCode", () => {
  test("builds an index on first search and finds an exported function", async () => {
    const { root, config } = makeFixture();
    const result = await searchCode({
      root,
      config,
      pattern: "validate",
      resolver: opentuiResolver,
    });
    expect(result.index.built).toBe(true);
    expect(result.index.filesIndexed).toBe(2);
    expect(result.index.filesSkippedUnknown).toBe(1);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0]!.formatted).toBe(
      "monalisa/api:monalisa/source/api/src/api.ts:1: export function validateRootInput",
    );
    expect(result.matches[0]!.exported).toBe(true);
    expect(result.matches[0]!.kind).toBe("function");
    expect(result.matches[0]!.line).toBe(1);
  });

  test("records the persistent index under .repotruck/", async () => {
    const { root, config } = makeFixture();
    await searchCode({ root, config, pattern: "parse", resolver: opentuiResolver });
    const raw = await readFile(codeIndexPath(root), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.files)).toBe(true);
    expect(parsed.files.some((file: { repo: string }) => file.repo === "octocat/tool")).toBe(true);
  });

  test("skips node_modules, dot directories, and unknown extensions", async () => {
    const { root, config } = makeFixture();
    const result = await searchCode({
      root,
      config,
      pattern: "skipped",
      resolver: opentuiResolver,
    });
    expect(result.matches.length).toBe(0);
    const hidden = await searchCode({ root, config, pattern: "secret", resolver: opentuiResolver });
    expect(hidden.matches.length).toBe(0);
  });

  test("filters by kind and lang", async () => {
    const { root, config } = makeFixture();
    const classes = await searchCode({
      root,
      config,
      pattern: "",
      kind: "class",
      resolver: opentuiResolver,
    });
    expect(classes.matches.map((match) => match.name)).toEqual(["ApiClient"]);
    const methods = await searchCode({
      root,
      config,
      pattern: "conn",
      kind: "method",
      resolver: opentuiResolver,
    });
    expect(methods.matches.map((match) => match.name)).toEqual(["connect"]);
    const jsOnly = await searchCode({
      root,
      config,
      pattern: "parse",
      lang: "js",
      resolver: opentuiResolver,
    });
    expect(jsOnly.matches.map((match) => match.name)).toEqual(["parseArgs"]);
    const pyAlias = await searchCode({
      root,
      config,
      pattern: "parse",
      lang: "py",
      resolver: opentuiResolver,
    });
    expect(pyAlias.matches.length).toBe(0);
  });

  test("respects the limit option", async () => {
    const { root, config } = makeFixture();
    const result = await searchCode({
      root,
      config,
      pattern: "",
      limit: 3,
      resolver: opentuiResolver,
    });
    expect(result.matches.length).toBe(3);
  });

  test("matches case-insensitively and reports non-exported symbols without the prefix", async () => {
    const { root, config } = makeFixture();
    const result = await searchCode({
      root,
      config,
      pattern: "DEFAULT",
      resolver: opentuiResolver,
    });
    expect(result.matches.map((match) => match.formatted)).toEqual([
      "monalisa/api:monalisa/source/api/src/api.ts:13: const DEFAULT_LIMIT",
    ]);
  });

  test("reuses unchanged files on the second search", async () => {
    const { root, config } = makeFixture();
    await searchCode({ root, config, pattern: "x", resolver: opentuiResolver });
    const loadsAfterFirst = grammarLoads.length;
    const second = await searchCode({ root, config, pattern: "x", resolver: opentuiResolver });
    expect(second.index.built).toBe(false);
    expect(second.index.filesReused).toBe(2);
    expect(grammarLoads.length).toBe(loadsAfterFirst);
  });

  test("reparses a file when its size changes", async () => {
    const { root, config } = makeFixture();
    await searchCode({ root, config, pattern: "helper", resolver: opentuiResolver });
    const apiTs = path.join(root, "monalisa", "source", "api", "src", "api.ts");
    writeFileSync(apiTs, `${API_TS}\nexport function extra(): void {}\n`, "utf8");
    const second = await searchCode({ root, config, pattern: "extra", resolver: opentuiResolver });
    expect(second.index.built).toBe(true);
    expect(second.index.filesIndexed).toBe(1);
    expect(second.index.filesReused).toBe(1);
    expect(second.matches[0]!.formatted).toBe(
      "monalisa/api:monalisa/source/api/src/api.ts:19: export function extra",
    );
  });

  test("reparses a file when only its mtime changes", async () => {
    const { root, config } = makeFixture();
    await searchCode({ root, config, pattern: "helper", resolver: opentuiResolver });
    const apiTs = path.join(root, "monalisa", "source", "api", "src", "api.ts");
    utimesSync(apiTs, new Date(0), new Date(0));
    const second = await searchCode({ root, config, pattern: "helper", resolver: opentuiResolver });
    expect(second.index.filesIndexed).toBe(1);
    expect(second.matches.map((match) => match.name)).toContain("helper");
  });

  test("drops deleted files from the index on rebuild", async () => {
    const { root, config } = makeFixture();
    await searchCode({ root, config, pattern: "parseArgs", resolver: opentuiResolver });
    const toolJs = path.join(root, "community", "octocat", "forks", "tool", "index.js");
    rmSync(toolJs);
    const second = await searchCode({
      root,
      config,
      pattern: "parseArgs",
      resolver: opentuiResolver,
    });
    expect(second.matches.length).toBe(0);
  });

  test("silently rebuilds a corrupt index", async () => {
    const { root, config } = makeFixture();
    await searchCode({ root, config, pattern: "helper", resolver: opentuiResolver });
    writeFileSync(codeIndexPath(root), "{not json", "utf8");
    const second = await searchCode({ root, config, pattern: "helper", resolver: opentuiResolver });
    expect(second.index.built).toBe(true);
    expect(second.matches.map((match) => match.name)).toContain("helper");
  });

  test("skips files above the 1 MB cap", async () => {
    const root = makeTempDir("repotruck-code-search-");
    const apiDir = path.join(root, "monalisa", "source", "api");
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(path.join(apiDir, "big.ts"), "x".repeat(1024 * 1024 + 1), "utf8");
    const config = makeConfig(root);
    const result = await searchCode({ root, config, pattern: "x", resolver: opentuiResolver });
    expect(result.index.filesSkippedLarge).toBe(1);
    expect(result.index.filesIndexed).toBe(0);
  });

  test("rebuild forces a full reparse", async () => {
    const { root, config } = makeFixture();
    await searchCode({ root, config, pattern: "x", resolver: opentuiResolver });
    const second = await searchCode({
      root,
      config,
      pattern: "validate",
      rebuild: true,
      resolver: opentuiResolver,
    });
    expect(second.index.built).toBe(true);
    expect(second.index.filesIndexed).toBe(2);
    expect(second.index.filesReused).toBe(0);
  });
});

describe("walkSourceFiles", () => {
  test("returns posix-relative paths and skips excluded directories", async () => {
    const { root } = makeFixture();
    const walked = await walkSourceFiles(path.join(root, "monalisa", "source", "api"));
    const paths = walked.map((file) => file.relPath);
    expect(paths).toContain("src/api.ts");
    expect(paths).toContain("notes.txt");
    expect(paths.some((rel) => rel.startsWith("node_modules/"))).toBe(false);
    expect(paths.some((rel) => rel.startsWith(".hidden/"))).toBe(false);
    expect(paths.every((rel) => !rel.includes("\\"))).toBe(true);
  });
});

describe("defaultGrammarResolver", () => {
  test("reads the vendored grammars relative to the module", async () => {
    const resolver = defaultGrammarResolver();
    const python = await resolver("python");
    expect(python).not.toBeNull();
    expect(python!.length).toBeGreaterThan(100_000);
  });
});

describe("extractSymbols", () => {
  test("is exported for direct symbol-table use", () => {
    expect(typeof extractSymbols).toBe("function");
  });
});

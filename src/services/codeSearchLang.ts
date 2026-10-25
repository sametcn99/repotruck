export type GrammarLang = "ts" | "tsx" | "js" | "python" | "go" | "rust";
export type SymbolKind = "function" | "class" | "interface" | "type" | "enum" | "method" | "const";

export const LANG_ALIASES: Record<string, GrammarLang> = {
  ts: "ts",
  typescript: "ts",
  tsx: "tsx",
  js: "js",
  javascript: "js",
  py: "python",
  python: "python",
  go: "go",
  golang: "go",
  rs: "rust",
  rust: "rust",
};

export const SYMBOL_KINDS: readonly SymbolKind[] = [
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "method",
  "const",
];

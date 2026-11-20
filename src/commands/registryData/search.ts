import type { CommandSpec } from "../registryTypes.ts";
import { f, jsonFlag } from "../registryTypes.ts";

/** Registry section: search. Split out of registry.ts for the size budget. */
export const SEARCH_COMMANDS: readonly CommandSpec[] = [
  // ---- search & automation ------------------------------------------------
  {
    id: "search-code",
    path: "search-code",
    title: "Code Search",
    group: "Search",
    summary: "Symbol, text or regex search across the workspace",
    args: [{ name: "pattern", required: true, summary: "symbol / text / regex pattern" }],
    surface: { kind: "view", view: "search" },
    requires: ["workspace"],
    flags: [
      f("--kind", "enum", "symbol kind filter", "kind picker", {
        values: ["function", "class", "interface", "type", "enum", "method", "const"],
        complete: "kinds",
      }),
      f("--lang", "enum", "language filter", "lang picker", {
        values: ["ts", "tsx", "js", "py", "go", "rs"],
        complete: "langs",
      }),
      f("--limit", "int", "max matches (default 50)", "stepper", { short: "-l", default: "50" }),
      f("--offline", "bool", "require cached grammars only", "offline toggle"),
      f("--rebuild", "bool", "force rebuild the symbol index", "rebuild action"),
      f("--regex", "bool", "treat pattern as regex", "mode: regex"),
      f("--text", "bool", "raw line search instead of symbols", "mode: text"),
      jsonFlag("matches as JSON copy"),
    ],
  },
  {
    id: "run",
    path: "run",
    title: "Run Console",
    group: "Search",
    summary: "Run a shell command across repositories in parallel",
    args: [{ name: "command", required: true, summary: "command and args (variadic)" }],
    surface: { kind: "view", view: "run" },
    requires: ["workspace"],
    flags: [
      f("--repo", "list", "target repositories (repeatable)", "scope: repo list editor", {
        short: "-r",
      }),
      f("--pinned", "bool", "run only in pinned repos", "scope: pinned"),
      f("--profile", "string", "run only in a named profile", "scope: profile picker"),
      f("--concurrency", "int", "parallel execution limit", "stepper", {
        short: "-c",
        default: "3",
      }),
      jsonFlag("results as JSON copy"),
    ],
  },
  {
    id: "instructions",
    path: "instructions",
    title: "AGENTS.md instructions",
    group: "Search",
    summary: "Manage workspace agent instructions",
    args: [],
    surface: { kind: "view", view: "agents" },
    requires: ["workspace"],
    flags: [],
  },
  {
    id: "instructions.template",
    path: "instructions template",
    title: "AGENTS.md templates",
    group: "Search",
    summary: "List, apply or clear instruction templates",
    args: [{ name: "template", required: false, summary: "node / python / monorepo" }],
    surface: { kind: "view", view: "agents" },
    requires: ["workspace"],
    flags: [f("--clear", "bool", "remove the applied template block", "clear button")],
  },
  {
    id: "instructions.export",
    path: "instructions export",
    title: "Export instructions",
    group: "Search",
    summary: "Export agent instructions to cursor/claude/copilot/agents",
    args: [],
    surface: { kind: "view", view: "agents" },
    requires: ["workspace"],
    flags: [
      f("--format", "enum", "export format", "format picker", {
        short: "-f",
        values: ["agents", "cursor", "claude", "copilot"],
        default: "cursor",
      }),
      f("--out", "path", "custom output file", "output path field", { short: "-o" }),
      jsonFlag("export result as JSON copy"),
    ],
  },
  {
    id: "changelog",
    path: "changelog",
    title: "Changelog",
    group: "Search",
    summary: "Synthesize commits into a changelog",
    args: [],
    surface: { kind: "view", view: "changelog" },
    requires: ["workspace"],
    flags: [
      f("--since", "string", "git log since expression", "field", { default: "7 days ago" }),
      f("--until", "string", "git log until expression", "field"),
      f("--author", "string", "filter by author", "field"),
      f("--repo", "string", "filter to one repository", "repo picker"),
      f("--format", "enum", "markdown or json", "preview + copy-as", {
        values: ["markdown", "json"],
        default: "markdown",
      }),
      f("--out", "path", "write to a file instead of stdout", "write-file action", { short: "-o" }),
      f("--json", "bool", "alias for --format json", "copy-as JSON", { adapted: true }),
    ],
  },
];

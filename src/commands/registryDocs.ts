/**
 * Command documentation builder — the shared presentation layer over the
 * parity registry (src/commands/registry.ts).
 *
 * Consumed by scripts/docs-generate.ts (website tables) and by the AGENTS.md
 * CLI/MCP guide (src/services/agentsMdGuide.ts), so both surfaces render from
 * one builder and can never drift from the command surface.
 *
 * Docs-only curation (examples, group blurbs, argument placeholders) lives
 * here — presentation, not parity data.
 */
import { type CommandSpec, type FlagSpec, REGISTRY } from "./registry.ts";

export const DOC_GROUP_ORDER: readonly {
  registry: CommandSpec["group"];
  id: string;
  title: string;
  blurb: string;
}[] = [
  {
    registry: "Sync",
    id: "sync-and-clone",
    title: "Sync, clone and discover",
    blurb: "Search GitHub and move repositories between GitHub and disk in bulk or one at a time.",
  },
  {
    registry: "Lifecycle",
    id: "lifecycle",
    title: "Repository lifecycle",
    blurb: "Track, untrack, soft-delete/restore, archive and inspect repository health.",
  },
  {
    registry: "Workspace",
    id: "workspace",
    title: "Workspace and layout",
    blurb: "Create, move and re-file repositories; manage workspaces, profiles and aliases.",
  },
  {
    registry: "Search",
    id: "search-and-run",
    title: "Code search and automation",
    blurb: "Tree-sitter symbol indexing, parallel command execution, and workspace instructions.",
  },
  {
    registry: "Platform",
    id: "platform",
    title: "Authentication and diagnostics",
    blurb: "Manage authentication, system diagnostics, repository stats, and shell completions.",
  },
  {
    registry: "Settings",
    id: "cli-settings",
    title: "Settings, updates and agents",
    blurb: "Persist defaults, stay current, and expose the workspace to coding agents.",
  },
];

/**
 * Argument placeholder overrides where the flag name reads poorly alone.
 * Keys are either the bare flag (applies everywhere) or `command:--flag` for
 * commands whose CLI help spells a different placeholder (sync says
 * `-c, --concurrency <n>` while the global/run flag is `<number>`).
 */
const ARG_OVERRIDES: Record<string, string> = {
  "--watch": "[seconds]",
  "--dir": "root",
  "--limit": "n",
  "search-code:--limit": "number",
  "--concurrency": "number",
  "sync:--concurrency": "n",
  "--depth": "n",
  "--include": "glob",
  "--exclude": "glob",
  "--divergence": "strategy",
  "--sparse": "dirs...",
  "--topic": "topic",
  "--min-stars": "n",
  "--port": "number",
  "--host": "hostname",
  "--since": "duration",
  "--until": "duration",
  "--author": "author",
  "--repo": "ref",
  "--profile": "name",
  "--org": "name",
  "--lang": "language",
  "--format": "fmt",
  "--out": "file",
  "--action": "action",
  "--older-than": "days",
  "--from": "dir",
  "--at": "relative-path",
  "--description": "text",
  "--base-url": "url",
  "--preset": "id",
  "--token": "token",
  "--kind": "kind",
  "--name": "name",
};

/** Args rendered as variadic in usage lines. */
const VARIADIC_ARGS = new Set(["command", "segments", "repos"]);

/** Curated examples per top-level command (illustrative, not parity data). */
export const DOC_EXAMPLES: Record<string, readonly string[]> = {
  about: ["repotruck --about", "repotruck about"],
  sync: [
    "repotruck sync",
    "repotruck sync --scope all",
    "repotruck sync --pinned",
    "repotruck sync --profile backend",
    "repotruck sync --scope org:acme --limit 20",
    "repotruck sync -p language-first",
    "repotruck sync --depth 1 --blobless -c 5",
    "repotruck sync --stash --divergence rebase",
    "repotruck sync --watch 60",
    "repotruck sync resolve monalisa/api",
    "repotruck sync resolve monalisa/api --action continue",
  ],
  clone: [
    "repotruck clone monalisa/api",
    "repotruck clone https://github.com/monalisa/api -p flat-by-owner",
    "repotruck clone monalisa/api --depth 1 --blobless",
    "repotruck clone monalisa/api --sparse packages/core packages/utils",
  ],
  discover: [
    "repotruck discover mcp --lang typescript --min-stars 50",
    "repotruck discover cli --org acme --topic devtools --clone",
    "repotruck discover router --include-forks --limit 10 --json",
  ],
  forget: ["repotruck forget monalisa/api"],
  prune: ["repotruck prune --dry-run", "repotruck prune"],
  delete: ["repotruck delete monalisa/api --yes"],
  trash: [
    "repotruck trash list",
    "repotruck trash restore monalisa/api",
    "repotruck trash empty --older-than 30 --yes",
    "repotruck trash empty --yes",
  ],
  archive: ["repotruck archive monalisa/old-project"],
  status: [
    "repotruck status",
    "repotruck status -D",
    "repotruck status --pinned --remote",
    "repotruck status --profile backend",
    "repotruck status --filter dirty",
    "repotruck status --check",
    "repotruck status --json",
  ],
  create: [
    'repotruck create my-app --description "side project"',
    "repotruck create cli-tool --from ./cli-tool --at tools/cli",
    "repotruck create shared-lib --org acme --public",
  ],
  move: ["repotruck move monalisa/api active/api"],
  scan: [
    "repotruck scan",
    "repotruck scan ~/code",
    "repotruck scan --move --dry-run",
    "repotruck scan --move",
    "repotruck scan --json",
  ],
  reorganize: [
    "repotruck reorganize language-first",
    "repotruck reorganize category-first --dry-run",
    "repotruck reorganize flat-by-owner --scan --keep-custom",
  ],
  preset: [
    "repotruck preset list",
    "repotruck preset add lang-owner language owner name",
    "repotruck preset remove lang-owner",
  ],
  profile: [
    "repotruck profile list",
    "repotruck profile pin monalisa/api monalisa/web",
    "repotruck profile unpin monalisa/web",
    "repotruck profile save backend --from-pinned",
    "repotruck profile save core monalisa/api acme/sdk",
    "repotruck profile delete core",
  ],
  workspaces: [
    "repotruck workspaces",
    "repotruck workspaces add ~/code/team",
    "repotruck workspaces remove ../old-workspace",
  ],
  backup: ["repotruck backup list", "repotruck backup restore 20261024T120000.json --yes"],
  root: ["repotruck root", "repotruck root ~/code", "repotruck root --reset"],
  alias: [
    "repotruck alias set api monalisa/api",
    "repotruck alias list",
    "repotruck alias remove api",
  ],
  open: ["repotruck open api claude", "repotruck open monalisa/api vscode", "repotruck open api"],
  worktree: [
    "repotruck worktree list monalisa/api",
    "repotruck worktree scan",
    "repotruck worktree create monalisa/api feat-branch",
    "repotruck worktree create monalisa/api feat-branch ./trees/feat -b",
    "repotruck worktree remove monalisa/api ./trees/feat --force",
  ],
  "search-code": [
    "repotruck search-code UserService",
    "repotruck search-code handleAuth --kind function",
    "repotruck search-code 'TODO:' --text",
    "repotruck search-code 'useEffect\\\\(' --regex",
  ],
  run: [
    "repotruck run git status -s",
    "repotruck run --pinned bun test",
    "repotruck run --profile backend npm run lint",
    "repotruck run -r monalisa/api -r acme/cli npm test",
  ],
  instructions: [
    "repotruck instructions template",
    "repotruck instructions template monorepo",
    "repotruck instructions template --clear",
    "repotruck instructions export --format cursor",
    "repotruck instructions export --format claude --out CLAUDE.md",
  ],
  changelog: [
    "repotruck changelog",
    "repotruck changelog --since '14 days ago'",
    "repotruck changelog --author monalisa --format json",
    "repotruck changelog --repo monalisa/api -o CHANGELOG.md",
  ],
  auth: ["repotruck auth status", "repotruck auth login", "repotruck auth logout"],
  doctor: ["repotruck doctor", "repotruck doctor --fix"],
  stats: ["repotruck stats", "repotruck stats --json"],
  completions: [
    "repotruck completions bash",
    "repotruck completions zsh",
    "repotruck completions fish",
    "repotruck completions powershell",
  ],
  config: [
    "repotruck config list",
    "repotruck config get sync.concurrency",
    "repotruck config set sync.depth 1",
    "repotruck config unset sync.depth",
  ],
  update: ["repotruck update", "repotruck update --json"],
  mcp: ["repotruck mcp", "repotruck mcp --http", "repotruck mcp --http --port 8923"],
};

export interface GenFlag {
  flag: string;
  description: string;
}

export interface GenCommand {
  name: string;
  summary: string;
  usage: string;
  examples: readonly string[];
  flags?: readonly GenFlag[];
}

export interface GenGroup {
  id: string;
  title: string;
  blurb: string;
  commands: readonly GenCommand[];
}

export function formatFlagDoc(flag: FlagSpec, command?: string): string {
  const name = flag.short !== undefined ? `${flag.short}, ${flag.flag}` : flag.flag;
  if (flag.type === "bool") return name;
  const placeholder =
    (command !== undefined ? ARG_OVERRIDES[`${command}:${flag.flag}`] : undefined) ??
    ARG_OVERRIDES[flag.flag] ??
    flag.flag.replace(/^--/, "");
  if (placeholder.startsWith("[")) return `${name} ${placeholder}`;
  return `${name} <${placeholder}>`;
}

export function flagDescription(flag: FlagSpec): string {
  let description = flag.summary;
  if (flag.values !== undefined && flag.values.length > 0 && !description.includes("choices:")) {
    description += ` (choices: ${flag.values.join(", ")})`;
  }
  if (
    flag.default !== undefined &&
    flag.default !== "" &&
    flag.type !== "bool" &&
    !description.toLowerCase().includes("default")
  ) {
    description += ` (default: ${flag.default})`;
  }
  return description;
}

export function usageOf(spec: CommandSpec, hasFlags: boolean): string {
  let usage = `repotruck ${spec.path}`;
  for (const arg of spec.args) {
    const name = VARIADIC_ARGS.has(arg.name) ? `${arg.name}...` : arg.name;
    usage += arg.required ? ` <${name}>` : ` [${name}]`;
  }
  if (hasFlags) usage += " [options]";
  return usage;
}

export function buildCommandGroupsData(): {
  commandGroups: readonly GenGroup[];
  globalFlags: readonly GenFlag[];
} {
  // Group registry entries by their top-level command token, preserving
  // registry order; parent entries (path without spaces) carry the summary.
  const byTop = new Map<string, CommandSpec[]>();
  for (const spec of REGISTRY) {
    if (spec.id === "__globals__") continue;
    const top = spec.path.split(" ")[0]!;
    const list = byTop.get(top) ?? [];
    list.push(spec);
    byTop.set(top, list);
  }

  const commandGroups: GenGroup[] = [];
  for (const meta of DOC_GROUP_ORDER) {
    const commands: GenCommand[] = [];
    for (const [top, entries] of byTop) {
      if (entries[0]?.group !== meta.registry) continue;
      const parent = entries.find((spec) => !spec.path.includes(" ")) ?? entries[0]!;
      const subs = entries.filter((spec) => spec.path.includes(" "));
      const flags: GenFlag[] = [];
      const seen = new Set<string>();
      for (const spec of [parent, ...subs]) {
        for (const flag of spec.flags) {
          if (seen.has(flag.flag)) continue;
          seen.add(flag.flag);
          flags.push({ flag: formatFlagDoc(flag, top), description: flagDescription(flag) });
        }
      }
      const usageParts = [
        usageOf(parent, flags.length > 0),
        ...subs.map((sub) => usageOf(sub, sub.flags.length > 0)),
      ];
      commands.push({
        name: top,
        summary: parent.summary,
        usage: usageParts.join(" | "),
        examples: DOC_EXAMPLES[top] ?? [],
        ...(flags.length > 0 ? { flags } : {}),
      });
    }
    if (commands.length > 0) {
      commandGroups.push({ id: meta.id, title: meta.title, blurb: meta.blurb, commands });
    }
  }

  const globalFlags = (REGISTRY.find((spec) => spec.id === "__globals__")?.flags ?? []).map(
    (flag): GenFlag => ({ flag: formatFlagDoc(flag), description: flagDescription(flag) }),
  );

  return { commandGroups, globalFlags };
}

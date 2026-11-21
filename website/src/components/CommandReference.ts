/**
 * Command reference data for the documentation site.
 *
 * COMMAND_GROUPS and GLOBAL_FLAGS are GENERATED from the parity registry
 * (src/commands/registry.ts) — regenerate with `bun run docs:gen`; drift
 * fails `bun run docs:check` in CI. The interfaces live beside the data.
 *
 * SETTING_ROWS and DIVERGENCE_ROWS remain hand-curated here: they document
 * settings semantics rather than the command surface.
 */

export type { CommandDoc, CommandGroup } from "./commandGroups.generated.ts";
export { COMMAND_GROUPS, GLOBAL_FLAGS } from "./commandGroups.generated.ts";

export interface SettingRow {
  readonly key: string;
  readonly value: string;
  readonly description: string;
}

export const SETTING_ROWS: readonly SettingRow[] = [
  {
    key: "defaultRoot",
    value: "(not set)",
    description: "workspace root used when no explicit path is provided",
  },
  {
    key: "github.baseUrl",
    value: "(api.github.com)",
    description: "custom GitHub Enterprise base URL",
  },
  {
    key: "theme",
    value: "default",
    description: "dashboard palette: default, light or contrast (REPOTRUCK_THEME overrides)",
  },
  {
    key: "sync.concurrency",
    value: "3",
    description: "how many repositories sync updates in parallel",
  },
  {
    key: "sync.depth",
    value: "(off)",
    description: "commit depth for shallow clones of new repositories",
  },
  {
    key: "sync.blobless",
    value: "false",
    description: "create blobless partial clones (--filter=blob:none)",
  },
  {
    key: "sync.stash",
    value: "false",
    description: "stash uncommitted changes before updating, restore afterwards",
  },
  {
    key: "sync.divergence",
    value: "fail",
    description: "strategy for repositories ahead of origin: fail, rebase, reset or skip",
  },
];

export const DIVERGENCE_ROWS: readonly { readonly strategy: string; readonly behavior: string }[] =
  [
    { strategy: "fail", behavior: "stop that repository with an error (default; sync exits 1)" },
    { strategy: "rebase", behavior: "rebase local commits on top of the fetched upstream" },
    { strategy: "reset", behavior: "discard local commits and hard-reset to upstream" },
    { strategy: "skip", behavior: "leave that repository untouched this run" },
  ];

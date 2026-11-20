import type { ViewId } from "../components/store/types.ts";

/**
 * Single source of truth for CLI/TUI parity: every CLI command, subcommand
 * and flag carries its planned TUI surface here. The command palette, nav
 * rail links, context menu and the parity test all render from this data —
 * a CLI flag without a registry entry fails `tests/parity.test.ts`.
 *
 * Inventory mirrors `src/cli/commands/*` (see docs: website CommandReference).
 */

export type FlagType =
  | "bool"
  | "enum"
  | "int"
  | "optional-int"
  | "string"
  | "path"
  | "url"
  | "list";

/** Candidate sources shared with the hidden `__complete` CLI helper. */
export type CompleteSource =
  | "presets"
  | "apps"
  | "aliases"
  | "scopes"
  | "kinds"
  | "langs"
  | "divergence";

export type TuiBinding =
  | { kind: "view"; view: ViewId }
  | { kind: "modal"; modal: string }
  | { kind: "action"; action: string }
  | { kind: "planned"; ticket: string };

export interface FlagSpec {
  /** Long form without placeholder, e.g. "--scope". */
  readonly flag: string;
  readonly short?: string;
  readonly type: FlagType;
  readonly values?: readonly string[];
  readonly default?: string;
  readonly complete?: CompleteSource;
  readonly summary: string;
  /** Short description of the TUI control covering this flag. */
  readonly tui: string;
  /** CLI-only semantics adapted to a TUI equivalent (see plan principle 4). */
  readonly adapted?: boolean;
}

export interface ArgSpec {
  readonly name: string;
  readonly required: boolean;
  readonly summary: string;
}

export interface CommandSpec {
  /** Stable id, subcommands dot-separated: "sync", "sync.resolve". */
  readonly id: string;
  /** CLI spelling: "sync", "sync resolve", "trash empty". */
  readonly path: string;
  readonly title: string;
  readonly group: CommandGroup;
  readonly summary: string;
  readonly args: readonly ArgSpec[];
  readonly flags: readonly FlagSpec[];
  readonly surface: TuiBinding;
  readonly requires: readonly ("workspace" | "auth" | "selection")[];
}

export type CommandGroup =
  | "Sync"
  | "Lifecycle"
  | "Workspace"
  | "Search"
  | "Platform"
  | "Settings"
  | "Global";

export const f = (
  flag: string,
  type: FlagType,
  summary: string,
  tui: string,
  extra: Partial<FlagSpec> = {},
): FlagSpec => ({ flag, type, summary, tui, ...extra });

export const jsonFlag = (tui: string): FlagSpec =>
  f("--json", "bool", "machine-readable JSON output", tui, { adapted: true });

/**
 * Single source of truth for CLI/TUI parity: every CLI command, subcommand
 * and flag carries its planned TUI surface here. The command palette, nav
 * rail links, context menu and the parity test all render from this data —
 * a CLI flag without a registry entry fails `tests/parity.test.ts`.
 *
 * Inventory mirrors `src/cli/commands/*` (see docs: website CommandReference).
 * Section data lives in `registryData/` (size budget); types and helpers in
 * `registryTypes.ts`.
 */

export type {
  ArgSpec,
  CommandGroup,
  CommandSpec,
  CompleteSource,
  FlagSpec,
  FlagType,
  TuiBinding,
} from "./registryTypes.ts";

import { GLOBAL_COMMANDS } from "./registryData/globals.ts";
import { HUB_COMMANDS } from "./registryData/hubs.ts";
import { LIFECYCLE_COMMANDS } from "./registryData/lifecycle.ts";
import { PLATFORM_COMMANDS } from "./registryData/platform.ts";
import { SEARCH_COMMANDS } from "./registryData/search.ts";
import { SETTINGS_COMMANDS } from "./registryData/settings.ts";
import { SYNC_COMMANDS } from "./registryData/sync.ts";
import { WORKSPACE_COMMANDS } from "./registryData/workspace.ts";
import type { CommandSpec } from "./registryTypes.ts";

export const REGISTRY: readonly CommandSpec[] = [
  ...SYNC_COMMANDS,
  ...LIFECYCLE_COMMANDS,
  ...WORKSPACE_COMMANDS,
  ...SEARCH_COMMANDS,
  ...PLATFORM_COMMANDS,
  ...SETTINGS_COMMANDS,
  ...HUB_COMMANDS,
  ...GLOBAL_COMMANDS,
];

export const REGISTRY_BY_ID: ReadonlyMap<string, CommandSpec> = new Map(
  REGISTRY.map((spec) => [spec.id, spec]),
);

export const REGISTRY_BY_PATH: ReadonlyMap<string, CommandSpec> = new Map(
  REGISTRY.map((spec) => [spec.path, spec]),
);

export function registryFlagCount(): number {
  return REGISTRY.reduce((total, spec) => total + spec.flags.length, 0);
}

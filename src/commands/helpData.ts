import { VIEW_SPECS } from "../components/views/viewRegistry.ts";
import { REGISTRY } from "./registry.ts";

export type HelpRow = readonly [string, string];

/**
 * Help content generated from the registries so new pages and command
 * surfaces appear in the `?` screen without manual edits. Keybinding rows
 * stay hand-written in HelpModal (they mirror Dashboard's useKeyboard).
 */
export function buildViewHelpRows(): HelpRow[] {
  const groups = new Map<string, HelpRow[]>();
  for (const spec of VIEW_SPECS) {
    if (spec.id === "cockpit") continue;
    const rows = groups.get(spec.group) ?? [];
    rows.push([`v ${spec.go}`, `${spec.title} — ${spec.summary}`]);
    groups.set(spec.group, rows);
  }
  const rows: HelpRow[] = [["— Views —", ""]];
  for (const group of [...groups.keys()]) {
    rows.push([`· ${group.toLowerCase()}`, ""]);
    rows.push(...(groups.get(group) ?? []));
  }
  return rows;
}

/** One-line parity dashboard shown at the bottom of the help screen. */
export function buildRegistrySummaryLine(): string {
  const commands = REGISTRY.filter((spec) => spec.id !== "__globals__").length;
  const flags = REGISTRY.reduce((total, spec) => total + spec.flags.length, 0);
  return `${commands} CLI commands · ${flags} flags mapped to TUI surfaces (parity test enforces)`;
}

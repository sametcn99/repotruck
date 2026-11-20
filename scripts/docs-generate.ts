/**
 * Website docs generation: builds the command/flag and shortcut tables for
 * the documentation site from the single sources of truth —
 *
 *   src/commands/registry.ts      → COMMAND_GROUPS + GLOBAL_FLAGS
 *   src/commands/registryDocs.ts  → shared docs builder (also feeds AGENTS.md)
 *   src/commands/helpData.ts      → SHORTCUT_ROWS
 *
 * `scripts/gen-docs.ts` writes the generated modules; `scripts/docs-check.ts`
 * regenerates them and fails when the checked-in copies drift, so the chain
 * CLI → registry → website stays enforced end to end.
 */
import { execFile as execFileCallback } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { buildViewHelpRows, KEYBINDING_ROWS } from "../src/commands/helpData.ts";
import { buildCommandGroupsData } from "../src/commands/registryDocs.ts";

const execFile = promisify(execFileCallback);

export interface GeneratedFile {
  /** Path relative to the repo root. */
  path: string;
  /** Final (biome-formatted) file content. */
  content: string;
}

export function buildShortcutsData(): readonly { key: string; action: string }[] {
  return [...KEYBINDING_ROWS, ...buildViewHelpRows()]
    .filter((row) => row[1] !== "")
    .map(([key, action]) => ({ key, action }));
}

// ---- module rendering -----------------------------------------------------------

const HEADER = (source: string): string =>
  `// AUTO-GENERATED from ${source} — do not edit by hand.\n// Regenerate with: bun run docs:gen   (drift fails CI via: bun run docs:check)\n\n`;

export function renderCommandGroupsModule(): string {
  const { commandGroups, globalFlags } = buildCommandGroupsData();
  return (
    HEADER("src/commands/registry.ts") +
    "export interface CommandDoc {\n" +
    "  readonly name: string;\n" +
    "  readonly summary: string;\n" +
    "  readonly usage: string;\n" +
    "  readonly examples: readonly string[];\n" +
    "  readonly flags?: readonly { readonly flag: string; readonly description: string }[];\n" +
    "}\n\n" +
    "export interface CommandGroup {\n" +
    "  readonly id: string;\n" +
    "  readonly title: string;\n" +
    "  readonly blurb: string;\n" +
    "  readonly commands: readonly CommandDoc[];\n" +
    "}\n\n" +
    `export const COMMAND_GROUPS: readonly CommandGroup[] = ${JSON.stringify(commandGroups, null, 2)};\n\n` +
    `export const GLOBAL_FLAGS: readonly { flag: string; description: string }[] = ${JSON.stringify(globalFlags, null, 2)};\n`
  );
}

export function renderShortcutsModule(): string {
  return (
    HEADER("src/commands/helpData.ts") +
    "export interface ShortcutRow {\n" +
    "  key: string;\n" +
    "  action: string;\n" +
    "}\n\n" +
    `export const SHORTCUT_ROWS: readonly ShortcutRow[] = ${JSON.stringify(buildShortcutsData(), null, 2)};\n`
  );
}

// ---- formatting pipeline -----------------------------------------------------------

function repoRoot(): string {
  return path.join(import.meta.dir, "..");
}

/**
 * Render → format with the repo's biome config (via a temp sibling file so
 * config resolution works) → return the final content. The target file is
 * never touched; gen-docs writes and docs-check compares. Throws when the
 * formatter fails so generation can never silently diverge.
 */
export async function formattedContent(relativePath: string, raw: string): Promise<string> {
  const target = path.join(repoRoot(), relativePath);
  const tmp = path.join(path.dirname(target), `.tmp-${path.basename(target)}`);
  writeFileSync(tmp, raw);
  // The .bin shim needs node; run it through bun instead (bun runs the JS
  // launcher fine and resolves the local install without network).
  try {
    await execFile("bun", ["x", "biome", "format", "--write", tmp]);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw new Error(
      `biome format failed for ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const content = readFileSync(tmp, "utf8");
  rmSync(tmp, { force: true });
  return content;
}

export async function generateWebsiteFiles(): Promise<readonly GeneratedFile[]> {
  return [
    {
      path: "website/src/components/commandGroups.generated.ts",
      content: await formattedContent(
        "website/src/components/commandGroups.generated.ts",
        renderCommandGroupsModule(),
      ),
    },
    {
      path: "website/src/components/shortcuts.generated.ts",
      content: await formattedContent(
        "website/src/components/shortcuts.generated.ts",
        renderShortcutsModule(),
      ),
    },
  ];
}

// Re-exported for scripts that compose the builders.
export type { GenFlag } from "../src/commands/registryDocs.ts";

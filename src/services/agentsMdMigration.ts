/**
 * Lazy AGENTS.md guide migration.
 *
 * `repotruck update` swaps the binary, but the running process still executes
 * the old code — so guides refresh on the next launch instead: every CLI/TUI
 * start checks each registered workspace's AGENTS.md guide marker and
 * regenerates files written by an older repotruck. Custom instructions and
 * template blocks are preserved by the regular rewrite path
 * (writeAgentsMd/extractCustomInstructions).
 *
 * Best effort by design: a failing workspace never blocks the others, and the
 * whole migration never blocks startup.
 */
import { existsSync } from "node:fs";
import { GUIDE_VERSION, parseGuideVersion } from "./agentsMdGuide.ts";
import type { EnvLike } from "./config.ts";
import { readAgentsMd } from "./config.ts";
import { updateWorkspace } from "./workspace.ts";
import type { WorkspaceEntry } from "./workspaceRegistry.ts";
import { readWorkspaceEntries } from "./workspaceRegistry.ts";

export interface GuideMigrationResult {
  /** Workspaces whose AGENTS.md was rewritten to the current guide. */
  migrated: number;
  /** Workspaces that failed to migrate (already diagnosed quietly). */
  failed: number;
}

export async function migrateAgentsMdGuides(env?: EnvLike): Promise<GuideMigrationResult> {
  let entries: readonly WorkspaceEntry[];
  try {
    entries = await readWorkspaceEntries(env);
  } catch {
    return { migrated: 0, failed: 0 };
  }
  let migrated = 0;
  let failed = 0;
  for (const entry of entries) {
    try {
      // Never resurrect a workspace directory the user deleted.
      if (!existsSync(entry.root)) continue;
      const existing = await readAgentsMd(entry.root);
      if (existing !== null && parseGuideVersion(existing) >= GUIDE_VERSION) continue;
      // Regenerate under the workspace lock; writeAgentsMd preserves the
      // custom instructions and template blocks from the existing file.
      await updateWorkspace(entry.root, (current) => ({ config: current, result: undefined }), env);
      migrated += 1;
    } catch {
      failed += 1;
    }
  }
  return { migrated, failed };
}

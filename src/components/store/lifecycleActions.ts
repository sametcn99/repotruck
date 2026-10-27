import path from "node:path";
import { toggleWorkspacePin } from "../../core/profiles.ts";
import { writeWorkspaceSnapshot } from "../../services/backups.ts";
import { firstErrorLine } from "../../services/cloner.ts";
import { buildCodeIndex } from "../../services/codeSearch.ts";
import type { RepotruckConfig } from "../../services/config.ts";
import { fixDoctor } from "../../services/doctor.ts";
import { resolveRepoRef } from "../../services/launcher.ts";
import type {
  archiveRepository,
  deleteRepository,
  forgetRepository,
  LifecycleGithub,
} from "../../services/lifecycle.ts";
import type { RunInReposOptions, RunInReposResult } from "../../services/runner.ts";
import {
  adoptUnregisteredRepos,
  buildAdoptPlan,
  scanWorkspaceRepos,
} from "../../services/scanner.ts";
import { readCustomPresets } from "../../services/settings.ts";
import { formatDiskSize } from "../../services/stats.ts";
import { emptyTrash } from "../../services/trash.ts";
import { loadWorkspace, updateWorkspace } from "../../services/workspace.ts";
import type {
  DeletedUndoItem,
  GithubClient,
  StatusPhase,
  UndoAction,
  WorkspaceMaintenanceKind,
} from "./types.ts";

export interface ActionFeedback {
  pushStatus: (phase: StatusPhase, key: string, message?: string) => void;
  pushUndo: (action: UndoAction) => void;
}

/**
 * Splits a user-entered command line into argv tokens while preserving single-
 * and double-quoted arguments (e.g. `git commit -m "chore: sync"`).
 */
export function tokenizeCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quote !== null) {
      if (ch === "\\" && quote === '"' && i + 1 < input.length && input[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      hasContent = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasContent = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasContent) {
        tokens.push(current);
        current = "";
        hasContent = false;
      }
      continue;
    }
    current += ch;
    hasContent = true;
  }
  if (hasContent) tokens.push(current);
  return tokens;
}

export async function performUndoAction(
  root: string,
  action: UndoAction,
  moveDirImpl: (src: string, dest: string) => void,
  pushStatus: (phase: StatusPhase, key: string, message?: string) => void,
): Promise<RepotruckConfig> {
  if (action.type === "move") {
    const fromAbs = path.join(root, ...action.to.split("/"));
    const backAbs = path.join(root, ...action.from.split("/"));
    moveDirImpl(fromAbs, backAbs);
    await updateWorkspace(root, (currentConfig) => {
      const index = currentConfig.repos.findIndex((r) => `${r.owner}/${r.name}` === action.key);
      if (index < 0) return { config: currentConfig, result: undefined };
      const repos = currentConfig.repos.map((r, i) =>
        i === index ? { ...r, relativePath: action.from } : r,
      );
      return { config: { ...currentConfig, repos }, result: undefined };
    });
    pushStatus("DONE", "[undo]", `moved ${action.key} back to ${action.from}`);
  } else {
    const items: readonly DeletedUndoItem[] = action.batch ?? [
      { key: action.key, relativePath: action.relativePath, trashPath: action.trashPath },
    ];
    for (const item of items) {
      const backAbs = path.join(root, ...item.relativePath.split("/"));
      moveDirImpl(item.trashPath, backAbs);
    }
    await updateWorkspace(root, (currentConfig) => {
      let repos = [...currentConfig.repos];
      for (const item of items) {
        const restored = action.config.repos.find((r) => `${r.owner}/${r.name}` === item.key);
        if (!restored) continue;
        repos = repos.filter((r) => `${r.owner}/${r.name}` !== item.key);
        repos.push(restored);
      }
      return { config: { ...currentConfig, repos }, result: undefined };
    });
    pushStatus(
      "DONE",
      "[undo]",
      items.length > 1
        ? `restored ${items.length} repositories from trash`
        : `restored ${action.key} from trash to ${action.relativePath}`,
    );
  }
  return await loadWorkspace(root);
}

export async function performDeleteRepos(
  root: string,
  keys: readonly string[],
  deleteRepoFn: typeof deleteRepository,
  fb: ActionFeedback,
): Promise<boolean> {
  const initialConfig = await loadWorkspace(root);
  const deletedItems: DeletedUndoItem[] = [];
  let allOk = true;

  for (const key of keys) {
    const config = await loadWorkspace(root);
    const match = resolveRepoRef(config, key);
    const result = await deleteRepoFn(root, config, key, { yes: true, trash: true });
    if (result.ok) {
      if (match !== null && result.trashPath !== undefined) {
        deletedItems.push({
          key,
          relativePath: match.entry.relativePath,
          trashPath: result.trashPath,
        });
      }
      fb.pushStatus("DONE", "[tui]", result.message);
    } else {
      allOk = false;
      fb.pushStatus("FAILED", "[tui]", result.message);
    }
  }

  if (deletedItems.length === 1) {
    const first = deletedItems[0]!;
    fb.pushUndo({
      type: "delete",
      key: first.key,
      relativePath: first.relativePath,
      trashPath: first.trashPath,
      config: initialConfig,
    });
  } else if (deletedItems.length > 1) {
    const first = deletedItems[0]!;
    fb.pushUndo({
      type: "delete",
      key: first.key,
      relativePath: first.relativePath,
      trashPath: first.trashPath,
      config: initialConfig,
      batch: deletedItems,
    });
  }

  return allOk;
}

export async function performUntrackRepos(
  root: string,
  keys: readonly string[],
  forgetFn: typeof forgetRepository,
  pushStatus: (phase: StatusPhase, key: string, message?: string) => void,
): Promise<void> {
  for (const key of keys) {
    const config = await loadWorkspace(root);
    const result = await forgetFn(root, config, key);
    pushStatus(result.ok ? "DONE" : "FAILED", "[tui]", result.message);
  }
}

export async function performArchiveRepos(
  root: string,
  keys: readonly string[],
  github: GithubClient | null,
  archiveFn: typeof archiveRepository,
  pushStatus: (phase: StatusPhase, key: string, message?: string) => void,
): Promise<boolean> {
  if (github === null || typeof github.archiveRepo !== "function") {
    pushStatus("FAILED", "[archive]", "GitHub client unavailable in offline mode");
    return false;
  }
  const ghAdapter: LifecycleGithub = {
    getRepo: (owner, name) => github.getRepo(owner, name),
    archiveRepo: (owner, name) => github.archiveRepo!(owner, name),
  };
  let allOk = true;
  for (const key of keys) {
    const config = await loadWorkspace(root);
    const result = await archiveFn(root, config, key, ghAdapter);
    pushStatus(result.ok ? "DONE" : "FAILED", "[archive]", result.message);
    if (!result.ok) allOk = false;
  }
  return allOk;
}

export async function performTogglePin(
  root: string,
  keys: readonly string[],
  pushStatus: (phase: StatusPhase, key: string, message?: string) => void,
): Promise<void> {
  for (const key of keys) {
    const res = await toggleWorkspacePin(root, key);
    pushStatus(res.ok ? "DONE" : "FAILED", "[pin]", res.message);
  }
}

export async function performDoctorFixAction(
  pushStatus: (phase: StatusPhase, key: string, message?: string) => void,
): Promise<void> {
  try {
    const res = await fixDoctor({
      onFixProgress: (msg) => pushStatus("PULLING", "[doctor]", msg),
    });
    pushStatus(
      res.ok ? "DONE" : "FAILED",
      "[doctor]",
      res.ok ? "all doctor checks clean" : "some doctor checks still failing",
    );
  } catch (error) {
    pushStatus("FAILED", "[doctor]", firstErrorLine(error));
  }
}

export async function performWorkspaceMaintenanceAction(
  root: string,
  kind: WorkspaceMaintenanceKind,
  pushStatus: (phase: StatusPhase, key: string, message?: string) => void,
): Promise<void> {
  try {
    if (kind === "scan") {
      const config = await loadWorkspace(root);
      const customPresets = await readCustomPresets(process.env);
      const scan = await scanWorkspaceRepos(root, config);
      if (scan.unregistered.length === 0) {
        pushStatus("DONE", "[scan]", `0 untracked repos (${scan.tracked.length} already tracked)`);
        return;
      }
      const plans = buildAdoptPlan(root, config, scan.unregistered, customPresets);
      const adopted = await adoptUnregisteredRepos(root, config, plans);
      pushStatus(
        adopted.errors.length === 0 ? "DONE" : "FAILED",
        "[scan]",
        `adopted ${adopted.adopted.length} repo(s)${adopted.errors.length > 0 ? `, ${adopted.errors.length} failed` : ""}`,
      );
      return;
    }
    if (kind === "instructions") {
      const { result: count } = await updateWorkspace(root, (cfg) => ({
        config: cfg,
        result: cfg.repos.length,
      }));
      pushStatus("DONE", "[instructions]", `regenerated AGENTS.md (${count} tracked repos)`);
      return;
    }
    if (kind === "code-index") {
      const config = await loadWorkspace(root);
      const { stats } = await buildCodeIndex({ root, config, force: true, offline: true });
      pushStatus(
        "DONE",
        "[index]",
        `indexed ${stats.filesIndexed + stats.filesReused} files (${stats.symbols} symbols) in ${stats.durationMs}ms`,
      );
      return;
    }
    if (kind === "backup") {
      const config = await loadWorkspace(root);
      const savedPath = await writeWorkspaceSnapshot(root, config);
      pushStatus("DONE", "[backup]", `saved ${path.basename(savedPath)}`);
      return;
    }
    if (kind === "trash-empty") {
      const emptied = emptyTrash(root);
      pushStatus(
        "DONE",
        "[trash]",
        `removed ${emptied.removed.length} item(s) (${formatDiskSize(emptied.freedBytes)} freed)`,
      );
    }
  } catch (error) {
    pushStatus("FAILED", `[${kind}]`, firstErrorLine(error));
  }
}

export async function performBulkCommandRun(
  root: string,
  commandLine: string,
  selectedKeys: readonly string[],
  runFn: (options: RunInReposOptions) => Promise<RunInReposResult>,
  pushStatus: (phase: StatusPhase, key: string, message?: string) => void,
): Promise<void> {
  const parts = tokenizeCommandLine(commandLine.trim());
  if (parts.length === 0) return;
  const command = parts[0]!;
  const args = parts.slice(1);
  const config = await loadWorkspace(root);
  pushStatus(
    "PULLING",
    "[run]",
    `running '${commandLine.trim()}' across ${selectedKeys.length > 0 ? selectedKeys.length : config.repos.length} repo(s)`,
  );
  const outcome = await runFn({
    root,
    config,
    refs: selectedKeys,
    command,
    args,
  });
  for (const item of outcome.results) {
    const summaryLine =
      (item.stdout.trim() || item.stderr.trim() || item.message || `exit ${item.exitCode ?? 0}`)
        .split(/\r?\n/)[0]
        ?.slice(0, 120) ?? "";
    pushStatus(item.ok ? "DONE" : "FAILED", item.key, summaryLine);
  }
  for (const skip of outcome.skipped) {
    pushStatus("FAILED", skip.key, skip.message);
  }
}

import path from "node:path";
import { simpleGit } from "simple-git";
import { firstErrorLine } from "./cloner.ts";
import type { GitConflictState } from "./gitState.ts";
import { inspectGitConflictState } from "./gitState.ts";

export interface ConflictResolutionGuide {
  repoPath: string;
  state: GitConflictState;
  hasConflicts: boolean;
  statusDescription: string;
  conflictedFiles: string[];
  suggestedSteps: string[];
}

/**
 * Analyzes repository state and builds an actionable conflict resolution guide.
 */
export async function getConflictResolutionGuide(
  repoDir: string,
): Promise<ConflictResolutionGuide> {
  const resolved = path.resolve(repoDir);
  const git = simpleGit(resolved);
  const state = await inspectGitConflictState(git);
  const hasConflicts =
    state.conflictedFiles.length > 0 || state.inRebase || state.inMerge || state.inCherryPick;

  let statusDescription = "Working tree is clean. No sync or rebase conflict in progress.";
  const suggestedSteps: string[] = [];

  if (state.inRebase) {
    statusDescription = `Rebase in progress with ${state.conflictedFiles.length} conflicted file(s).`;
    suggestedSteps.push(
      "1. Open and edit the conflicted files to resolve git conflict markers (<<<<<<<, =======, >>>>>>>).",
    );
    for (const file of state.conflictedFiles) {
      suggestedSteps.push(`   - ${file}`);
    }
    suggestedSteps.push("2. Stage the resolved files using: git add <file>");
    suggestedSteps.push("3. Continue the rebase: git rebase --continue");
    suggestedSteps.push("4. Or to completely cancel the rebase: git rebase --abort");
  } else if (state.inMerge) {
    statusDescription = `Merge in progress with ${state.conflictedFiles.length} conflicted file(s).`;
    suggestedSteps.push("1. Open and edit the conflicted files to resolve git conflict markers.");
    for (const file of state.conflictedFiles) {
      suggestedSteps.push(`   - ${file}`);
    }
    suggestedSteps.push("2. Stage the resolved files using: git add <file>");
    suggestedSteps.push("3. Complete the merge: git commit");
    suggestedSteps.push("4. Or to cancel the merge: git merge --abort");
  } else if (state.inCherryPick) {
    statusDescription = `Cherry-pick in progress with ${state.conflictedFiles.length} conflicted file(s).`;
    suggestedSteps.push("1. Resolve conflicts and stage files: git add <file>");
    suggestedSteps.push(
      "2. Continue: git cherry-pick --continue (or cancel with: git cherry-pick --abort)",
    );
  } else if (state.conflictedFiles.length > 0) {
    statusDescription = `${state.conflictedFiles.length} unmerged/conflicted file(s) found in working tree.`;
    suggestedSteps.push("1. Edit files to remove conflict markers and stage: git add <file>");
  }

  return {
    repoPath: resolved,
    state,
    hasConflicts,
    statusDescription,
    conflictedFiles: state.conflictedFiles,
    suggestedSteps,
  };
}

/**
 * Executes a conflict action like continue, abort, or diff.
 */
export async function executeConflictAction(
  repoDir: string,
  action: "continue" | "abort",
): Promise<{ ok: boolean; message: string }> {
  const git = simpleGit(repoDir);
  const state = await inspectGitConflictState(git);
  try {
    if (state.inRebase) {
      const res = await git.raw(["rebase", `--${action}`]);
      return { ok: true, message: res.trim() || `git rebase --${action} succeeded` };
    }
    if (state.inMerge) {
      if (action === "abort") {
        await git.raw(["merge", "--abort"]);
        return { ok: true, message: "git merge --abort succeeded" };
      }
      const res = await git.raw(["commit", "--no-edit"]);
      return { ok: true, message: res.trim() || "merge commit completed" };
    }
    return { ok: false, message: `No active rebase or merge in progress to ${action}` };
  } catch (error) {
    return { ok: false, message: firstErrorLine(error) };
  }
}

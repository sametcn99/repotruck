import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { RepotruckConfig } from "./config.ts";
import { type DoctorResult, runDoctor } from "./doctor.ts";
import { workspaceTrashDir } from "./lifecycle.ts";
import { listTrashEntries } from "./trash.ts";

export interface HealthScoreResult {
  score: number;
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  summary: string;
  breakdown: {
    cleanliness: { score: number; max: 30; dirtyCount: number; cleanCount: number };
    synchronization: { score: number; max: 25; aheadCount: number; behindCount: number };
    focus: { score: number; max: 15; pinnedCount: number };
    hygiene: { score: number; max: 15; backupCount: number; trashCount: number };
    doctor: { score: number; max: 15; passed: number; total: number };
  };
  recommendations: string[];
}

export function calculateGrade(score: number): HealthScoreResult["grade"] {
  if (score >= 95) return "A+";
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

export async function computeWorkspaceHealthScore(
  root: string,
  config: RepotruckConfig,
  doctorResult?: DoctorResult,
  statsOverview?: { dirtyCount?: number; aheadCount?: number; behindCount?: number },
): Promise<HealthScoreResult> {
  const recommendations: string[] = [];
  const totalRepos = config.repos.length;

  // 1. Cleanliness (max 30)
  const dirtyCount = statsOverview?.dirtyCount ?? 0;
  const cleanCount = Math.max(0, totalRepos - dirtyCount);
  const cleanRatio = totalRepos > 0 ? cleanCount / totalRepos : 1;
  const cleanlinessScore = Math.round(cleanRatio * 30);
  if (dirtyCount > 0) {
    recommendations.push(
      `${dirtyCount} repository(ies) have uncommitted changes. Commit or stash them.`,
    );
  }

  // 2. Synchronization (max 25)
  const aheadCount = statsOverview?.aheadCount ?? 0;
  const behindCount = statsOverview?.behindCount ?? 0;
  const syncPenalty = totalRepos > 0 ? (behindCount / totalRepos) * 25 : 0;
  const syncScore = Math.max(0, Math.round(25 - syncPenalty));
  if (behindCount > 0) {
    recommendations.push(
      `${behindCount} repository(ies) are behind origin. Run 'repotruck sync' to update.`,
    );
  }
  if (aheadCount > 0) {
    recommendations.push(`${aheadCount} repository(ies) have unpushed commits.`);
  }

  // 3. Focus / Pinned (max 15)
  const pinnedCount = config.pinned?.length ?? 0;
  let focusScore = 15;
  if (totalRepos > 5 && pinnedCount === 0) {
    focusScore = 8;
    recommendations.push(
      "No repositories are pinned. Pin key projects to set Active Focus in AGENTS.md.",
    );
  }

  // 4. Hygiene & Backups (max 15)
  let backupCount = 0;
  const backupsDir = path.join(root, ".repotruck", "backups");
  if (existsSync(backupsDir)) {
    try {
      backupCount = readdirSync(backupsDir).filter((f) => f.endsWith(".json")).length;
    } catch {
      backupCount = 0;
    }
  }
  let trashCount = 0;
  const trashDir = workspaceTrashDir(root);
  if (existsSync(trashDir)) {
    try {
      trashCount = listTrashEntries(root).length;
    } catch {
      trashCount = 0;
    }
  }

  let hygieneScore = 15;
  if (backupCount === 0) {
    hygieneScore -= 5;
    recommendations.push(
      "No workspace backup snapshot found. Run 'repotruck backup save' to create one.",
    );
  }
  if (trashCount > 5) {
    hygieneScore -= 5;
    recommendations.push(
      `${trashCount} repositories accumulated in trash. Run 'repotruck trash empty' to free disk space.`,
    );
  }
  hygieneScore = Math.max(0, hygieneScore);

  // 5. Doctor checks (max 15)
  const doctor = doctorResult ?? (await runDoctor());
  const docPassed = doctor.checks.filter((c) => c.status === "ok").length;
  const docTotal = doctor.checks.length;
  const docRatio = docTotal > 0 ? docPassed / docTotal : 1;
  const doctorScore = Math.round(docRatio * 15);
  for (const c of doctor.checks) {
    if (c.status === "fail") {
      recommendations.push(`Doctor check failed [${c.check}]: ${c.detail}`);
    }
  }

  const totalScore = cleanlinessScore + syncScore + focusScore + hygieneScore + doctorScore;
  const grade = calculateGrade(totalScore);

  return {
    score: totalScore,
    grade,
    summary: `Workspace Health Score: ${totalScore}/100 (Grade: ${grade})`,
    breakdown: {
      cleanliness: { score: cleanlinessScore, max: 30, dirtyCount, cleanCount },
      synchronization: { score: syncScore, max: 25, aheadCount, behindCount },
      focus: { score: focusScore, max: 15, pinnedCount },
      hygiene: { score: hygieneScore, max: 15, backupCount, trashCount },
      doctor: { score: doctorScore, max: 15, passed: docPassed, total: docTotal },
    },
    recommendations,
  };
}

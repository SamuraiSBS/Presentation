import type { CandidateQualityReport } from "@studydeck/shared";

/** Enforces the plan's single automatic-repair ceiling at the orchestration boundary. */
export function mayRepairAiScene(report: CandidateQualityReport) {
  return !report.passed && report.repairAttempts < 1;
}

export function markAiSceneRepair(report: CandidateQualityReport): CandidateQualityReport {
  if (!mayRepairAiScene(report)) throw new Error("ai_scene_repair_limit_reached");
  return { ...report, repairAttempts: report.repairAttempts + 1 };
}

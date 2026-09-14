import type { CandidateQualityReportV3 } from "@studydeck/shared";

export type AiSceneV3CandidateSelection<T extends { id: string; variant: "A" | "B" | "C"; qualityReport: CandidateQualityReportV3 }> = {
  status: "auto_selected" | "needs_attention" | "generate_c";
  selectedCandidateId?: string;
  reason: string;
  alternatives: Array<{ id: string; variant: "A" | "B" | "C"; passed: boolean; weightedScore: number; diagnostics: string[] }>;
};

/** Selects only a passed candidate. A visually failed render is never labelled ready. */
export function selectAiSceneV3Candidate<T extends { id: string; variant: "A" | "B" | "C"; qualityReport: CandidateQualityReportV3 }>(candidates: readonly T[]): AiSceneV3CandidateSelection<T> {
  const initial = candidates.filter((candidate) => candidate.variant === "A" || candidate.variant === "B");
  if (initial.length !== 2 || new Set(initial.map((candidate) => candidate.variant)).size !== 2) throw new Error("ai_scene_v3_candidate_selection_requires_a_and_b");
  const alternatives = candidates.map((candidate) => ({ id: candidate.id, variant: candidate.variant, passed: candidate.qualityReport.passed, weightedScore: candidate.qualityReport.weightedScore, diagnostics: candidate.qualityReport.diagnostics }));
  const passed = initial.filter((candidate) => candidate.qualityReport.passed).sort((left, right) => right.qualityReport.weightedScore - left.qualityReport.weightedScore || left.id.localeCompare(right.id));
  if (passed.length) return { status: "auto_selected", selectedCandidateId: passed[0]!.id, reason: `highest passed weighted score: ${passed[0]!.qualityReport.weightedScore}`, alternatives };
  if (candidates.some((candidate) => candidate.variant === "C")) return { status: "needs_attention", reason: "A, B and C did not pass hard quality gates", alternatives };
  return { status: "generate_c", reason: "both A and B failed hard quality gates; a single diagnostic-guided C is required", alternatives };
}

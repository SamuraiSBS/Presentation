import type { CandidateQualityReportV3, CompositionPlanV3 } from "@studydeck/shared";

export type AiSceneV3RepairDecision = {
  variant: "C";
  mode: "image_edit" | "new_background";
  diagnostics: string[];
  backgroundMayBeReference: boolean;
};

/** A single, auditable C is allowed only after both A and B fail. */
export function decideAiSceneV3CandidateRepair(input: {
  a: { plan: CompositionPlanV3; qualityReport: CandidateQualityReportV3 };
  b: { plan: CompositionPlanV3; qualityReport: CandidateQualityReportV3 };
}): AiSceneV3RepairDecision {
  if (input.a.qualityReport.passed || input.b.qualityReport.passed) throw new Error("ai_scene_v3_repair_not_needed");
  const diagnostics = [...new Set([...input.a.qualityReport.diagnostics, ...input.b.qualityReport.diagnostics])];
  const localDefect = diagnostics.every((item) => /text|contrast|watermark|logo|brand|badge|crest|emblem|artifact|overflow|placement/i.test(item));
  return {
    variant: "C",
    mode: localDefect ? "image_edit" : "new_background",
    diagnostics,
    backgroundMayBeReference: localDefect,
  };
}

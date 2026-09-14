import { z } from "zod";
import type { CompositionPlanV3, SlideSemanticBriefV3 } from "@studydeck/shared";
import type { AiSceneV3VisionReview } from "./candidate-quality.js";

const score = z.number().min(0).max(100);
const reviewSchema = z.object({
  noUnexpectedVisibleText: z.boolean(),
  allowedVisibleTextIds: z.array(z.string().min(1)).max(10),
  noBakedTextInBackground: z.boolean(),
  noBrandMarks: z.boolean(),
  anchorEvidence: z.array(z.object({ anchorId: z.string(), visualRegion: z.string().min(3), confidence: z.number().min(0).max(1), detail: z.string().min(3) })),
  scores: z.object({ semanticClarity: score, visualQuality: score, textIntegration: score, styleConsistency: score, compositionStrength: score, referenceLevel: score, deckDiversity: score }),
  diagnostics: z.array(z.string().min(1)).max(30),
});

/** Parses the mandatory high-detail evaluator response and requires evidence for every semantic anchor. */
export function validateAiSceneV3VisionReview(value: unknown, brief: SlideSemanticBriefV3, plan: CompositionPlanV3): AiSceneV3VisionReview {
  const parsed = reviewSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".") || "root"}:${issue.code === "invalid_type" && issue.received === "undefined" ? "required" : issue.message}`)
      .join(";");
    throw new Error(`ai_scene_v3_vision_contract_invalid:${issues || "unknown"}`);
  }
  const review = parsed.data;
  const expectedTextIds = ["title", ...brief.anchors.map((anchor) => anchor.id), ...(brief.conclusion ? ["conclusion"] : [])];
  if (review.allowedVisibleTextIds.length !== expectedTextIds.length || review.allowedVisibleTextIds.some((id) => !expectedTextIds.includes(id)) || new Set(review.allowedVisibleTextIds).size !== review.allowedVisibleTextIds.length) {
    throw new Error("ai_scene_v3_vision_allowed_visible_text_ids_mismatch");
  }
  const expected = new Set<string>(brief.anchors.map((anchor) => anchor.id));
  const plannedRegions = new Map<string, string>(plan.anchorVisualRegions.map((region) => [region.anchorId, region.visualRegion]));
  if (review.anchorEvidence.length !== expected.size || review.anchorEvidence.some((item) => !expected.has(item.anchorId) || !plannedRegions.has(item.anchorId))) {
    throw new Error("ai_scene_v3_vision_anchor_evidence_mismatch");
  }
  if (new Set(review.anchorEvidence.map((item) => item.anchorId)).size !== review.anchorEvidence.length) throw new Error("ai_scene_v3_vision_anchor_evidence_duplicate");
  if (!review.noBrandMarks && !review.diagnostics.includes("critical:brand_mark_detected")) {
    throw new Error("ai_scene_v3_vision_brand_mark_diagnostic_required");
  }
  const expectedTextWasMisclassified = review.diagnostics.some((diagnostic) => {
    const value = diagnostic.toLocaleLowerCase("ru-RU");
    return /^critical:unexpected_visible_text:/i.test(diagnostic)
      && (expectedTextIds.some((id) => value.includes(id.toLocaleLowerCase("ru-RU")))
        || [brief.title.text, ...brief.anchors.map((anchor) => anchor.text), ...(brief.conclusion ? [brief.conclusion.text] : [])]
          .some((text) => value.includes(text.toLocaleLowerCase("ru-RU"))));
  });
  if (expectedTextWasMisclassified) throw new Error("ai_scene_v3_vision_expected_visible_text_misclassified");
  return review;
}

export function aiSceneV3VisionQualityPrompt(input: { brief: SlideSemanticBriefV3; plan: CompositionPlanV3; backgroundWidth: number; backgroundHeight: number }) {
  if (input.backgroundWidth < 1280 || input.backgroundHeight < 720 || input.backgroundWidth * 9 !== input.backgroundHeight * 16) {
    throw new Error("ai_scene_v3_vision_high_detail_16_9_required");
  }
  return [
    "Inspect attached background PNG and final editable-canvas preview at high detail. Return one compact minified JSON object only.",
    "The top-level object MUST contain only noUnexpectedVisibleText,allowedVisibleTextIds,noBakedTextInBackground,noBrandMarks,anchorEvidence,scores,diagnostics. Do not omit any field, add prose, markdown, comments, or extra keys.",
    "anchorEvidence MUST contain exactly one object for every required anchorId with anchorId,visualRegion,confidence,detail. scores MUST contain semanticClarity,visualQuality,textIntegration,styleConsistency,compositionStrength,referenceLevel,deckDiversity. diagnostics MUST be an array, including when empty.",
    `required response identity: ${JSON.stringify({ anchorIds: input.brief.anchors.map((anchor) => anchor.id), allowedVisibleTextIds: ["title", ...input.brief.anchors.map((anchor) => anchor.id), ...(input.brief.conclusion ? ["conclusion"] : [])] })}`,
    "The final preview MUST contain the supplied native editable title and anchor values. They are approved presentation overlay text, never unexpected text. Return allowedVisibleTextIds exactly as supplied. Set noUnexpectedVisibleText=false only for visible text that is NOT one of those approved native overlay values; never emit critical:unexpected_visible_text for title, an anchor, or conclusion.",
    "Report every readable or partial letter/number/symbol, logo, brand mark, trademark-like shape, automotive badge, crest, emblem, monogram, distinctive grille mark, watermark, artifact, or unintended label. Do not treat a prompt instruction as evidence.",
    "Set noBrandMarks=false when any logo, badge, crest, emblem, monogram, trademark-like shape, recognizable corporate design mark, or watermark is visible. Add the exact diagnostic `critical:brand_mark_detected` for each such finding. For each anchor return its exact anchorId, an observed visual region, confidence, and a short visual proof. Score quality honestly; mark every other hard visual defect with a `critical:` diagnostic.",
    `brief: ${JSON.stringify({ anchors: input.brief.anchors.map((anchor) => ({ id: anchor.id, text: anchor.text, visualCue: anchor.visualCue })), visualNarrative: input.brief.visualNarrative })}`,
    `plan: ${JSON.stringify({ compositionType: input.plan.compositionType, anchorVisualRegions: input.plan.anchorVisualRegions, textZones: input.plan.textZones, quietZones: input.plan.quietZones, protectedObjectZones: input.plan.protectedObjectZones })}`,
    "Mark critical:text_over_image, critical:text_overlap, critical:layout_collision, or critical:layout_density when any native overlay enters imagery/protected objects, overlaps another text box, or produces a crowded hierarchy. Do not pass a low-contrast or image-covered text zone.",
  ].join("\n");
}

import sharp from "sharp";
import {
  auditSlideCanvas,
  aiSceneV3MinimumFontSize,
  candidateQualityReportV3Schema,
  type CandidateQualityReportV3,
  type CompositionPlanV3,
  type SlideCanvas,
  type SlideSemanticBriefV3,
  type TextLayoutV3,
} from "@studydeck/shared";
import { aiSceneV3NativeBackplateColor, aiSceneV3NativeBackplateContrastRatio } from "./native-backplate.js";

export type AiSceneV3VisionReview = {
  noUnexpectedVisibleText: boolean;
  allowedVisibleTextIds: string[];
  noBakedTextInBackground: boolean;
  noBrandMarks: boolean;
  anchorEvidence: Array<{ anchorId: string; visualRegion: string; confidence: number; detail: string }>;
  scores: { semanticClarity: number; visualQuality: number; textIntegration: number; styleConsistency: number; compositionStrength: number; referenceLevel: number; deckDiversity: number };
  diagnostics: string[];
};

/**
 * Combines deterministic asset/layout checks with a mandatory high-detail
 * vision review. Missing vision evidence fails closed; a prompt is not proof
 * that the background contains no baked text or branding.
 */
export async function inspectAiSceneV3Candidate(input: {
  background: Buffer;
  canvas: SlideCanvas;
  brief: SlideSemanticBriefV3;
  plan: CompositionPlanV3;
  layout: TextLayoutV3;
  renderedPreviewSaved: boolean;
  backgroundSaved: boolean;
  exportCompatible: boolean;
  vision?: AiSceneV3VisionReview;
}): Promise<CandidateQualityReportV3> {
  const dimensions = await sharp(input.background, { animated: false }).metadata();
  const values = new Map(input.canvas.elements.filter((element) => element.type === "text").map((element) => [element.id.replace(/^ai-scene-v3-/, "").replace(/-/g, ":"), element]));
  const requiredSemanticIds = ["title", ...input.brief.anchors.map((anchor) => anchor.id), ...(input.brief.conclusion ? ["conclusion"] : [])];
  const audit = auditSlideCanvas({ ...input.canvas, elements: input.canvas.elements.filter((element) => element.id !== "ai-scene-v3-background") });
  const geometry = input.layout.entries.every((entry) => values.has(entry.semanticId));
  const textSize = input.layout.entries.every((entry) => entry.fontSize >= entry.minimumFontSize && entry.minimumFontSize >= aiSceneV3MinimumFontSize(entry.semanticId));
  // The layout model has no authority to waive or prove contrast. Inspect the
  // exact opaque native backplate that the renderer put under each editable
  // text box; placement remains covered by deterministic geometry plus vision.
  const textContrast = input.layout.entries.every((entry) => hasReadableNativeBackplate(input.canvas, entry));
  const anchorRegions = input.brief.anchors.every((anchor) => input.plan.anchorVisualRegions.some((region) => region.anchorId === anchor.id));
  const trueSixteenByNine = Boolean(dimensions.width && dimensions.height && dimensions.width * 9 === dimensions.height * 16);
  const vision = input.vision;
  const noBakedText = Boolean(vision?.noBakedTextInBackground);
  const noBrandMarks = Boolean(vision?.noBrandMarks);
  const allowedVisibleTextIds = new Set(vision?.allowedVisibleTextIds || []);
  const approvedVisibleTextContract = allowedVisibleTextIds.size === requiredSemanticIds.length && requiredSemanticIds.every((id) => allowedVisibleTextIds.has(id));
  const noUnexpectedText = Boolean(vision?.noUnexpectedVisibleText && approvedVisibleTextContract);
  const visionAnchors = new Map(vision?.anchorEvidence.map((item) => [item.anchorId, item]) || []);
  const anchorEvidence = input.brief.anchors.every((anchor) => (visionAnchors.get(anchor.id)?.confidence || 0) >= .7);
  const noCriticalVisualDefects = Boolean(vision && !vision.diagnostics.some((item) => /^critical:/i.test(item)));
  const checks = {
    semanticTextIds: check(requiredSemanticIds.every((id) => values.has(id)), "native editable text IDs match the semantic brief"),
    noUnexpectedVisibleText: check(noUnexpectedText, !vision ? "high-detail preview vision review is missing" : approvedVisibleTextContract ? "high-detail vision checked preview text" : "high-detail vision did not acknowledge the approved editable text contract"),
    noBakedTextInBackground: check(noBakedText, vision ? "high-detail vision checked background text" : "high-detail background vision review is missing"),
    noBrandMarks: check(noBrandMarks, !vision ? "high-detail background brand-mark vision review is missing" : noBrandMarks ? "high-detail vision found no brand marks" : "critical:brand_mark_detected"),
    trueSixteenByNine: check(trueSixteenByNine, "background dimensions are not an exact 16:9 raster"),
    textGeometry: check(geometry && audit.length === 0, audit.join("; ") || "layout text geometry matches canvas"),
    textMinimumSize: check(textSize, "text layout violates the semantic readable minimum (title 40px; anchors 24px; other text 16px)"),
    textContrast: check(textContrast, "rendered native backplate does not provide the required 4.5:1 text contrast"),
    anchorVisualRegions: check(anchorRegions && anchorEvidence, vision ? "one or more anchors lack grounded visual evidence" : "high-detail anchor vision review is missing"),
    criticalVisualDefects: check(noCriticalVisualDefects, vision?.diagnostics.filter((item) => /^critical:/i.test(item)).join("; ") || "high-detail visual review is missing"),
    assetsSaved: check(input.backgroundSaved && input.renderedPreviewSaved, "background or exact editable-canvas preview has not been saved"),
    exportCompatibility: check(input.exportCompatible, "PDF/PPTX compatibility has not been verified"),
  };
  const scores = vision?.scores || zeroScores();
  const weightedScore = Math.round((scores.semanticClarity * .2 + scores.visualQuality * .2 + scores.textIntegration * .15 + scores.styleConsistency * .15 + scores.compositionStrength * .15 + scores.referenceLevel * .1 + scores.deckDiversity * .05) * 100) / 100;
  const coreScoresPass = Object.values(scores).every((score) => score >= 70) && weightedScore >= 80;
  const passed = Object.values(checks).every((check) => check.passed) && coreScoresPass;
  return candidateQualityReportV3Schema.parse({
    version: 3,
    speechSectionHash: input.brief.speechSectionHash,
    contentHash: input.brief.contentHash,
    hardChecks: checks,
    scores,
    weightedScore,
    passed,
    diagnostics: [...Object.values(checks).filter((check) => !check.passed).map((check) => check.detail), ...(vision?.diagnostics || []), ...(coreScoresPass ? [] : ["quality score threshold not met"])].filter(Boolean),
    evidence: vision?.anchorEvidence.map((item) => ({ kind: `anchor:${item.anchorId}`, detail: `${item.visualRegion}; confidence=${item.confidence}; ${item.detail}` })) || [],
  });
}

function check(passed: boolean, detail: string) { return { passed, detail }; }
function zeroScores() { return { semanticClarity: 0, visualQuality: 0, textIntegration: 0, styleConsistency: 0, compositionStrength: 0, referenceLevel: 0, deckDiversity: 0 }; }

function hasReadableNativeBackplate(canvas: SlideCanvas, entry: TextLayoutV3["entries"][number]) {
  const plate = canvas.elements.find((element) => element.id === `ai-scene-v3-${entry.semanticId.replace(/:/g, "-")}-backplate`);
  return plate?.type === "shape"
    && plate.opacity >= .99
    && plate.fill.toUpperCase() === aiSceneV3NativeBackplateColor(entry.color, canvas.background).toUpperCase()
    && aiSceneV3NativeBackplateContrastRatio(entry.color, canvas.background) >= 4.5;
}

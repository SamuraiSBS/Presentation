import {
  auditSlideCanvas,
  type CandidateQualityReport,
  type SlideCanvas,
  type SlideContentLock,
} from "@studydeck/shared";
import type { AiSceneVisualReview } from "./scene-visual-quality.js";

/** Hard gates are deterministic; visual scores remain explicitly advisory. */
export function inspectAiScene(input: {
  canvas: SlideCanvas;
  contentLock: SlideContentLock;
  conceptObjectKey?: string;
  renderedPreviewObjectKey?: string;
  visualReview?: AiSceneVisualReview;
}): CandidateQualityReport {
  const textValues = new Set(input.contentLock.text.map((item) => item.text));
  const visibleText = input.canvas.elements.filter((element) => element.type === "text").map((element) => element.text);
  const unexpected = visibleText.filter((text) => !textValues.has(text));
  // A full-slide AI background is an intentional base layer, not a foreground
  // collision. Keep every other audit rule intact, including image/text and
  // diagram/text collisions.
  const audit = auditSlideCanvas({ ...input.canvas, elements: input.canvas.elements.filter((element) => element.id !== "ai-scene-background") });
  const hasBackground = input.canvas.elements.some((element) => element.id === "ai-scene-background" && element.type === "image" && Boolean(element.objectKey));
  const hasEditable = visibleText.length >= 2 && input.canvas.elements.some((element) => element.type === "diagram" || element.type === "shape");
  const hasDiagram = input.canvas.elements
    .filter((element) => element.type === "diagram")
    .every((element) => element.model.kind === "data" || element.model.nodes.length !== 0);
  const hardChecks = {
    textMatchesContentLock: { passed: unexpected.length === 0 && visibleText.includes(input.contentLock.title) && visibleText.includes(input.contentLock.thesis), detail: unexpected.length ? `unexpected text: ${unexpected.join(" | ")}` : "all editable text comes from content lock" },
    noBakedTextInBackground: {
      passed: input.visualReview?.noBakedTextInBackground === true,
      detail: input.visualReview?.detail || "visual inspection of the stored background has not run",
    },
    geometrySafe: { passed: audit.length === 0, detail: audit.join("; ") },
    editableElements: { passed: hasEditable, detail: hasEditable ? "text and scene objects are separate canvas elements" : "editable scene objects are incomplete" },
    diagramValid: { passed: hasDiagram, detail: hasDiagram ? "diagram data is typed" : "diagram data is invalid" },
    assetsAvailable: { passed: hasBackground && Boolean(input.conceptObjectKey) && Boolean(input.renderedPreviewObjectKey), detail: hasBackground ? "background, concept and rendered preview are stored" : "a required artifact is missing" },
    visualFidelity: {
      passed: Boolean(input.visualReview && input.visualReview.conceptSimilarity >= 35 && input.visualReview.styleConsistency >= 35 && input.visualReview.speechRelevance === 100 && input.visualReview.diagramTextReadable),
      detail: input.visualReview?.detail || "visual pixel review has not run",
    },
    noTemplateCardGrid: {
      passed: input.visualReview?.noTemplateCardGrid === true,
      detail: input.visualReview?.noTemplateCardGrid === true ? "no repeated template card-grid was detected" : "card-grid visual review has not run or detected a repeated card-grid",
    },
  };
  const passed = Object.values(hardChecks).every((check) => check.passed);
  return {
    contentHash: input.contentLock.contentHash,
    hardChecks,
    // A missing visual review must never turn a structural pass into GO.
    softChecks: {
      conceptSimilarity: input.visualReview?.conceptSimilarity ?? 0,
      speechRelevance: input.visualReview?.speechRelevance ?? 0,
      styleConsistency: input.visualReview?.styleConsistency ?? 0,
    },
    repairAttempts: 0,
    passed,
    diagnostics: passed ? [] : Object.values(hardChecks).filter((check) => !check.passed).map((check) => check.detail || "quality gate failed"),
  };
}

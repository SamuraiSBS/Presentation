import type { CandidateQualityReportV3, CompositionPlanV3, DeckArtDirectionV3, SlideSemanticBriefV3, TextLayoutV3 } from "@studydeck/shared";

export const hash = "a".repeat(64);
export const anchors = ["anchor:1", "anchor:2", "anchor:3", "anchor:4"] as const;
export const brief: SlideSemanticBriefV3 = {
  version: 3, slideId: "s2", slideOrder: 2, kind: "content", speechSectionHash: hash, contentHash: hash,
  title: { text: "Планеты" },
  anchors: ["Орбиты вокруг Солнца", "Разные размеры", "Каменные планеты", "Земля среди них"].map((text, index) => ({ id: anchors[index]!, text, role: "fact" as const, priority: index + 1, visualCue: "separate visible object", sourceTrace: text })),
  conclusion: { text: "Система связана орбитами" }, visualNarrative: "Space with distinct planets.", allowedCompositionTypes: ["layered_explanation", "comparison"],
};
export const direction: DeckArtDirectionV3 = {
  version: 3, styleId: "solar", styleVersion: 1, tone: "dark", palette: { background: "#071827", surface: "#16385C", primaryText: "#FFFFFF", secondaryText: "#DDEEFF", accent: "#FFC857" },
  contrastRules: ["Maintain at least 70 contrast score."], typography: { primaryFontFamily: "Nunito", fallbackFontFamily: "Nunito", cyrillicSupported: true }, imageStyle: "Scientific dark space composition.", imageTreatmentRules: ["Never bake text into the image."], recurringMotifs: [], slideNumberTreatment: "Native text only.", whitespaceRules: ["Reserve quiet side zones for native text."], allowedCompositionTypes: ["layered_explanation", "comparison"], adjacentSlideDiversityRules: ["Do not repeat a composition type adjacent to itself."], forbiddenTechniques: ["card grid"], referenceProfileIds: ["solar_scientific_dark"], imagePromptFragment: "Dark scientific spatial relationships with quiet text zones.", topicHash: hash, approvedSpeechHash: hash, referenceSelectionHash: hash,
};
export function plan(variant: "A" | "B", type: "layered_explanation" | "comparison"): CompositionPlanV3 {
  const ids = ["title", "anchor:1", "anchor:2", "anchor:3", "anchor:4", "conclusion"] as const;
  return { version: 3, slideId: "s2", slideOrder: 2, variant, compositionType: type, mainVisualSubject: "Visible orbital planet system", anchorVisualRegions: brief.anchors.map((anchor) => ({ anchorId: anchor.id, visualRegion: "distinct planet region", evidence: "anchor appears as a distinct visual relation" })), textZones: ids.map((semanticId, index) => ({ semanticId, zone: { x: .04, y: .05 + index * .15, w: .34, h: .10 }, maxLines: 2 })), quietZones: [{ x: .04, y: .05, w: .34, h: .85 }], protectedObjectZones: [], cropRules: ["Do not crop the orbital system."], variantDifference: variant === "A" ? "Layered orbital overview." : "Asymmetric comparative orbit view." };
}
export function layout(): TextLayoutV3 {
  return { version: 3, slideId: "s2", entries: plan("A", "layered_explanation").textZones.map((entry) => {
    const isTitle = entry.semanticId === "title";
    const isAnchor = entry.semanticId.startsWith("anchor:");
    return { semanticId: entry.semanticId, x: entry.zone.x * 1280, y: entry.zone.y * 720, w: entry.zone.w * 1280, h: entry.zone.h * 720, fontFamily: "Nunito", fallbackFontFamily: "Nunito", fontSize: isTitle ? 40 : isAnchor ? 24 : 21, minimumFontSize: isTitle ? 40 : isAnchor ? 24 : 16, fontWeight: isTitle ? 700 : 500, lineHeight: isTitle ? 1.12 : 1.14, letterSpacing: 0, color: "#FFFFFF", align: "left" as const, verticalAlign: "top" as const, maxLines: entry.maxLines, editable: true, zoneReason: "quiet left zone", contrastScore: 90, placementConfidence: .95 };
  }) };
}
export function report(passed: boolean, score: number): CandidateQualityReportV3 { return { version: 3, speechSectionHash: hash, contentHash: hash, hardChecks: { semanticTextIds: { passed, detail: "" }, noUnexpectedVisibleText: { passed, detail: "" }, noBakedTextInBackground: { passed, detail: "" }, noBrandMarks: { passed, detail: "" }, trueSixteenByNine: { passed, detail: "" }, textGeometry: { passed, detail: "" }, textMinimumSize: { passed, detail: "" }, textContrast: { passed, detail: "" }, anchorVisualRegions: { passed, detail: "" }, criticalVisualDefects: { passed, detail: "" }, assetsSaved: { passed, detail: "" }, exportCompatibility: { passed, detail: "" } }, scores: { semanticClarity: score, visualQuality: score, textIntegration: score, styleConsistency: score, compositionStrength: score, referenceLevel: score, deckDiversity: score }, weightedScore: score, passed, diagnostics: [], evidence: [] }; }

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspectAiSceneV3Candidate } from "./candidate-quality.js";
import { decideAiSceneV3CandidateRepair } from "./candidate-repair.js";
import { persistAiSceneV3Candidate } from "./candidate-persistence.js";
import { renderAiSceneV3Candidate } from "./candidate-renderer.js";
import { brief, layout, plan, report } from "./test-fixtures.js";
import { aiSceneV3VisionQualityPrompt, validateAiSceneV3VisionReview } from "./vision-quality.js";

describe("AI Scene v3 quality and persistence", () => {
  it("fails closed without a high-detail vision review", async () => {
    const background = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#071827" } }).png().toBuffer();
    const rendered = await renderAiSceneV3Candidate({ background: { buffer: background, objectKey: "background.png", url: "https://assets.example.test/background.png", alt: "Solar System", contentType: "image/png" }, layout: layout(), textValues: [{ semanticId: "title", value: { text: "Планеты" } }, ...brief.anchors.map((anchor) => ({ semanticId: anchor.id, value: { text: anchor.text } })), { semanticId: "conclusion", value: { text: "Система связана орбитами" } }], backgroundColor: "#071827" });
    const quality = await inspectAiSceneV3Candidate({ background, canvas: rendered.canvas, brief, plan: plan("A", "layered_explanation"), layout: layout(), backgroundSaved: true, renderedPreviewSaved: true, exportCompatible: true });
    expect(quality.passed).toBe(false);
    expect(quality.hardChecks.noBakedTextInBackground.passed).toBe(false);
    expect(quality.hardChecks.noBrandMarks.passed).toBe(false);
  });

  it("blocks an otherwise strong candidate when high-detail vision finds a brand mark", async () => {
    const background = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#071827" } }).png().toBuffer();
    const rendered = await renderAiSceneV3Candidate({ background: { buffer: background, objectKey: "background.png", url: "https://assets.example.test/background.png", alt: "Solar System", contentType: "image/png" }, layout: layout(), textValues: [{ semanticId: "title", value: { text: "Планеты" } }, ...brief.anchors.map((anchor) => ({ semanticId: anchor.id, value: { text: anchor.text } })), { semanticId: "conclusion", value: { text: "Система связана орбитами" } }], backgroundColor: "#071827" });
    const quality = await inspectAiSceneV3Candidate({
      background, canvas: rendered.canvas, brief, plan: plan("A", "layered_explanation"), layout: layout(), backgroundSaved: true, renderedPreviewSaved: true, exportCompatible: true,
      vision: { noUnexpectedVisibleText: true, allowedVisibleTextIds: ["title", ...brief.anchors.map((anchor) => anchor.id), "conclusion"], noBakedTextInBackground: true, noBrandMarks: false, anchorEvidence: brief.anchors.map((anchor) => ({ anchorId: anchor.id, visualRegion: "visible region", confidence: .9, detail: "visible relation" })), scores: { semanticClarity: 90, visualQuality: 90, textIntegration: 90, styleConsistency: 90, compositionStrength: 90, referenceLevel: 90, deckDiversity: 90 }, diagnostics: ["critical:brand_mark_detected"] },
    });
    expect(quality.passed).toBe(false);
    expect(quality.hardChecks.noBrandMarks).toMatchObject({ passed: false, detail: "critical:brand_mark_detected" });
  });

  it("derives Gate 1 contrast from the rendered opaque native backplate, not provider self-report", async () => {
    const background = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#071827" } }).png().toBuffer();
    const solarBrief = { ...brief, conclusion: undefined };
    const safePlan = {
      ...plan("A", "layered_explanation"),
      textZones: plan("A", "layered_explanation").textZones.filter((entry) => entry.semanticId !== "conclusion").map((entry, index) => ({ ...entry, zone: { x: .08, y: .08 + index * .15, w: .35, h: .1 } })),
      quietZones: [{ x: .08, y: .08, w: .35, h: .85 }],
    };
    const actualLayout = {
      ...layout(),
      entries: layout().entries.filter((entry) => entry.semanticId !== "conclusion").map((entry, index) => ({
        ...entry,
        x: safePlan.textZones[index]!.zone.x * 1280,
        y: safePlan.textZones[index]!.zone.y * 720,
        w: safePlan.textZones[index]!.zone.w * 1280,
        h: safePlan.textZones[index]!.zone.h * 720,
        // A provider cannot make a high-contrast native plate fail by merely
        // reporting low confidence for its own coordinates.
        contrastScore: 1,
        placementConfidence: 0,
      })),
    };
    const rendered = await renderAiSceneV3Candidate({ background: { buffer: background, objectKey: "background.png", url: "https://assets.example.test/background.png", alt: "Solar System", contentType: "image/png" }, layout: actualLayout, textValues: [{ semanticId: "title", value: { text: "Планеты" } }, ...solarBrief.anchors.map((anchor) => ({ semanticId: anchor.id, value: { text: anchor.text } }))], backgroundColor: "#071827" });
    const vision = { noUnexpectedVisibleText: true, allowedVisibleTextIds: ["title", ...solarBrief.anchors.map((anchor) => anchor.id)], noBakedTextInBackground: true, noBrandMarks: true, anchorEvidence: solarBrief.anchors.map((anchor) => ({ anchorId: anchor.id, visualRegion: "visible region", confidence: .9, detail: "visible relation" })), scores: { semanticClarity: 90, visualQuality: 90, textIntegration: 90, styleConsistency: 90, compositionStrength: 90, referenceLevel: 90, deckDiversity: 90 }, diagnostics: [] };
    const quality = await inspectAiSceneV3Candidate({ background, canvas: rendered.canvas, brief: solarBrief, plan: safePlan, layout: actualLayout, backgroundSaved: true, renderedPreviewSaved: true, exportCompatible: true, vision });
    expect(quality.hardChecks.textContrast).toMatchObject({ passed: true });
    expect(quality.passed).toBe(true);
  });

  it("requires every compact high-detail vision field and names missing fields precisely", () => {
    const prompt = aiSceneV3VisionQualityPrompt({ brief, plan: plan("A", "layered_explanation"), backgroundWidth: 1536, backgroundHeight: 864 });
    expect(prompt).toContain("compact minified JSON object");
    expect(prompt).toContain("diagnostics MUST be an array");
    expect(() => validateAiSceneV3VisionReview({ noBrandMarks: true, diagnostics: [] }, brief, plan("A", "layered_explanation")))
      .toThrow("ai_scene_v3_vision_contract_invalid:noUnexpectedVisibleText:required");
  });

  it("rejects a brand-mark finding that omits the mandatory critical diagnostic", () => {
    expect(() => validateAiSceneV3VisionReview({
      noUnexpectedVisibleText: true, allowedVisibleTextIds: ["title", ...brief.anchors.map((anchor) => anchor.id), "conclusion"], noBakedTextInBackground: true, noBrandMarks: false,
      anchorEvidence: brief.anchors.map((anchor) => ({ anchorId: anchor.id, visualRegion: "visible region", confidence: .9, detail: "visible relation" })),
      scores: { semanticClarity: 90, visualQuality: 90, textIntegration: 90, styleConsistency: 90, compositionStrength: 90, referenceLevel: 90, deckDiversity: 90 }, diagnostics: [],
    }, brief, plan("A", "layered_explanation"))).toThrow("ai_scene_v3_vision_brand_mark_diagnostic_required");
  });

  it("treats the mandatory editable title as approved preview text and rejects a false unexpected-text diagnosis", () => {
    const prompt = aiSceneV3VisionQualityPrompt({ brief, plan: plan("A", "layered_explanation"), backgroundWidth: 1536, backgroundHeight: 864 });
    expect(prompt).toContain("approved presentation overlay text, never unexpected text");
    expect(() => validateAiSceneV3VisionReview({
      noUnexpectedVisibleText: false,
      allowedVisibleTextIds: ["title", ...brief.anchors.map((anchor) => anchor.id), "conclusion"],
      noBakedTextInBackground: true,
      noBrandMarks: true,
      anchorEvidence: brief.anchors.map((anchor) => ({ anchorId: anchor.id, visualRegion: "quiet-side visual proof", confidence: .9, detail: "distinct visible relation" })),
      scores: { semanticClarity: 90, visualQuality: 90, textIntegration: 90, styleConsistency: 90, compositionStrength: 90, referenceLevel: 90, deckDiversity: 90 },
      diagnostics: ["critical:unexpected_visible_text:title"],
    }, brief, plan("A", "layered_explanation"))).toThrow("ai_scene_v3_vision_expected_visible_text_misclassified");
  });

  it("keeps an incomplete A/B pair in repair, never in ready state", () => {
    expect(decideAiSceneV3CandidateRepair({ a: { plan: plan("A", "layered_explanation"), qualityReport: report(false, 40) }, b: { plan: plan("B", "comparison"), qualityReport: report(false, 35) } }).variant).toBe("C");
  });

  it("removes binary artifacts when the metadata transaction fails", async () => {
    const deleted: string[] = [];
    await expect(persistAiSceneV3Candidate({
      candidate: { id: "candidate-a", variant: "A", backgroundObjectKey: "background.png", renderedPreviewObjectKey: "preview.png", compositionPlan: plan("A", "layered_explanation"), textLayout: layout(), qualityReport: report(false, 0), referenceIds: ["ref-1"], providerCapabilities: { provider: "aitunnel", model: "gpt-image-2.5-flare", endpoint: "https://example.test", fetchedAt: "2026-09-11T00:00:00.000Z", supportsGeneration: true, supportsImageInput: true, supportsEditing: true, supportsCombinedResolutionAndAspectRatio: true, maxInputReferences: 3, qualities: ["xhigh"], outputFormats: ["png"], sizes: [], aspectRatios: [], rawModelId: "gpt-image-2.5-flare" }, model: "gpt-image-2.5-flare", quality: "xhigh", requestDimensions: { width: 1536, height: 864 }, returnedDimensions: { width: 1536, height: 864 }, costRub: "0.85", durationMs: 1 },
      artifacts: { background: { objectKey: "background.png", body: Buffer.from("background"), contentType: "image/png" }, preview: { objectKey: "preview.png", body: Buffer.from("preview"), contentType: "image/png" } },
      putObject: async () => undefined,
      deleteObject: async (key) => { deleted.push(key); },
      transaction: async (write) => write(),
      writeCandidate: async () => { throw new Error("database unavailable"); },
    })).rejects.toThrow("database unavailable");
    expect(deleted).toEqual(["background.png", "preview.png"]);
  });
});

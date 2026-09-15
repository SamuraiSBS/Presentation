import { describe, expect, it } from "vitest";
import { referenceFixtures } from "./reference-lab-fixtures.js";
import { buildNativeCanvasForFixture, buildReconstructionPlan, detectPlannedTextZones, evaluateReconstructionGate, fitNativeReplacement } from "./reference-lab.js";
import { renderPdfCanvasElement } from "../../export/pdf-canvas.js";
import { renderPptxCanvasSlide } from "../../export/pptx-canvas.js";

describe("image-first editable reference lab contracts", () => {
  it("keeps exact Unicode source strings, semantic IDs, and planned zones for every actual reference", () => {
    expect(referenceFixtures).toHaveLength(18);
    for (const fixture of referenceFixtures) {
      expect(new Set(fixture.texts.map((entry) => entry.id)).size).toBe(fixture.texts.length);
      expect(fixture.texts.every((entry) => entry.text === entry.text.normalize("NFC") && entry.zone.w > 0 && entry.zone.h > 0)).toBe(true);
      expect(fixture.decorativeText.length).toBeGreaterThan(0);
    }
  });

  it("uses planned exact strings as truth and never allows a fuzzy observation to rewrite them", () => {
    const fixture = referenceFixtures[0]!;
    const mutated = fixture.texts.map((entry, index) => index === 0 ? { ...entry, text: "Ошибочная OCR догадка" } : entry);
    expect(buildReconstructionPlan({ raster: Buffer.from("fixture"), texts: fixture.texts, plannedSemanticZones: mutated, visualFamily: fixture.visualFamily }).exact).toBe(false);
  });

  it("models the required hard failure classes without any external service", () => {
    const fixtures = referenceFixtures.filter((fixture) => fixture.forceFallback === "structured_evidence");
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
    expect(referenceFixtures.some((fixture) => fixture.texts.some((entry) => entry.kind === "number"))).toBe(true);
    expect(referenceFixtures.some((fixture) => fixture.texts.some((entry) => /Солнечная|Ростовской/u.test(entry.text)))).toBe(true);
  });

  it("keeps line boxes bounded by the planned zone and treats a Cyrillic two-line title as known text", () => {
    const fixture = referenceFixtures.find((item) => item.id === "porsche-04")!;
    const zones = detectPlannedTextZones({ raster: Buffer.from("fixture"), texts: fixture.texts, plannedSemanticZones: fixture.texts, visualFamily: fixture.visualFamily });
    expect(zones).toHaveLength(fixture.texts.length);
    expect(zones.every((zone) => zone.source === "planned_zone_bounded_cv" && zone.confidence < .8)).toBe(true);
    expect(zones.some((zone) => zone.lineCount === 2)).toBe(true);
  });

  it("fails closed for false OCR matches, unexpected text, ghost glyphs, long replacement overflow, and unresolved text", () => {
    const falseMatch = evaluateReconstructionGate({ geometryConfidence: .54, ghostDetected: false, cleanupDamage: false, unexpectedText: true, exactTextFits: true, structuredEvidence: false, exportParity: true });
    expect(falseMatch.reasons).toEqual(expect.arrayContaining(["geometry_confidence", "unexpected_text"]));
    const ghost = evaluateReconstructionGate({ geometryConfidence: .9, ghostDetected: true, cleanupDamage: false, unexpectedText: false, exactTextFits: true, structuredEvidence: false, exportParity: true });
    expect(ghost.reasons).toContain("cleanup_ghost");
    expect(fitNativeReplacement("Очень длинная пользовательская замена, которая не должна быть беззвучно обрезана.", { w: 120, h: 32 }, 24).fits).toBe(false);
    expect(evaluateReconstructionGate({ geometryConfidence: .9, ghostDetected: false, cleanupDamage: false, unexpectedText: false, exactTextFits: true, structuredEvidence: false, exportParity: true, unresolvedText: true }).reasons).toContain("unresolved_text");
  });

  it("uses one canonical native canvas string set for editor, PDF, and PPTX projections", async () => {
    const fixture = referenceFixtures.find((item) => item.id === "solar-02")!;
    const canvas = buildNativeCanvasForFixture(fixture);
    const editable = canvas.elements.filter((element) => element.type === "text" && !element.locked);
    const pdf = await Promise.all(editable.map((element) => renderPdfCanvasElement(element, { readObjectBuffer: async () => Buffer.alloc(0), contentTypeFromObjectKey: () => "image/png", warn: () => undefined })));
    expect(pdf.join(" ")).toContain("Солнце — источник энергии и главный центр движения");
    const added: unknown[] = [];
    await renderPptxCanvasSlide({ ShapeType: { ellipse: "ellipse", line: "line", roundRect: "roundRect", rect: "rect" } }, { addImage: () => undefined, addShape: () => undefined, addText: (...args: unknown[]) => added.push(args) }, canvas, { preset: "tech", colors: { background: "#061424", surface: "#061424", surfaceAlt: "#061424", text: "#F5F7FA", muted: "#AFC8FF", accent: "#ED2D38", accentAlt: "#55D6E8", line: "#55D6E8" }, fonts: { heading: "Arial", body: "Arial", tone: "technical" }, themeId: "lab", mood: "dark", pptx: { background: "061424", surface: "061424", surfaceAlt: "061424", text: "F5F7FA", muted: "AFC8FF", accent: "ED2D38", accentAlt: "55D6E8", line: "55D6E8" } }, { readObjectBuffer: async () => Buffer.alloc(0), contentTypeFromObjectKey: () => "image/png", warn: () => undefined });
    expect(added.some((entry) => JSON.stringify(entry).includes("Солнце — источник энергии и главный центр движения"))).toBe(true);
  });
});

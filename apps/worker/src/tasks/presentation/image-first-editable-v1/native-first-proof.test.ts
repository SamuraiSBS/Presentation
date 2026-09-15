import { describe, expect, it } from "vitest";
import { buildNativeFirstCanvas, nativeElementManifest, nativeProofFixtures } from "./native-first-proof.js";

describe("native-first editable proof", () => {
  it("authors the three designated fixtures without reference images or rasterized semantic text", () => {
    for (const fixture of nativeProofFixtures()) {
      const canvas = buildNativeFirstCanvas(fixture);
      const manifest = nativeElementManifest(fixture, canvas);
      expect(canvas.elements.some((element) => element.type === "image")).toBe(false);
      expect(manifest.filter((entry) => entry.semanticId)).toHaveLength(fixture.texts.length);
      for (const exact of fixture.texts) {
        const element = canvas.elements.find((candidate) => candidate.id === exact.id);
        expect(element).toMatchObject({ type: "text", text: exact.text.normalize("NFC") });
        expect(element?.locked).toBe(exact.id === "solar-01-page");
      }
      expect(canvas.elements.filter((element) => element.type === "shape").every((element) => element.locked)).toBe(true);
      expect(canvas.elements.some((element) => element.type === "text" && element.typographyRole === "slideNumber" && element.locked)).toBe(true);
    }
  });

  it("keeps the three visual families materially different", () => {
    const canvases = nativeProofFixtures().map(buildNativeFirstCanvas);
    expect(canvases.map((canvas) => canvas.background)).toEqual(["#071427", "#090A0C", "#F4F0E4"]);
    expect(canvases.map((canvas) => canvas.elements.filter((element) => element.type === "shape").length)).toEqual([16, 12, 12]);
  });
});

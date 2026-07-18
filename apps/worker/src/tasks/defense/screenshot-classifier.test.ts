import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { classifyDefenseScreenshot } from "./screenshot-classifier.js";

describe("defense screenshot classification", () => {
  it("uses an honest metadata fallback when vision is unavailable", async () => {
    const previous = process.env.VISION_PROVIDER;
    delete process.env.VISION_PROVIDER;
    try {
      const buffer = await sharp({ create: { width: 360, height: 760, channels: 3, background: "#ffffff" } }).png().toBuffer();
      const result = await classifyDefenseScreenshot({ sourceId: "screen-1", label: "mobile-profile.png", buffer });
      expect(result).toMatchObject({ sourceId: "screen-1", kind: "mobile", status: "needs_review", provider: "metadata" });
      expect(result.matchedFactIds).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.VISION_PROVIDER;
      else process.env.VISION_PROVIDER = previous;
    }
  });
});

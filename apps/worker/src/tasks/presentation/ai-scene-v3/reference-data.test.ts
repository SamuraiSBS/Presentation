import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AI_SCENE_V3_REFERENCE_TRANSPORT, prepareAiSceneV3ReferenceDataUrl } from "./reference-data.js";

describe("AI Scene v3 reference transport", () => {
  it("keeps a real reference image while bounding its JPEG data-url payload", async () => {
    const source = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: "#16436D" } }).png().toBuffer();
    const prepared = await prepareAiSceneV3ReferenceDataUrl(source);

    expect(prepared).toMatchObject({ contentType: "image/jpeg", width: 960, height: 540 });
    expect(prepared.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(prepared.bytes).toBeLessThanOrEqual(AI_SCENE_V3_REFERENCE_TRANSPORT.maxBytes);
  });
});

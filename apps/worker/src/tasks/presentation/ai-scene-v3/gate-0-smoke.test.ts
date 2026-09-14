import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AiSceneV3Gate0Budget, runAiSceneV3Gate0Smoke } from "./gate-0-smoke.js";

const capabilities = {
  provider: "aitunnel" as const,
  model: "gpt-image-2.5-flare",
  endpoint: "https://api.aitunnel.ru/public/aitunnel/models/images",
  fetchedAt: "2026-09-11T00:00:00.000Z",
  supportsGeneration: true,
  supportsImageInput: true,
  supportsEditing: true,
  supportsCombinedResolutionAndAspectRatio: true,
  maxInputReferences: 16,
  qualities: ["xhigh"],
  outputFormats: ["png"],
  sizes: [],
  aspectRatios: [],
  rawModelId: "gpt-image-2.5-flare",
};

describe("AI Scene v3 Gate 0 smoke", () => {
  it("reserves a single ceiling and refuses a second reservation", () => {
    const budget = new AiSceneV3Gate0Budget("42.50");
    expect(budget.reserve()).toMatchObject({ status: "reserved", reservedRub: "42.50000000" });
    expect(budget.reserve().status).toBe("ceiling_exceeded");
    expect(budget.settle("42.51").status).toBe("ceiling_exceeded");
  });

  it("emits a passing manifest only after mocked xhigh PNG dimensions and cost pass", async () => {
    const png = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#001122" } }).png().toBuffer();
    const dates = [new Date("2026-09-11T00:00:00.000Z"), new Date("2026-09-11T00:00:01.500Z")];
    let persisted: Buffer | undefined;
    const manifest = await runAiSceneV3Gate0Smoke({
      env: { AITUNNEL_API_KEY: "test-key", AI_SCENE_V3_IMAGE_SIZE: "1536x864" },
      ceilingRub: "42.50",
      referenceUrls: ["https://assets.example.test/reference.png"],
      onVerifiedImage: (image, dimensions) => {
        expect(dimensions).toEqual({ width: 1536, height: 864 });
        persisted = image.buffer;
      },
    }, {
      now: () => dates.shift() || new Date("2026-09-11T00:00:01.500Z"),
      fetchCapabilities: async () => capabilities,
      generate: async (_prompt, _env, options) => {
        expect(options?.inputReferences).toEqual([{ type: "image_url", image_url: { url: "https://assets.example.test/reference.png" } }]);
        return { buffer: png, contentType: "image/png", model: "gpt-image-2.5-flare", costRub: "0.85", providerRequestId: "gate-0-test" };
      },
    });

    expect(manifest).toMatchObject({
      status: "passed",
      returned: { width: 1536, height: 864, contentType: "image/png" },
      cost: { ceilingRub: "42.50000000", actualRub: "0.85000000", status: "settled" },
      references: { count: 1, inputReferencesSent: true },
    });
    expect(persisted).toEqual(png);
  });

  it("fails before reservation when no provider-readable reference is supplied", async () => {
    const manifest = await runAiSceneV3Gate0Smoke({
      env: { AITUNNEL_API_KEY: "test-key", AI_SCENE_V3_IMAGE_SIZE: "1536x864" },
      ceilingRub: "42.50",
      referenceUrls: [],
    }, { fetchCapabilities: async () => capabilities });
    expect(manifest).toMatchObject({ status: "failed", cost: { status: "not_reserved" } });
    expect(manifest.diagnostics).toContain("ai_scene_v3_gate_0_input_reference_required");
  });
});

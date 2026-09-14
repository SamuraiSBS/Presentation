import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  AI_SCENE_V3_IMAGE_MODEL,
  aiSceneV3ImageEnv,
  assertAiSceneV3ProviderPreflight,
  fetchAiSceneV3ProviderCapabilities,
  inspectAiSceneV3ProviderPreflight,
  verifyAiSceneV3GeneratedPng,
} from "./provider-preflight.js";
import { aiSceneV3BackgroundPrompt, generateAiSceneV3Background } from "./background-generator.js";
import { brief, direction, plan } from "./test-fixtures.js";

const capabilitySnapshot = {
  provider: "aitunnel" as const,
  model: AI_SCENE_V3_IMAGE_MODEL,
  endpoint: "https://api.aitunnel.ru/public/aitunnel/models/images",
  fetchedAt: "2026-09-11T00:00:00.000Z",
  supportsGeneration: true,
  supportsImageInput: true,
  supportsEditing: true,
  supportsCombinedResolutionAndAspectRatio: true,
  maxInputReferences: 16,
  qualities: ["auto", "high", "xhigh"],
  outputFormats: ["png", "jpeg"],
  sizes: ["1536x864"],
  aspectRatios: [],
  rawModelId: AI_SCENE_V3_IMAGE_MODEL,
};

describe("AI Scene v3 provider preflight", () => {
  it("forces the dedicated xhigh PNG overlay instead of inheriting v2 image settings", () => {
    expect(aiSceneV3ImageEnv({
      AITUNNEL_IMAGE_MODEL: "other-image-model",
      AITUNNEL_IMAGE_MODE: "chat_svg",
      AITUNNEL_IMAGE_QUALITY: "low",
      AITUNNEL_IMAGE_OUTPUT_FORMAT: "jpeg",
      AITUNNEL_IMAGE_SIZE: "1536x1024",
      AI_SCENE_V3_IMAGE_SIZE: "1536x864",
    })).toMatchObject({
      AITUNNEL_IMAGE_MODEL: AI_SCENE_V3_IMAGE_MODEL,
      AITUNNEL_IMAGE_MODE: "raster",
      AITUNNEL_IMAGE_QUALITY: "xhigh",
      AITUNNEL_IMAGE_OUTPUT_FORMAT: "png",
      AITUNNEL_IMAGE_SIZE: "1536x864",
      AITUNNEL_IMAGE_TIMEOUT_MS: "90000",
    });
  });

  it("requires every documented v3 capability before a paid smoke can start", () => {
    const env = { AITUNNEL_API_KEY: "test-key", AI_SCENE_V3_IMAGE_SIZE: "1536x864" };
    expect(assertAiSceneV3ProviderPreflight(env, capabilitySnapshot).request).toMatchObject({
      quality: "xhigh", outputFormat: "png", width: 1536, height: 864,
    });
    const missingReferences = inspectAiSceneV3ProviderPreflight(env, { ...capabilitySnapshot, supportsImageInput: false });
    expect(missingReferences.diagnostics).toContain("ai_scene_v3_reference_input_unavailable");
    expect(inspectAiSceneV3ProviderPreflight({ ...env, AI_SCENE_V3_IMAGE_SIZE: "1536x1024" }, capabilitySnapshot).diagnostics)
      .toContain("ai_scene_v3_true_16_9_required");
  });

  it("normalizes a public capabilities payload and verifies the returned PNG without crop", async () => {
    const snapshot = await fetchAiSceneV3ProviderCapabilities({}, {
      now: () => new Date("2026-09-11T00:00:00.000Z"),
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ [AI_SCENE_V3_IMAGE_MODEL]: {
          modalities: { input: ["text", "image"], output: ["image"] },
          supports_generation: true,
          supports_edit: true,
          supports_combined_resolution_and_aspect_ratio: true,
          max_input_references: 16,
          supported_quality: ["xhigh"],
          supported_output_formats: ["png"],
          supported_resolutions: [],
          supported_aspect_ratios: [],
        } }),
      }),
    });
    expect(snapshot).toMatchObject({
      provider: "aitunnel",
      model: AI_SCENE_V3_IMAGE_MODEL,
      supportsGeneration: true,
      supportsImageInput: true,
      supportsEditing: true,
      supportsCombinedResolutionAndAspectRatio: true,
      maxInputReferences: 16,
      qualities: ["xhigh"],
      outputFormats: ["png"],
      sizes: [],
    });

    const buffer = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#001122" } }).png().toBuffer();
    await expect(verifyAiSceneV3GeneratedPng({
      buffer,
      contentType: "image/png",
      request: assertAiSceneV3ProviderPreflight({ AITUNNEL_API_KEY: "test-key", AI_SCENE_V3_IMAGE_SIZE: "1536x864" }, capabilitySnapshot).request,
    })).resolves.toEqual({ width: 1536, height: 864 });
  });

  it("bounds a stalled capabilities request before any Gate 1 budget is reserved", async () => {
    await expect(fetchAiSceneV3ProviderCapabilities({ AI_SCENE_V3_CAPABILITIES_TIMEOUT_MS: "1000" }, {
      fetch: async (_url, init) => await new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    })).rejects.toThrow("ai_scene_v3_capabilities_fetch_timeout");
  }, 2_000);

  it("passes a local PNG reference as a provider-readable data URL and forbids brand identifiers in the final prompt", async () => {
    const png = await sharp({ create: { width: 1536, height: 864, channels: 3, background: "#001122" } }).png().toBuffer();
    const generate = async (_prompt: string) => ({ buffer: png, contentType: "image/png", model: AI_SCENE_V3_IMAGE_MODEL, costRub: "1" });
    await expect(generateAiSceneV3Background({
      env: { AITUNNEL_API_KEY: "test-key", AI_SCENE_V3_IMAGE_SIZE: "1536x864" }, capabilities: capabilitySnapshot, artDirection: direction, brief, plan: plan("A", "layered_explanation"),
      references: [{ id: "local-reference", url: `data:image/png;base64,${png.toString("base64")}` }],
    }, { generate })).resolves.toMatchObject({ referenceIds: ["local-reference"] });
    const prompt = aiSceneV3BackgroundPrompt(direction, brief, plan("A", "layered_explanation"));
    expect(prompt).toContain("Never depict brand identifiers");
    expect(prompt).toContain("empty card-like placeholders");
  });
});

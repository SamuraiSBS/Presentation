import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AITUNNEL_DEFAULT_IMAGE_MODEL,
  AITUNNEL_DEFAULT_IMAGE_OUTPUT_FORMAT,
  AITUNNEL_DEFAULT_IMAGE_QUALITY,
  AITUNNEL_DEFAULT_IMAGE_SIZE,
  AITUNNEL_DEFAULT_CHAT_SVG_MAX_OUTPUT_TOKENS,
  aitunnelImageConfig,
  generateAitunnelImage,
  normalizeAitunnelImageCost,
} from "./aitunnel-image.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AITunnel image generation", () => {
  it("uses the separate image model defaults and rejects auto routing", () => {
    expect(aitunnelImageConfig({ AITUNNEL_API_KEY: "key" })).toEqual({
      apiKey: "key",
      baseURL: "https://api.aitunnel.ru/v1",
      mode: "chat_svg",
      imageModel: AITUNNEL_DEFAULT_IMAGE_MODEL,
      size: AITUNNEL_DEFAULT_IMAGE_SIZE,
      quality: AITUNNEL_DEFAULT_IMAGE_QUALITY,
      outputFormat: AITUNNEL_DEFAULT_IMAGE_OUTPUT_FORMAT,
      maxOutputTokens: AITUNNEL_DEFAULT_CHAT_SVG_MAX_OUTPUT_TOKENS,
    });
    expect(aitunnelImageConfig({ AITUNNEL_API_KEY: "key", AITUNNEL_IMAGE_MODEL: "auto" })).toBeUndefined();
  });

  it("calls /images/generations and decodes the documented base64 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: "gen-1",
        model: "gpt-image-1-mini",
        data: [{ b64_json: Buffer.from("generated-image").toString("base64"), media_type: "image/png" }],
        usage: { cost_rub: 0.408 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const generated = await generateAitunnelImage("horizontal classroom photo", {
      AITUNNEL_API_KEY: "key",
      AITUNNEL_BASE_URL: "https://gateway.example/v1/",
      AITUNNEL_IMAGE_MODEL: "gpt-image-1-mini",
      AITUNNEL_IMAGE_SIZE: "1536x1024",
      AITUNNEL_IMAGE_QUALITY: "low",
      AITUNNEL_IMAGE_OUTPUT_FORMAT: "jpeg",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://gateway.example/v1/images/generations", expect.objectContaining({ method: "POST" }));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "gpt-image-1-mini",
      prompt: "horizontal classroom photo",
      n: 1,
      size: "1536x1024",
      quality: "low",
      output_format: "jpeg",
    });
    expect(generated).toMatchObject({
      buffer: Buffer.from("generated-image"),
      contentType: "image/png",
      model: "gpt-image-1-mini",
      costRub: "0.40800000",
      providerRequestId: "gen-1",
    });
  });

  it("uses GPT-5.6 chat mode for the current key and rasterizes its safe SVG later", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: "chat-1",
        model: "gpt-5.6-luna",
        choices: [{ message: { content: "```svg\n<svg viewBox=\"0 0 1200 675\"><circle cx=\"600\" cy=\"337\" r=\"120\" /></svg>\n```" } }],
        usage: { cost_rub: 0.126 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const generated = await generateAitunnelImage("Solar system visual", { AITUNNEL_API_KEY: "key", AITUNNEL_NARRATION_MODEL: "gpt-5.6-luna" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.aitunnel.ru/v1/chat/completions", expect.objectContaining({ method: "POST" }));
    expect(generated).toMatchObject({ contentType: "image/svg+xml", model: "gpt-5.6-luna", costRub: "0.12600000", providerRequestId: "chat-1" });
    expect(generated.buffer.toString("utf8")).toContain("<svg viewBox=\"0 0 1200 675\">");
    expect(generated.buffer.toString("utf8")).not.toContain("```");
  });

  it("preserves provider cost and request id when a response has no usable image", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ id: "gen-no-image", model: "gpt-image-1-mini", data: [], usage: { cost_rub: 0.77 } }),
    }));

    await expect(generateAitunnelImage("Solar system", {
      AITUNNEL_API_KEY: "key",
      AITUNNEL_IMAGE_MODEL: "gpt-image-1-mini",
      AITUNNEL_IMAGE_MODE: "raster",
    })).rejects.toMatchObject({
      name: "AitunnelImageProviderError",
      details: { reason: "no_base64_image", costRub: "0.77000000", providerRequestId: "gen-no-image" },
    });
  });

  it("marks an aborted fetch as a provider abort with the configured timeout", async () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));

    await expect(generateAitunnelImage("Solar system", {
      AITUNNEL_API_KEY: "key",
      AITUNNEL_IMAGE_MODEL: "gpt-image-1-mini",
      AITUNNEL_IMAGE_MODE: "raster",
      AITUNNEL_IMAGE_TIMEOUT_MS: "5000",
    })).rejects.toMatchObject({
      name: "AitunnelImageProviderError",
      details: { aborted: true, mode: "raster", timeoutMs: 5000, reason: "timeout_or_abort" },
    });
  });

  it("normalizes provider cost without accepting malformed values", () => {
    expect(normalizeAitunnelImageCost("3.4")).toBe("3.40000000");
    expect(normalizeAitunnelImageCost(0)).toBe("0.00000000");
    expect(normalizeAitunnelImageCost("not-a-cost")).toBeUndefined();
  });
});

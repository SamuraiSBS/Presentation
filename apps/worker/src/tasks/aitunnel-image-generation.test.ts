import { afterEach, describe, expect, it, vi } from "vitest";

const recordAiUsage = vi.fn();
const recordCostEvent = vi.fn();
const currentUsageContext = vi.fn(() => ({ projectId: "project-1", generationJobId: "job-1" }));

vi.mock("../usage-ledger.js", () => ({ currentUsageContext, recordAiUsage, recordCostEvent }));

const { decodeBase64Image, generateAitunnelImage } = await import("./aitunnel-image-generation.js");

const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

afterEach(() => {
  vi.unstubAllEnvs();
  recordAiUsage.mockReset();
  recordCostEvent.mockReset();
  currentUsageContext.mockClear();
});

describe("AITUNNEL image-generation adapter", () => {
  it("posts one explicit model request, decodes b64_json, and records provider-reported usage", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubEnv("AITUNNEL_API_KEY", "test-aitunnel-key");
    vi.stubEnv("AITUNNEL_BASE_URL", "https://api.aitunnel.ru/v1");
    vi.stubEnv("AITUNNEL_IMAGE_MODEL", "seedream-4.5");

    const result = await generateAitunnelImage("Editorial illustration of a classroom", {
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({
          id: "image-request-1",
          model: "seedream-4.5",
          data: [{ b64_json: tinyPng, media_type: "image/png" }],
          usage: { cost_rub: 3.4 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.aitunnel.ru/v1/images/generations",
      init: expect.objectContaining({ method: "POST" }),
    });
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toEqual({ model: "seedream-4.5", prompt: "Editorial illustration of a classroom", n: 1 });
    expect(calls[0]?.init?.headers).toMatchObject({ Authorization: "Bearer test-aitunnel-key" });
    expect(result).toMatchObject({ model: "seedream-4.5", contentType: "image/png", actualCostRub: "3.4" });
    expect(result.buffer).toEqual(Buffer.from(tinyPng, "base64"));
    expect(recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: "aitunnel", model: "seedream-4.5", operation: "image_generation" }));
    expect(recordCostEvent).toHaveBeenCalledWith(expect.objectContaining({ category: "image_search", provider: "aitunnel", unit: "image", rubCostAtEvent: "3.4" }));
  });

  it("rejects malformed data without a hidden retry or CostEvent", async () => {
    let calls = 0;
    vi.stubEnv("AITUNNEL_API_KEY", "test-aitunnel-key");
    vi.stubEnv("AITUNNEL_IMAGE_MODEL", "seedream-4.5");

    await expect(generateAitunnelImage("broken", {
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify({ data: [{ b64_json: "not-base64" }] }), { status: 200 });
      },
    })).rejects.toThrow(/malformed|invalid base64/);

    expect(calls).toBe(1);
    expect(recordAiUsage).not.toHaveBeenCalled();
    expect(recordCostEvent).not.toHaveBeenCalled();
  });

  it("treats provider HTTP errors as terminal after exactly one request", async () => {
    let calls = 0;
    vi.stubEnv("AITUNNEL_API_KEY", "test-aitunnel-key");
    vi.stubEnv("AITUNNEL_IMAGE_MODEL", "seedream-4.5");

    await expect(generateAitunnelImage("provider failure", {
      fetch: async () => {
        calls += 1;
        return new Response("upstream unavailable", { status: 503 });
      },
    })).rejects.toThrow("503");

    expect(calls).toBe(1);
    expect(recordCostEvent).not.toHaveBeenCalled();
  });

  it("strictly decodes padded and unpadded base64", () => {
    expect(decodeBase64Image(tinyPng)).toEqual(Buffer.from(tinyPng, "base64"));
    expect(decodeBase64Image(tinyPng.replace(/=+$/, ""))).toEqual(Buffer.from(tinyPng, "base64"));
    expect(() => decodeBase64Image("%%%bad%%%" )).toThrow(/invalid base64/);
  });
});

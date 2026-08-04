import { describe, expect, it } from "vitest";
import { AITUNNEL_DEFAULT_BASE_URL, aitunnelConfig, openAIClientOptions } from "./openai-client.js";

describe("openAIClientOptions", () => {
  it("uses an OpenAI-compatible gateway when configured", () => {
    expect(openAIClientOptions({
      OPENAI_API_KEY: "sk-aitunnel-test",
      OPENAI_BASE_URL: "https://api.aitunnel.ru/v1/",
    })).toEqual({
      apiKey: "sk-aitunnel-test",
      baseURL: "https://api.aitunnel.ru/v1/",
    });
  });

  it("keeps the official OpenAI default when no base URL is configured", () => {
    expect(openAIClientOptions({ OPENAI_API_KEY: "sk-test" })).toEqual({ apiKey: "sk-test" });
  });

  it("uses only the dedicated AITUNNEL key and rejects automatic model selection", () => {
    expect(aitunnelConfig({ OPENAI_API_KEY: "sk-openai", AITUNNEL_API_KEY: "aitunnel-key" })).toMatchObject({
      apiKey: "aitunnel-key",
      baseURL: AITUNNEL_DEFAULT_BASE_URL,
      narrationModel: "gpt-5.6-terra",
    });
    expect(aitunnelConfig({ AITUNNEL_API_KEY: "aitunnel-key", AITUNNEL_NARRATION_MODEL: "auto" })).toBeUndefined();
    expect(aitunnelConfig({ AITUNNEL_NARRATION_MODEL: "gpt-5.6-terra" })).toBeUndefined();
  });
});

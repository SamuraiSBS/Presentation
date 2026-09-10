import { describe, expect, it } from "vitest";
import { AITUNNEL_DEFAULT_BASE_URL, AITUNNEL_DEFAULT_REQUEST_TIMEOUT_MS, AITUNNEL_DEFAULT_SEARCH_MODEL, aitunnelConfig, aitunnelForcedIpv4, aitunnelRequestTimeoutMs, aitunnelSearchConfig, openAIClientOptions } from "./openai-client.js";

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
      narrationModel: "gpt-5.6-luna",
    });
    expect(aitunnelConfig({ AITUNNEL_API_KEY: "aitunnel-key", AITUNNEL_NARRATION_MODEL: "auto" })).toBeUndefined();
    expect(aitunnelConfig({ AITUNNEL_NARRATION_MODEL: "gpt-5.6-terra" })).toBeUndefined();
  });

  it("defaults the independent web-search model to the approved economy model", () => {
    expect(aitunnelSearchConfig({ AITUNNEL_API_KEY: "aitunnel-key" })).toEqual({
      apiKey: "aitunnel-key",
      baseURL: AITUNNEL_DEFAULT_BASE_URL,
      searchModel: AITUNNEL_DEFAULT_SEARCH_MODEL,
    });
    expect(aitunnelSearchConfig({ AITUNNEL_API_KEY: "aitunnel-key", AITUNNEL_SEARCH_MODEL: "auto" })).toBeUndefined();
  });

  it("bounds the dedicated AITUNNEL timeout", () => {
    expect(aitunnelRequestTimeoutMs({})).toBe(AITUNNEL_DEFAULT_REQUEST_TIMEOUT_MS);
    expect(aitunnelRequestTimeoutMs({ AITUNNEL_REQUEST_TIMEOUT_MS: "10000" })).toBe(30_000);
    expect(aitunnelRequestTimeoutMs({ AITUNNEL_REQUEST_TIMEOUT_MS: "120000" })).toBe(120_000);
    expect(aitunnelRequestTimeoutMs({ AITUNNEL_REQUEST_TIMEOUT_MS: "999999" })).toBe(180_000);
  });

  it("accepts only a literal IPv4 override for a verified AITUNNEL edge", () => {
    expect(aitunnelForcedIpv4({ AITUNNEL_FORCE_IPV4: "104.21.64.27" })).toBe("104.21.64.27");
    expect(aitunnelForcedIpv4({ AITUNNEL_FORCE_IPV4: "api.aitunnel.ru" })).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { calculateProviderCost, normalizeOpenAIUsage } from "./usage-ledger.js";

describe("usage ledger pricing", () => {
  it("calculates input, cached input, output and reasoning without floating point", () => {
    const result = calculateProviderCost("openai", "gpt-5.5", new Date("2026-07-11T12:00:00Z"), {
      inputTokens: 1_000_000,
      cachedInputTokens: 200_000,
      outputTokens: 100_000,
      reasoningTokens: 20_000,
    });
    expect(result.status).toBe("priced");
    expect(result.sourceCost).toBe("7.10000000");
  });

  it("keeps unknown models unknown instead of reporting zero", () => {
    expect(calculateProviderCost("openai", "future-model", new Date("2026-07-11T12:00:00Z"), { inputTokens: 10 }).status).toBe("unknown_price");
  });

  it("uses the current verified Yandex rates for Pro 5 and Lite 5", () => {
    const at = new Date("2026-07-20T12:00:00Z");
    expect(calculateProviderCost("yandex", "yandexgpt-5-pro", at, { inputTokens: 1_000, outputTokens: 2_000 })).toMatchObject({ status: "priced", sourceCost: "3.60000000", currency: "RUB" });
    expect(calculateProviderCost("yandex", "yandexgpt-5-lite", at, { inputTokens: 1_000, outputTokens: 2_000 })).toMatchObject({ status: "priced", sourceCost: "0.60000000", currency: "RUB" });
  });

  it("uses the separately verified synchronous rate for the explicit Pro 5.1 candidate", () => {
    const at = new Date("2026-07-23T12:00:00Z");
    expect(calculateProviderCost("yandex", "yandexgpt-5.1", at, { inputTokens: 1_000, outputTokens: 2_000 })).toMatchObject({ status: "priced", sourceCost: "2.40000000", currency: "RUB" });
  });

  it("normalizes AI SDK and Responses usage classes", () => {
    expect(normalizeOpenAIUsage({ inputTokens: 20, outputTokens: 9, totalTokens: 29, inputTokenDetails: { cacheReadTokens: 4 }, outputTokenDetails: { reasoningTokens: 2 } })).toEqual({ inputTokens: 20, outputTokens: 9, cachedInputTokens: 4, reasoningTokens: 2, totalTokens: 29 });
    expect(normalizeOpenAIUsage({ input_tokens: 11, output_tokens: 5, total_tokens: 16, input_tokens_details: { cached_tokens: 3 } })?.cachedInputTokens).toBe(3);
  });
});

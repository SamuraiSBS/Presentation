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

  it("normalizes AI SDK and Responses usage classes", () => {
    expect(normalizeOpenAIUsage({ inputTokens: 20, outputTokens: 9, totalTokens: 29, inputTokenDetails: { cacheReadTokens: 4 }, outputTokenDetails: { reasoningTokens: 2 } })).toEqual({ inputTokens: 20, outputTokens: 9, cachedInputTokens: 4, reasoningTokens: 2, totalTokens: 29 });
    expect(normalizeOpenAIUsage({ input_tokens: 11, output_tokens: 5, total_tokens: 16, input_tokens_details: { cached_tokens: 3 } })?.cachedInputTokens).toBe(3);
  });
});

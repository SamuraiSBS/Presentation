import { describe, expect, it } from "vitest";
import { AITUNNEL_APPROVED_MODELS, AITUNNEL_PROVIDER_CATALOG, COST_ENVELOPE_BUCKETS, COST_ENVELOPE_LIMIT_RUB, aitunnelCatalogSnapshot, costEnvelopePolicyIsValid, standardGenerationCostPolicy } from "@studydeck/shared";

describe("standard generation cost envelope policy", () => {
  it("has a fixed 17 RUB cap split across every paid path", () => {
    const policy = standardGenerationCostPolicy();
    expect(policy.limitRub).toBe(COST_ENVELOPE_LIMIT_RUB);
    expect(policy.buckets).toEqual(COST_ENVELOPE_BUCKETS);
    expect(policy.buckets.narrative_plan).toBe("0.75000000");
    expect(policy.buckets.narration_section_1_candidate).toBe("0.25000000");
    expect(policy.buckets.narration_section_1_fallback).toBe("1.20000000");
    expect(policy.buckets.narration_section_10_candidate).toBe("0.25000000");
    expect(policy.buckets.narration_section_10_fallback).toBe("1.20000000");
    expect(costEnvelopePolicyIsValid(policy)).toBe(true);
  });

  it("reserves all candidate and fallback section calls inside the fixed envelope", () => {
    const policy = standardGenerationCostPolicy();
    const candidates = Array.from({ length: 10 }, (_, index) => Number(policy.buckets[`narration_section_${index + 1}_candidate` as keyof typeof policy.buckets]));
    const fallbacks = Array.from({ length: 10 }, (_, index) => Number(policy.buckets[`narration_section_${index + 1}_fallback` as keyof typeof policy.buckets]));
    expect(candidates).toHaveLength(10);
    expect(fallbacks).toHaveLength(10);
    expect(candidates.reduce((sum, amount) => sum + amount, 0)).toBe(2.5);
    expect(fallbacks.reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(12, 8);
    expect(Object.values(policy.buckets).reduce((sum, amount) => sum + Number(amount), 0)).toBeCloseTo(17, 8);
  });

  it("stores only approved models in a deterministic provider snapshot", () => {
    const snapshot = aitunnelCatalogSnapshot();
    expect(snapshot.models.map((item) => item.model)).toEqual([...AITUNNEL_APPROVED_MODELS]);
    expect(snapshot.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "gemini-3.5-flash-lite", version: AITUNNEL_PROVIDER_CATALOG["gemini-3.5-flash-lite"].version }),
      expect.objectContaining({ model: "gemini-3.6-flash", version: AITUNNEL_PROVIDER_CATALOG["gemini-3.6-flash"].version }),
    ]));
  });
});

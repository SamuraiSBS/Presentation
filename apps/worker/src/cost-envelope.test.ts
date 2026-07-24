import { describe, expect, it } from "vitest";
import { AITUNNEL_APPROVED_MODELS, AITUNNEL_PROVIDER_CATALOG, COST_ENVELOPE_BUCKETS, COST_ENVELOPE_LIMIT_RUB, aitunnelCatalogSnapshot, costEnvelopePolicyIsValid, standardGenerationCostPolicy } from "@studydeck/shared";

describe("standard generation cost envelope policy", () => {
  it("has a fixed 10 RUB cap split across every paid path", () => {
    const policy = standardGenerationCostPolicy();
    expect(policy.limitRub).toBe(COST_ENVELOPE_LIMIT_RUB);
    expect(policy.buckets).toEqual(COST_ENVELOPE_BUCKETS);
    expect(policy.buckets.narration_candidate).toBe("1.50000000");
    expect(policy.buckets.narration_fallback).toBe("6.50000000");
    expect(costEnvelopePolicyIsValid(policy)).toBe(true);
  });

  it("keeps the one Lite candidate and one Flash fallback inside their reserved caps", () => {
    const policy = standardGenerationCostPolicy();
    // Regression values from the live run: candidate 0.9727 RUB, fallback
    // 6.20711 RUB. Together with the 0.5-RUB source search they remain under
    // the 10-RUB envelope and must be reservable before either provider call.
    expect(Number(policy.buckets.narration_candidate)).toBeGreaterThanOrEqual(0.9727);
    expect(Number(policy.buckets.narration_fallback)).toBeGreaterThanOrEqual(6.20711);
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

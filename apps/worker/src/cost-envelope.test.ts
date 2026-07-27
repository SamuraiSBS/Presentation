import { describe, expect, it } from "vitest";
import { AITUNNEL_APPROVED_MODELS, AITUNNEL_PROVIDER_CATALOG, COST_ENVELOPE_BUCKETS, COST_ENVELOPE_LIMIT_RUB, aitunnelCatalogSnapshot, costEnvelopePolicyIsValid, historicalStandardGenerationCostPolicyV5, standardGenerationCostPolicy } from "@studydeck/shared";

describe("standard generation cost envelope policy", () => {
  it("has the exact v6 20.00 RUB cap split across the bounded future paths", () => {
    const policy = standardGenerationCostPolicy();
    expect(policy.limitRub).toBe(COST_ENVELOPE_LIMIT_RUB);
    expect(policy.buckets).toEqual(COST_ENVELOPE_BUCKETS);
    expect(policy.buckets.narrative_plan).toBe("0.75000000");
    expect(policy.buckets.narration_full_candidate).toBe("2.50000000");
    expect(policy.buckets.narration_full_rewrite).toBe("14.10000000");
    expect(policy.buckets.narration_targeted_repair).toBe("0.90000000");
    expect(costEnvelopePolicyIsValid(policy)).toBe(true);
  });

  it("keeps v6 narration reservations at exactly 17.50 RUB within the 20.00 RUB hard cap", () => {
    const policy = standardGenerationCostPolicy();
    expect(Number(policy.buckets.narration_full_candidate) + Number(policy.buckets.narration_full_rewrite) + Number(policy.buckets.narration_targeted_repair)).toBeCloseTo(17.5, 8);
    expect(Object.values(policy.buckets).reduce((sum, amount) => sum + Number(amount), 0)).toBeCloseTo(20, 8);
  });

  it("continues to validate persisted v5 snapshots without treating them as v6", () => {
    const v5 = historicalStandardGenerationCostPolicyV5();
    expect(v5.version).toBe("standard-generation-cost-envelope-v5");
    expect(v5.limitRub).toBe("18.20000000");
    expect(v5.buckets.narration_global_rewrite).toBe("1.20000000");
    expect(costEnvelopePolicyIsValid(v5)).toBe(true);
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

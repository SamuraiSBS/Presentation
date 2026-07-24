import { describe, expect, it } from "vitest";
import { AITUNNEL_APPROVED_MODELS, AITUNNEL_PROVIDER_CATALOG, COST_ENVELOPE_BUCKETS, COST_ENVELOPE_LIMIT_RUB, aitunnelCatalogSnapshot, costEnvelopePolicyIsValid, standardGenerationCostPolicy } from "@studydeck/shared";

describe("standard generation cost envelope policy", () => {
  it("has a fixed 10 RUB cap split across every paid path", () => {
    const policy = standardGenerationCostPolicy();
    expect(policy.limitRub).toBe(COST_ENVELOPE_LIMIT_RUB);
    expect(policy.buckets).toEqual(COST_ENVELOPE_BUCKETS);
    expect(costEnvelopePolicyIsValid(policy)).toBe(true);
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

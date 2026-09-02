import { describe, expect, it, vi } from "vitest";
import { AITUNNEL_APPROVED_MODELS, AITUNNEL_PROVIDER_CATALOG, COST_ENVELOPE_BUCKETS, COST_ENVELOPE_LIMIT_RUB, aitunnelCatalogSnapshot, costEnvelopePolicyIsValid, historicalStandardGenerationCostPolicyV5, standardGenerationCostPolicy } from "@studydeck/shared";
import { reserveCostEnvelope } from "./cost-envelope.js";

const { prismaMock, transactionMock } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    costEnvelope: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    costEnvelopeReservation: { findUnique: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
  };
  return {
    prismaMock: { $transaction: vi.fn() },
    transactionMock: tx,
  };
});

vi.mock("./prisma.js", () => ({ getPrisma: () => prismaMock }));

describe("standard generation cost envelope policy", () => {
  it("has the exact v12 13.50 RUB cap with Luna presentation and raster-image generation", () => {
    const policy = standardGenerationCostPolicy();
    expect(policy.limitRub).toBe(COST_ENVELOPE_LIMIT_RUB);
    expect(policy.buckets).toEqual(COST_ENVELOPE_BUCKETS);
    expect(policy.buckets.narrative_plan).toBe("1.50000000");
    expect(policy.buckets.narration_full_candidate).toBe("1.00000000");
    expect(policy.buckets.narration_full_rewrite).toBe("1.50000000");
    expect(policy.buckets.narration_targeted_repair).toBe("0.75000000");
    expect(policy.buckets.presentation).toBe("2.10000000");
    expect(policy.buckets.images).toBe("2.00000000");
    expect(costEnvelopePolicyIsValid(policy)).toBe(true);
  });

  it("keeps narration reservations at exactly 3.25 RUB and includes all provider stages in the cap", () => {
    const policy = standardGenerationCostPolicy();
    expect(Number(policy.buckets.narration_full_candidate) + Number(policy.buckets.narration_full_rewrite) + Number(policy.buckets.narration_targeted_repair)).toBeCloseTo(3.25, 8);
    expect(Object.values(policy.buckets).reduce((sum, amount) => sum + Number(amount), 0)).toBeCloseTo(13.5, 8);
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
      expect.objectContaining({ model: "gpt-5.6-luna", version: AITUNNEL_PROVIDER_CATALOG["gpt-5.6-luna"].version }),
      expect.objectContaining({ model: "gpt-5.6-terra", version: AITUNNEL_PROVIDER_CATALOG["gpt-5.6-terra"].version }),
    ]));
  });

  it("atomically blocks a presentation reservation when persisted settled plus active reservations would exceed the inherited cap", async () => {
    const policy = standardGenerationCostPolicy();
    transactionMock.$queryRaw.mockResolvedValue([{ id: "inherited-envelope" }]);
    transactionMock.costEnvelope.findUnique.mockResolvedValue({
      id: "inherited-envelope",
      status: "active",
      limitRub: { toString: () => "12.00000000" },
      settledRub: { toString: () => "10.00000000" },
      reservedRub: { toString: () => "3.50000000" },
      policySnapshot: policy,
    });
    transactionMock.costEnvelopeReservation.findUnique.mockResolvedValue(null);
    transactionMock.costEnvelopeReservation.aggregate.mockResolvedValue({ _sum: { reservedRub: { toString: () => "0.00000000" } } });
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transactionMock) => unknown) => callback(transactionMock));

    await expect(reserveCostEnvelope({
      envelopeId: "inherited-envelope",
      idempotencyKey: "inherited-envelope:retry:presentation",
      bucket: "presentation",
      stage: "presentation",
      amountRub: "1.00000000",
    })).resolves.toEqual({ status: "blocked", reason: "envelope_exhausted" });

    expect(transactionMock.costEnvelopeReservation.create).not.toHaveBeenCalled();
    expect(transactionMock.costEnvelope.update).not.toHaveBeenCalled();
    expect(transactionMock.costEnvelope.create).not.toHaveBeenCalled();
    expect(Number("10.00000000") + Number("3.50000000") + Number("1.00000000")).toBeGreaterThan(Number("12.00000000"));
  });
});

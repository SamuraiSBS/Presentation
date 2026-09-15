import { afterEach, describe, expect, it, vi } from "vitest";
import { AITUNNEL_APPROVED_MODELS, AITUNNEL_PROVIDER_CATALOG, COST_ENVELOPE_BUCKETS, COST_ENVELOPE_LIMIT_RUB, aitunnelCatalogSnapshot, costEnvelopePolicyIsValid, historicalStandardGenerationCostPolicyV5, imageFirstEditableInitialCostPolicy, imageFirstEditableManualRegenerationCostPolicy, standardGenerationCostPolicy } from "@studydeck/shared";
import { completeCostEnvelope, reserveCostEnvelope, settleCostEnvelope, uncertainCostEnvelopeRub } from "./cost-envelope.js";

const { prismaMock, transactionMock } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    costEnvelope: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    costEnvelopeReservation: { findUnique: vi.fn(), findMany: vi.fn(), aggregate: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
  return {
    prismaMock: { $transaction: vi.fn() },
    transactionMock: tx,
  };
});

vi.mock("./prisma.js", () => ({ getPrisma: () => prismaMock }));

afterEach(() => vi.clearAllMocks());

describe("standard generation cost envelope policy", () => {
  it("has the exact v15 24.30 RUB cap with current Luna pricing and Flare image capacity", () => {
    const policy = standardGenerationCostPolicy();
    expect(policy.limitRub).toBe(COST_ENVELOPE_LIMIT_RUB);
    expect(policy.buckets).toEqual(COST_ENVELOPE_BUCKETS);
    expect(policy.buckets.narrative_plan).toBe("3.00000000");
    expect(policy.buckets.narration_full_candidate).toBe("2.00000000");
    expect(policy.buckets.narration_full_rewrite).toBe("3.00000000");
    expect(policy.buckets.narration_targeted_repair).toBe("1.50000000");
    expect(policy.buckets.sources).toBe("2.50000000");
    expect(policy.buckets.presentation).toBe("4.20000000");
    expect(AITUNNEL_PROVIDER_CATALOG["gpt-5.6-luna"]).toMatchObject({ inputRubPerMillion: "40", outputRubPerMillion: "240", version: "aitunnel-gpt-5.6-luna-pricing-2026-09-07", effectiveFrom: "2026-09-07T00:00:00.000Z" });
    expect(policy.buckets.images).toBe("2.55000000");
    expect(costEnvelopePolicyIsValid(policy)).toBe(true);
  });

  it("keeps all v15 narration reservations and provider stages inside the cap", () => {
    const policy = standardGenerationCostPolicy();
    expect(Number(policy.buckets.narration_full_candidate) + Number(policy.buckets.narration_full_rewrite) + Number(policy.buckets.narration_targeted_repair)).toBeCloseTo(6.5, 8);
    expect(Object.values(policy.buckets).reduce((sum, amount) => sum + Number(amount), 0)).toBeCloseTo(24.3, 8);
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

  it.each([[6, "7.00000000"], [8, "9.00000000"], [10, "11.00000000"], [12, "13.00000000"], [14, "15.00000000"]] as const)("models the image-first %i-slide initial cap as %s RUB", (count, cap) => {
    const policy = imageFirstEditableInitialCostPolicy(count);
    expect(policy.limitRub).toBe(cap);
    expect(Number(policy.buckets.source_search) + Number(policy.buckets.narration) + Number(policy.buckets.deck_content_lock)).toBeCloseTo(1, 8);
    expect(policy.buckets.images).toBe(`${count}.00000000`);
    expect(costEnvelopePolicyIsValid(policy)).toBe(true);
  });

  it("keeps the manual regeneration envelope isolated from the initial policy", () => {
    expect(imageFirstEditableManualRegenerationCostPolicy()).toMatchObject({ version: "image-first-editable-v1-manual-regeneration", limitRub: "1.00000000", buckets: { manual_regeneration: "1.00000000" } });
    expect(imageFirstEditableManualRegenerationCostPolicy().version).not.toBe(imageFirstEditableInitialCostPolicy(6).version);
  });

  it("counts the full reserve as uncertain until reconciliation", () => {
    expect(uncertainCostEnvelopeRub([
      { status: "settled", reservedRub: "0.20000000" },
      { status: "unknown_usage", reservedRub: "0.60000000" },
      { status: "provider_error", reservedRub: "1.00000000" },
    ])).toBe("1.60000000");
  });

  it("does not reopen a settled stage bucket for an automatic retry", async () => {
    const policy = imageFirstEditableInitialCostPolicy(6);
    transactionMock.$queryRaw.mockResolvedValue([{ id: "image-first-envelope" }]);
    transactionMock.costEnvelope.findUnique.mockResolvedValue({
      id: "image-first-envelope", status: "active", limitRub: { toString: () => policy.limitRub }, settledRub: { toString: () => "0.60000000" }, reservedRub: { toString: () => "0.00000000" }, policySnapshot: policy,
    });
    transactionMock.costEnvelopeReservation.findUnique.mockResolvedValue(null);
    transactionMock.costEnvelopeReservation.aggregate.mockResolvedValue({ _sum: { reservedRub: { toString: () => "0.60000000" } } });
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transactionMock) => unknown) => callback(transactionMock));

    await expect(reserveCostEnvelope({ envelopeId: "image-first-envelope", idempotencyKey: "retry", bucket: "deck_content_lock", stage: "image_first_editable_v1:deck_content_lock", amountRub: "0.60000000" }))
      .resolves.toEqual({ status: "blocked", reason: "bucket_exhausted" });
  });

  it("halts all later paid stages when a provider settlement is unknown", async () => {
    const policy = imageFirstEditableInitialCostPolicy(6);
    transactionMock.$queryRaw.mockResolvedValue([{ id: "unknown-usage-envelope" }]);
    transactionMock.costEnvelope.findUnique.mockResolvedValue({
      id: "unknown-usage-envelope", status: "active", limitRub: { toString: () => policy.limitRub }, settledRub: { toString: () => "0.00000000" }, reservedRub: { toString: () => "0.60000000" }, policySnapshot: policy,
    });
    transactionMock.costEnvelopeReservation.findUnique.mockResolvedValue({ id: "reservation-unknown", envelopeId: "unknown-usage-envelope", status: "reserved", reservedRub: "0.60000000" });
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transactionMock) => unknown) => callback(transactionMock));

    await expect(settleCostEnvelope({ envelopeId: "unknown-usage-envelope", idempotencyKey: "text-call", reason: "timeout" })).resolves.toEqual({ status: "unknown_usage" });
    expect(transactionMock.costEnvelope.update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "unknown-usage-envelope" }, data: { status: "exhausted" } }));

    transactionMock.costEnvelope.findUnique.mockResolvedValue({
      id: "unknown-usage-envelope", status: "exhausted", limitRub: { toString: () => policy.limitRub }, settledRub: { toString: () => "0.00000000" }, reservedRub: { toString: () => "0.60000000" }, policySnapshot: policy,
    });
    transactionMock.costEnvelopeReservation.findUnique.mockResolvedValue(null);
    await expect(reserveCostEnvelope({ envelopeId: "unknown-usage-envelope", idempotencyKey: "image-call", bucket: "images", stage: "image_first_editable_v1:image:1", amountRub: "1.00000000" }))
      .resolves.toEqual({ status: "blocked", reason: "envelope_exhausted" });
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

  it("does not complete an envelope while a reservation is unresolved", async () => {
    transactionMock.costEnvelope.findUnique.mockResolvedValue({
      id: "active-envelope",
      status: "active",
      reservedRub: { toString: () => "1.00000000" },
      settledRub: { toString: () => "0.00000000" },
      policySnapshot: standardGenerationCostPolicy(),
    });
    transactionMock.costEnvelopeReservation.findMany.mockResolvedValue([{ id: "reservation-1", status: "reserved" }]);
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transactionMock) => unknown) => callback(transactionMock));

    await expect(completeCostEnvelope({ envelopeId: "active-envelope" })).resolves.toEqual({
      status: "blocked",
      reason: "unresolved_reservations",
    });
    expect(transactionMock.costEnvelope.update).not.toHaveBeenCalled();
  });
});

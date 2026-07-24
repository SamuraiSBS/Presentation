import { beforeEach, describe, expect, it, vi } from "vitest";

const costEventUpsert = vi.fn();
const exchangeRateFindFirst = vi.fn();

vi.mock("./prisma.js", () => ({
  getPrisma: () => ({
    costEvent: { upsert: costEventUpsert },
    exchangeRate: { findFirst: exchangeRateFindFirst },
  }),
}));

const { calculateProviderCost, normalizeOpenAIUsage, recordCostEvent, runWithUsageContext } = await import("./usage-ledger.js");
const { logger } = await import("./observability.js");

describe("usage ledger pricing", () => {
  beforeEach(() => {
    costEventUpsert.mockReset().mockResolvedValue({ id: "cost-event-1" });
    exchangeRateFindFirst.mockReset().mockResolvedValue(null);
  });
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

  it("prices the explicit AITUNNEL Gemini model in RUB and leaves unknown models unknown", () => {
    const at = new Date("2026-07-24T12:00:00Z");
    expect(calculateProviderCost("aitunnel", "gemini-3.6-flash", at, { inputTokens: 1_000, outputTokens: 2_000 })).toMatchObject({ status: "priced", sourceCost: "5.00500000", currency: "RUB", version: "aitunnel-gemini-3.6-flash-pricing-2026-07-24" });
    expect(calculateProviderCost("aitunnel", "unknown", at, { inputTokens: 1_000 })).toMatchObject({ status: "unknown_price", sourceCost: null });
  });

  it("normalizes AI SDK and Responses usage classes", () => {
    expect(normalizeOpenAIUsage({ inputTokens: 20, outputTokens: 9, totalTokens: 29, inputTokenDetails: { cacheReadTokens: 4 }, outputTokenDetails: { reasoningTokens: 2 } })).toEqual({ inputTokens: 20, outputTokens: 9, cachedInputTokens: 4, reasoningTokens: 2, totalTokens: 29 });
    expect(normalizeOpenAIUsage({ input_tokens: 11, output_tokens: 5, total_tokens: 16, input_tokens_details: { cached_tokens: 3 } })?.cachedInputTokens).toBe(3);
  });

  it("persists nullable CostEvent fields as null for strict Prisma validation", async () => {
    await runWithUsageContext({ userId: "user-1", projectId: "project-1" }, () => recordCostEvent({
      idempotencyKey: "tavily-web-job-1",
      category: "web_search",
      provider: "tavily",
      quantity: "1",
      unit: "api_credit",
      currency: "USD",
      measurement: "calculated",
    }));

    expect(costEventUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { idempotencyKey: "tavily-web-job-1" },
      update: {},
      create: expect.objectContaining({
        userId: "user-1",
        projectId: "project-1",
        generationJobId: null,
        exportId: null,
        unitPrice: null,
        sourceCost: null,
        exchangeRateToRub: null,
        rubCostAtEvent: null,
      }),
    }));
  });

  it("treats an unset environment price as null instead of an invalid Decimal", async () => {
    await runWithUsageContext({ userId: "user-1", projectId: "project-1" }, () => recordCostEvent({
      idempotencyKey: "tavily-web-empty-price",
      category: "web_search",
      provider: "tavily",
      quantity: "1",
      unit: "api_credit",
      unitPrice: "  ",
      currency: "USD",
      measurement: "calculated",
    }));

    expect(costEventUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        unitPrice: null,
        sourceCost: null,
        exchangeRateToRub: null,
        rubCostAtEvent: null,
      }),
    }));
  });

  it("uses the same upsert key without changing already-recorded monetary values", async () => {
    const record = () => recordCostEvent({
      idempotencyKey: "tavily-web-job-1",
      category: "web_search",
      provider: "tavily",
      quantity: "1",
      unit: "api_credit",
      unitPrice: "0.008",
      currency: "USD",
      measurement: "calculated",
    });

    await runWithUsageContext({ userId: "user-1", projectId: "project-1", generationJobId: "generation-1" }, record);
    await runWithUsageContext({ userId: "user-1", projectId: "project-1", generationJobId: "generation-1" }, record);

    expect(costEventUpsert).toHaveBeenCalledTimes(2);
    expect(costEventUpsert.mock.calls.map(([value]) => value.where.idempotencyKey)).toEqual(["tavily-web-job-1", "tavily-web-job-1"]);
    expect(costEventUpsert.mock.calls.map(([value]) => value.update)).toEqual([{}, {}]);
  });

  it("calculates Tavily source and RUB costs without floating point when an exchange rate exists", async () => {
    exchangeRateFindFirst.mockResolvedValue({ rate: { toString: () => "90.5" } });

    await runWithUsageContext({ userId: "user-1", projectId: "project-1", generationJobId: "generation-1" }, () => recordCostEvent({
      idempotencyKey: "tavily-web-priced",
      category: "web_search",
      provider: "tavily",
      quantity: "3",
      unit: "api_credit",
      unitPrice: "0.008",
      currency: "USD",
      measurement: "calculated",
    }));

    expect(costEventUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        quantity: "3",
        unitPrice: "0.008",
        sourceCost: "0.02400000",
        exchangeRateToRub: "90.5",
        rubCostAtEvent: "2.17200000",
      }),
    }));
  });

  it("logs a Prisma rejection without failing the successful caller", async () => {
    const error = new Error("PrismaClientValidationError: invalid nullable field");
    costEventUpsert.mockRejectedValue(error);
    const logError = vi.spyOn(logger, "error").mockImplementation(() => logger);

    await expect(runWithUsageContext({ userId: "user-1", projectId: "project-1" }, () => recordCostEvent({
      idempotencyKey: "tavily-web-rejected",
      category: "web_search",
      provider: "tavily",
      quantity: "1",
      unit: "api_credit",
      currency: "USD",
      measurement: "calculated",
    }))).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledWith(expect.objectContaining({
      category: "web_search",
      provider: "tavily",
      errorName: "Error",
      errorMessage: "PrismaClientValidationError: invalid nullable field",
      prismaErrorMessage: "PrismaClientValidationError: invalid nullable field",
      hasUsageContext: true,
    }), "cost telemetry could not be persisted");
  });
});

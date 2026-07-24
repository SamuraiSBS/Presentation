import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { getPrisma } from "./prisma.js";
import { errorLogFields, logger, redactLogString } from "./observability.js";

export type UsageContext = {
  userId: string;
  projectId: string;
  generationJobId?: string;
  queueJobId?: string;
  stage?: string;
};

export type NormalizedUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
};

const context = new AsyncLocalStorage<UsageContext>();

export function runWithUsageContext<T>(value: UsageContext, callback: () => Promise<T>) {
  return context.run(value, callback);
}

export function currentUsageContext() { return context.getStore(); }

export async function recordAiUsage(input: {
  provider: "openai" | "yandex" | "aitunnel";
  model: string;
  operation: string;
  schemaName?: string;
  attempt?: number;
  providerRequestId?: string;
  usage?: NormalizedUsage;
  startedAt: Date;
  finishedAt?: Date;
  error?: unknown;
}) {
  const store = currentUsageContext();
  if (!store) return;
  const finishedAt = input.finishedAt || new Date();
  const usage = input.usage;
  const price = priceFor(input.provider, input.model, input.startedAt);
  const sourceCost = price && usage ? calculateCost(usage, price) : null;
  const exchangeRate = sourceCost ? await latestExchangeRate(price!.currency) : null;
  const status = input.error ? "failed" : !usage ? "unknown_usage" : !price ? "unknown_price" : "succeeded";
  const idempotencyKey = crypto.createHash("sha256").update([
    store.generationJobId || store.queueJobId || store.projectId,
    input.provider,
    input.operation,
    input.schemaName || "",
    String(input.attempt || 1),
    input.providerRequestId || input.startedAt.toISOString(),
  ].join(":" )).digest("hex");

  try {
    await getPrisma().aiUsageEvent.upsert({
      where: { idempotencyKey },
      update: {},
      create: {
        idempotencyKey,
        userId: store.userId,
        projectId: store.projectId,
        generationJobId: store.generationJobId,
        provider: input.provider,
        model: input.model,
        operation: input.operation,
        schemaName: input.schemaName,
        stage: store.stage,
        attempt: input.attempt || 1,
        providerRequestId: input.providerRequestId,
        status,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        cachedInputTokens: usage?.cachedInputTokens,
        reasoningTokens: usage?.reasoningTokens,
        totalTokens: usage?.totalTokens,
        durationMs: Math.max(0, finishedAt.getTime() - input.startedAt.getTime()),
        sourceCurrency: price?.currency,
        inputPricePerMillion: price?.input,
        outputPricePerMillion: price?.output,
        cachedPricePerMillion: price?.cached,
        reasoningPricePerMillion: price?.reasoning,
        sourceCost,
        exchangeRateToRub: exchangeRate,
        rubCostAtEvent: sourceCost && exchangeRate ? multiply(sourceCost, exchangeRate) : null,
        pricingVersion: price?.version,
        priceEffectiveFrom: price?.effectiveFrom,
        errorClass: input.error instanceof Error ? input.error.name : input.error ? typeof input.error : undefined,
        startedAt: input.startedAt,
        finishedAt,
      },
    });
  } catch (error) {
    logger.error({ ...errorLogFields(error), provider: input.provider, operation: input.operation }, "AI usage telemetry could not be persisted");
  }
}

export async function recordCostEvent(input: {
  idempotencyKey: string;
  category: "web_search" | "image_search" | "storage" | "export_compute" | "payment_fee" | "other";
  provider: string;
  quantity: string;
  unit: string;
  unitPrice?: string;
  currency: string;
  measurement: "provider_reported" | "calculated";
  occurredAt?: Date;
  exportId?: string;
}) {
  const store = currentUsageContext();
  if (!store) return;
  // Environment variables use an empty string for an unset value. Prisma's
  // Decimal parser rejects that value, while the CostEvent contract requires
  // unknown prices to be recorded as null.
  const unitPrice = optionalDecimal(input.unitPrice);
  const sourceCost = unitPrice ? multiply(input.quantity, unitPrice) : null;
  const exchangeRate = sourceCost ? await latestExchangeRate(input.currency) : null;
  try {
    await getPrisma().costEvent.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        idempotencyKey: input.idempotencyKey,
        category: input.category,
        userId: store.userId,
        projectId: store.projectId,
        // Prisma nullable scalar fields must be represented as null, not an
        // omitted/undefined value. This keeps telemetry valid for the web
        // search and image-search contexts, which do not have an export id.
        generationJobId: store.generationJobId ?? null,
        exportId: input.exportId ?? null,
        provider: input.provider,
        quantity: input.quantity,
        unit: input.unit,
        unitPrice,
        sourceCurrency: input.currency,
        sourceCost,
        exchangeRateToRub: exchangeRate,
        rubCostAtEvent: sourceCost && exchangeRate ? multiply(sourceCost, exchangeRate) : null,
        measurement: input.measurement,
        pricingVersion: "env-catalog-2026-07-11",
        occurredAt: input.occurredAt || new Date(),
      },
    });
  } catch (error) {
    // Prisma's standard error field is deliberately short for general logs.
    // Cost telemetry needs the complete, redacted validation cause to be
    // diagnosable without exposing prompts, source content, or credentials.
    const prismaErrorMessage = redactLogString(
      error instanceof Error ? error.message : String(error || "Unknown error"),
      5000,
    );
    logger.error({
      ...errorLogFields(error),
      prismaErrorMessage,
      category: input.category,
      provider: input.provider,
      hasUsageContext: Boolean(store),
    }, "cost telemetry could not be persisted");
  }
}

export function normalizeOpenAIUsage(value: unknown): NormalizedUsage | undefined {
  const usage = record(value);
  if (!usage) return undefined;
  const inputDetails = record(usage.inputTokenDetails || usage.input_tokens_details);
  const outputDetails = record(usage.outputTokenDetails || usage.output_tokens_details);
  const normalized = {
    inputTokens: integer(usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens),
    outputTokens: integer(usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens),
    cachedInputTokens: integer(inputDetails?.cacheReadTokens ?? inputDetails?.cached_tokens),
    reasoningTokens: integer(outputDetails?.reasoningTokens ?? outputDetails?.reasoning_tokens),
    totalTokens: integer(usage.totalTokens ?? usage.total_tokens),
  };
  return Object.values(normalized).some((item) => item !== undefined) ? normalized : undefined;
}

type Price = { input: string; output: string; cached?: string; reasoning?: string; currency: string; version: string; effectiveFrom: Date };
function priceFor(provider: string, model: string, at: Date): Price | null {
  const openAI: Record<string, Price> = {
    "gpt-5.5": { input: "5", cached: "0.5", output: "30", currency: "USD", version: "openai-model-page-2026-07-11", effectiveFrom: new Date("2026-07-11T00:00:00Z") },
    "gpt-5": { input: "1.25", cached: "0.125", output: "10", currency: "USD", version: "openai-model-page-2026-07-11", effectiveFrom: new Date("2026-07-11T00:00:00Z") },
  };
  if (provider === "openai") {
    const price = openAI[model];
    return price && price.effectiveFrom <= at ? price : null;
  }
  const yandexCurrent: Record<string, Price> = {
    // Synchronous RUB rates, including VAT. The legacy yandexgpt/latest alias
    // resolves to Pro 5 during its supported lifetime.
    "yandexgpt": yandexPrice("1200", "yandex-ai-studio-pricing-2026-07-20"),
    "yandexgpt-5-pro": yandexPrice("1200", "yandex-ai-studio-pricing-2026-07-20"),
    "yandexgpt-5.1": yandexPrice("800", "yandex-ai-studio-pricing-2026-07-23"),
    "yandexgpt-5-lite": yandexPrice("200", "yandex-ai-studio-pricing-2026-07-20"),
  };
  const catalogPrice = yandexCurrent[model.trim().toLowerCase()];
  if (catalogPrice && catalogPrice.effectiveFrom <= at) return catalogPrice;

  if (provider === "aitunnel" && model.trim().toLowerCase() === "gemini-3.6-flash") {
    return { input: "455", output: "2275", currency: "RUB", version: "aitunnel-gemini-3.6-flash-pricing-2026-07-24", effectiveFrom: new Date("2026-07-24T00:00:00Z") };
  }

  const input = process.env.YANDEX_INPUT_PRICE_RUB_PER_MILLION;
  const output = process.env.YANDEX_OUTPUT_PRICE_RUB_PER_MILLION;
  if (!input || !output) return null;
  return { input, output, currency: "RUB", version: process.env.YANDEX_PRICING_VERSION || "env", effectiveFrom: new Date(process.env.YANDEX_PRICE_EFFECTIVE_FROM || "2026-07-11T00:00:00Z") };
}

function yandexPrice(rate: string, version: string): Price {
  return { input: rate, cached: rate, output: rate, currency: "RUB", version, effectiveFrom: new Date("2026-05-01T00:00:00Z") };
}

export function calculateProviderCost(provider: "openai" | "yandex" | "aitunnel", model: string, at: Date, usage: NormalizedUsage) {
  const price = priceFor(provider, model, at);
  return price ? { status: "priced" as const, sourceCost: calculateCost(usage, price), currency: price.currency, version: price.version } : { status: "unknown_price" as const, sourceCost: null, currency: null, version: null };
}

function calculateCost(usage: NormalizedUsage, price: Price) {
  const regularInput = Math.max(0, (usage.inputTokens || 0) - (usage.cachedInputTokens || 0));
  const output = Math.max(0, (usage.outputTokens || 0) - (usage.reasoningTokens || 0));
  const micros = BigInt(regularInput) * toScaled(price.input)
    + BigInt(usage.cachedInputTokens || 0) * toScaled(price.cached || price.input)
    + BigInt(output) * toScaled(price.output)
    + BigInt(usage.reasoningTokens || 0) * toScaled(price.reasoning || price.output);
  return scaledToString(micros / 1_000_000n);
}

async function latestExchangeRate(currency: string) {
  if (currency === "RUB") return "1";
  const item = await getPrisma().exchangeRate.findFirst({ where: { baseCurrency: currency, quoteCurrency: "RUB" }, orderBy: { effectiveAt: "desc" } });
  return item?.rate.toString() || null;
}

function multiply(left: string, right: string) { return scaledToString((toScaled(left) * toScaled(right)) / 100_000_000n); }
function optionalDecimal(value: string | undefined) { const normalized = value?.trim(); return normalized || null; }
function toScaled(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(`${whole || "0"}${fraction.padEnd(8, "0").slice(0, 8)}`); }
function scaledToString(value: bigint) { const text = value.toString().padStart(9, "0"); return `${text.slice(0, -8)}.${text.slice(-8)}`; }
function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function integer(value: unknown) { const result = Number(value); return Number.isFinite(result) && result >= 0 ? Math.trunc(result) : undefined; }

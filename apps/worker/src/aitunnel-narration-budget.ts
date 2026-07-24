import { getRussianStudentSpeechTimingBudget } from "@studydeck/shared";

type EnvLike = Record<string, string | undefined>;

export const AITUNNEL_NARRATION_PRICE = {
  inputRubPerMillion: "455",
  outputRubPerMillion: "2275",
  version: "aitunnel-gemini-3.6-flash-pricing-2026-07-24",
} as const;

export const AITUNNEL_NARRATION_DEFAULT_BUDGET_RUB = 20;
export const AITUNNEL_NARRATION_DEFAULT_MAX_OUTPUT_TOKENS = 2400;
export const AITUNNEL_NARRATION_MIN_OUTPUT_TOKENS = 2400;
export const AITUNNEL_NARRATION_DEFAULT_REASONING_EFFORT = "minimal";

export type AitunnelNarrationReasoningEffort = "minimal" | "low" | "medium" | "high";
export type AitunnelNarrationBudgetConfig = {
  budgetRub: string;
  maxOutputTokens: number;
  reasoningEffort: AitunnelNarrationReasoningEffort;
};

export type AitunnelNarrationUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
};

export type NarrationReservation = {
  inputTokens: number;
  outputTokens: number;
  costRub: string;
};

const SCALE = 100_000_000n;
const MILLION = 1_000_000n;
const INPUT_TOKEN_BYTES = 2;
const INPUT_TOKEN_SAFETY_PERCENT = 15;

/**
 * The 10-slide university-student contract requires 1170 spoken words. At a
 * conservative two tokens per Russian word, it needs 2340 output tokens; the
 * fixed 2400-token floor leaves a small header/punctuation margin.
 */
export function minimumOutputTokensForNarration(project?: { level: string; slideCount: number; scenario: string }) {
  const timing = project ? getRussianStudentSpeechTimingBudget(project) : undefined;
  return Math.max(AITUNNEL_NARRATION_MIN_OUTPUT_TOKENS, timing ? timing.minWords * 2 : 0);
}

export function aitunnelNarrationBudgetConfig(env: EnvLike = process.env): AitunnelNarrationBudgetConfig {
  const budget = positiveDecimal(env.AITUNNEL_NARRATION_JOB_BUDGET_RUB) || String(AITUNNEL_NARRATION_DEFAULT_BUDGET_RUB);
  const configuredOutput = positiveInteger(env.AITUNNEL_NARRATION_MAX_OUTPUT_TOKENS) || AITUNNEL_NARRATION_DEFAULT_MAX_OUTPUT_TOKENS;
  const reasoning = env.AITUNNEL_NARRATION_REASONING_EFFORT?.trim().toLowerCase();
  const reasoningEffort: AitunnelNarrationReasoningEffort = reasoning === "low" || reasoning === "medium" || reasoning === "high" || reasoning === "minimal"
    ? reasoning
    : AITUNNEL_NARRATION_DEFAULT_REASONING_EFFORT;

  return {
    budgetRub: budget,
    maxOutputTokens: Math.max(configuredOutput, AITUNNEL_NARRATION_MIN_OUTPUT_TOKENS),
    reasoningEffort,
  };
}

/** Local upper estimate over serialized UTF-8 request bytes; it never calls a provider. */
export function estimateInputTokens(payload: unknown) {
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  return Math.ceil(Math.ceil(bytes / INPUT_TOKEN_BYTES) * (100 + INPUT_TOKEN_SAFETY_PERCENT) / 100);
}

export function reserveNarrationCall(input: { estimatedInputTokens: number; maxOutputTokens: number }) : NarrationReservation {
  const inputTokens = nonNegativeInteger(input.estimatedInputTokens);
  const outputTokens = nonNegativeInteger(input.maxOutputTokens);
  return { inputTokens, outputTokens, costRub: costRub(inputTokens, outputTokens) };
}

export function canStartCall(input: { remainingBudgetRub: string; reservation: NarrationReservation }) {
  return decimalToScaled(input.remainingBudgetRub) >= decimalToScaled(input.reservation.costRub);
}

export function settleCall(input: { reservation: NarrationReservation; actualUsage?: AitunnelNarrationUsage }) {
  const usage = input.actualUsage;
  if (!usage || !isTokenCount(usage.inputTokens) || !isTokenCount(usage.outputTokens)) {
    return { status: "usage_unavailable" as const };
  }
  const actualCostRub = costRub(usage.inputTokens, usage.outputTokens);
  return {
    status: "settled" as const,
    actualCostRub,
    overrun: decimalToScaled(actualCostRub) > decimalToScaled(input.reservation.costRub),
  };
}

export function remainingBudget(budgetRub: string, settledCostRub: string) {
  return scaledToDecimal(decimalToScaled(budgetRub) - decimalToScaled(settledCostRub));
}

function costRub(inputTokens: number, outputTokens: number) {
  const total = BigInt(inputTokens) * decimalToScaled(AITUNNEL_NARRATION_PRICE.inputRubPerMillion)
    + BigInt(outputTokens) * decimalToScaled(AITUNNEL_NARRATION_PRICE.outputRubPerMillion);
  return scaledToDecimal(total / MILLION);
}

function positiveDecimal(value: string | undefined) {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return undefined;
  return decimalToScaled(value) > 0n ? value.trim() : undefined;
}

function positiveInteger(value: string | undefined) {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decimalToScaled(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const normalized = `${fraction}00000000`.slice(0, 8);
  return BigInt(whole) * SCALE + BigInt(normalized);
}

function scaledToDecimal(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(8, "0")}`;
}

import { AsyncLocalStorage } from "node:async_hooks";
import { getRussianStudentSpeechTimingBudget } from "@studydeck/shared";
import { AITUNNEL_PROVIDER_CATALOG, aitunnelPriceForApprovedModel } from "./aitunnel-provider-catalog.js";

type EnvLike = Record<string, string | undefined>;

export const AITUNNEL_ECONOMY_PRICE = AITUNNEL_PROVIDER_CATALOG["gemini-3.5-flash-lite"];
export const AITUNNEL_PRIMARY_PRICE = AITUNNEL_PROVIDER_CATALOG["gemini-3.6-flash"];
// Kept for compatibility with the Lite-only section route.
export const AITUNNEL_NARRATION_PRICE = AITUNNEL_ECONOMY_PRICE;
export const AITUNNEL_NARRATION_DEFAULT_BUDGET_RUB = 10;
export const AITUNNEL_PROJECT_DEFAULT_BUDGET_RUB = 10;
// 384 tokens covers the largest shared 140-word role target with room for
// Russian punctuation and the required slide heading; it is not the old
// 1350-token Flash ceiling.
export const AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS = 384;
/**
 * The existing 384-token allowance for a 140-word Russian content section
 * gives a conservative 2.743 tokens/word baseline for this provider route.
 * A 1,560-word full speech needs 4,279 tokens at that rate. Ten headings
 * plus response/schema framing need another 204 tokens, so 4,483 is the
 * minimum safe ceiling. Keep the existing 4,500 cap rather than shaving it.
 */
export const AITUNNEL_FULL_NARRATION_MIN_SAFE_OUTPUT_TOKENS = 4483;
export const AITUNNEL_NARRATION_FULL_CANDIDATE_MAX_OUTPUT_TOKENS = 4500;
export const AITUNNEL_NARRATION_FULL_REWRITE_MAX_OUTPUT_TOKENS = 4500;
// Three maximum 156-word sections need 1,284 tokens at the established
// 384/140 Russian baseline. Leave 116 tokens for the JSON map, headings and
// punctuation rather than making the three-section repair route nominal only.
export const AITUNNEL_NARRATION_TARGETED_REPAIR_MAX_OUTPUT_TOKENS = 1400;
export const AITUNNEL_NARRATION_DEFAULT_REASONING_EFFORT = "minimal";
export const AITUNNEL_ECONOMY_MODEL = "gemini-3.5-flash-lite";
export const AITUNNEL_PRIMARY_MODEL = "gemini-3.6-flash";

type AitunnelNarrationSlideOrder = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type AitunnelNarrationCandidateStage = `narration_section_${AitunnelNarrationSlideOrder}_candidate`;
export type AitunnelNarrationFallbackStage = `narration_section_${AitunnelNarrationSlideOrder}_fallback`;
export type AitunnelNarrationGlobalRewriteStage = "narration_global_rewrite";
export type AitunnelNarrationSectionStage = AitunnelNarrationCandidateStage | AitunnelNarrationFallbackStage | AitunnelNarrationGlobalRewriteStage;
export type AitunnelFullNarrationStage = "narration_full_candidate" | "narration_full_rewrite" | "narration_targeted_repair";
export type AitunnelStage = "narrative_plan" | "design_brief" | "quality_critique" | AitunnelNarrationSectionStage | AitunnelFullNarrationStage | "narration" | "narration_rewrite" | "presentation" | "slide_text_repair" | "quality_repair";
export type AitunnelNarrationReasoningEffort = "minimal" | "low" | "medium" | "high";
export type AitunnelNarrationBudgetConfig = { budgetRub: string; maxOutputTokens: number; reasoningEffort: AitunnelNarrationReasoningEffort };
export type AitunnelNarrationUsage = { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
export type NarrationReservation = { inputTokens: number; outputTokens: number; costRub: string };

const STAGE_POLICIES: Record<AitunnelStage, { model: "economy" | "primary"; maxOutputTokens: number; reasoningEffort: "minimal" }> = {
  narrative_plan: { model: "economy", maxOutputTokens: 1200, reasoningEffort: "minimal" },
  design_brief: { model: "economy", maxOutputTokens: 1200, reasoningEffort: "minimal" },
  quality_critique: { model: "economy", maxOutputTokens: 800, reasoningEffort: "minimal" },
  narration_section_1_candidate: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" }, narration_section_1_fallback: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_section_2_candidate: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" }, narration_section_2_fallback: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_section_3_candidate: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" }, narration_section_3_fallback: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_section_4_candidate: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" }, narration_section_4_fallback: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_section_5_candidate: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" }, narration_section_5_fallback: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_section_6_candidate: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" }, narration_section_6_fallback: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_section_7_candidate: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" }, narration_section_7_fallback: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_section_8_candidate: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" }, narration_section_8_fallback: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_section_9_candidate: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" }, narration_section_9_fallback: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_section_10_candidate: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" }, narration_section_10_fallback: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_global_rewrite: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  // These are the only narration stages for future v6 envelopes. The
  // section-route stages above stay typed temporarily so historical v5 jobs
  // and their snapshots are never reinterpreted during the staged rollout.
  narration_full_candidate: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_FULL_CANDIDATE_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_full_rewrite: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_FULL_REWRITE_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_targeted_repair: { model: "economy", maxOutputTokens: AITUNNEL_NARRATION_TARGETED_REPAIR_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration: { model: "primary", maxOutputTokens: 2400, reasoningEffort: "minimal" },
  narration_rewrite: { model: "primary", maxOutputTokens: 2400, reasoningEffort: "minimal" },
  presentation: { model: "primary", maxOutputTokens: 6000, reasoningEffort: "minimal" },
  slide_text_repair: { model: "primary", maxOutputTokens: 2400, reasoningEffort: "minimal" },
  quality_repair: { model: "primary", maxOutputTokens: 3600, reasoningEffort: "minimal" },
};
const SCALE = 100_000_000n;
const MILLION = 1_000_000n;
const INPUT_TOKEN_BYTES = 2;
// The generic byte estimator is deliberately pessimistic for arbitrary JSON.
// A complete Russian speech is a known natural-language payload: 4 bytes with
// the existing 15% margin yields an effective 3.48 bytes/token, still more
// conservative than the established 384/140 Russian section allocation.
const FULL_NARRATION_INPUT_TOKEN_BYTES = 4;
const INPUT_TOKEN_SAFETY_PERCENT = 15;

export function aitunnelModelForStage(stage: AitunnelStage, env: EnvLike = process.env) {
  return STAGE_POLICIES[stage].model === "economy" ? aitunnelEconomyModel(env) : AITUNNEL_PRIMARY_MODEL;
}
export function aitunnelEconomyModel(env: EnvLike = process.env) {
  const value = env.AITUNNEL_ECONOMY_MODEL === undefined ? AITUNNEL_ECONOMY_MODEL : env.AITUNNEL_ECONOMY_MODEL.trim();
  return value === AITUNNEL_ECONOMY_MODEL ? value : undefined;
}
export function aitunnelStagePolicy(stage: AitunnelStage, env: EnvLike = process.env) {
  const base = STAGE_POLICIES[stage];
  const narration = aitunnelNarrationBudgetConfig(env);
  const isSection = stage.startsWith("narration_section_") || stage === "narration_global_rewrite";
  const isFutureFullNarration = stage === "narration_full_candidate" || stage === "narration_full_rewrite" || stage === "narration_targeted_repair";
  const narrationOutputTokens = isSection ? AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS : narration.maxOutputTokens;
  return { model: aitunnelModelForStage(stage, env), maxOutputTokens: isFutureFullNarration ? base.maxOutputTokens : isSection || stage === "narration" || stage === "narration_rewrite" ? narrationOutputTokens : base.maxOutputTokens, reasoningEffort: isSection || isFutureFullNarration || stage === "narration" || stage === "narration_rewrite" ? narration.reasoningEffort : base.reasoningEffort };
}
export function aitunnelPriceForModel(model: string) {
  return aitunnelPriceForApprovedModel(model);
}
export function minimumOutputTokensForNarration(_project?: { level: string; slideCount: number; scenario: string }) { return AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS; }
export function aitunnelNarrationBudgetConfig(env: EnvLike = process.env): AitunnelNarrationBudgetConfig {
  const budget = positiveDecimal(env.AITUNNEL_NARRATION_JOB_BUDGET_RUB) || String(AITUNNEL_NARRATION_DEFAULT_BUDGET_RUB);
  const reasoning = env.AITUNNEL_NARRATION_REASONING_EFFORT?.trim().toLowerCase();
  return { budgetRub: budget, maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: reasoning === "low" || reasoning === "medium" || reasoning === "high" || reasoning === "minimal" ? reasoning : AITUNNEL_NARRATION_DEFAULT_REASONING_EFFORT };
}
export function aitunnelProjectBudgetConfig(env: EnvLike = process.env) { return { projectBudgetRub: positiveDecimal(env.AITUNNEL_PROJECT_BUDGET_RUB) || String(AITUNNEL_PROJECT_DEFAULT_BUDGET_RUB), narrationBudgetRub: aitunnelNarrationBudgetConfig(env).budgetRub }; }
export function estimateInputTokens(payload: unknown) { return estimateInputTokensWithBytes(payload, INPUT_TOKEN_BYTES); }
export function reserveNarrationCall(input: { estimatedInputTokens: number; maxOutputTokens: number }): NarrationReservation { const inputTokens = nonNegativeInteger(input.estimatedInputTokens); const outputTokens = nonNegativeInteger(input.maxOutputTokens); return { inputTokens, outputTokens, costRub: costRub(inputTokens, outputTokens, AITUNNEL_ECONOMY_PRICE) }; }
export function reserveAitunnelStageCall(stage: AitunnelStage, request: unknown, env: EnvLike = process.env): NarrationReservation | undefined {
  const policy = aitunnelStagePolicy(stage, env);
  const price = policy.model && aitunnelPriceForModel(policy.model);
  return price ? reserveForPrice(estimateInputTokensForStage(stage, request), policy.maxOutputTokens, price) : undefined;
}
export function canStartCall(input: { remainingBudgetRub: string; reservation: NarrationReservation }) { return decimalToScaled(input.remainingBudgetRub) >= decimalToScaled(input.reservation.costRub); }
export function settleCall(input: { reservation: NarrationReservation; actualUsage?: AitunnelNarrationUsage }) { const usage = input.actualUsage; if (!usage || !isTokenCount(usage.inputTokens) || !isTokenCount(usage.outputTokens)) return { status: "usage_unavailable" as const }; const actualCostRub = costRub(usage.inputTokens, usage.outputTokens, AITUNNEL_NARRATION_PRICE); return { status: "settled" as const, actualCostRub, overrun: decimalToScaled(actualCostRub) > decimalToScaled(input.reservation.costRub) }; }
export function remainingBudget(budgetRub: string, settledCostRub: string) { return scaledToDecimal(decimalToScaled(budgetRub) - decimalToScaled(settledCostRub)); }

export class AitunnelProjectBudget {
  private readonly config: ReturnType<typeof aitunnelProjectBudgetConfig>;
  private readonly reservations = new Map<string, { stage: AitunnelStage; reservation: NarrationReservation }>();
  private projectSettled = "0";
  private narrationSettled = "0";
  private blocked = false;
  constructor(env: EnvLike = process.env) { this.config = aitunnelProjectBudgetConfig(env); }
  reserve(key: string, stage: AitunnelStage, request: unknown, env: EnvLike = process.env) {
    if (this.blocked) return { status: "aitunnel_project_budget_overrun" as const };
    const policy = aitunnelStagePolicy(stage, env);
    if (!policy.model || !aitunnelPriceForModel(policy.model)) return { status: "aitunnel_price_unavailable" as const };
    const reservation = reserveForPrice(estimateInputTokensForStage(stage, request), policy.maxOutputTokens, aitunnelPriceForModel(policy.model)!);
    const projectRemaining = remainingBudget(this.config.projectBudgetRub, this.projectSettled);
    if (!canStartCall({ remainingBudgetRub: projectRemaining, reservation })) return { status: "aitunnel_project_budget_exhausted_preflight" as const, reservation, projectRemaining };
    if (stage.startsWith("narration_section_") || stage === "narration_global_rewrite" || stage === "narration_full_candidate" || stage === "narration_full_rewrite" || stage === "narration_targeted_repair" || stage === "narration" || stage === "narration_rewrite") {
      const narrationRemaining = remainingBudget(this.config.narrationBudgetRub, this.narrationSettled);
      if (!canStartCall({ remainingBudgetRub: narrationRemaining, reservation })) return { status: "aitunnel_narration_budget_exhausted_preflight" as const, reservation, projectRemaining, narrationRemaining };
    }
    this.reservations.set(key, { stage, reservation });
    return { status: "reserved" as const, reservation, model: policy.model, maxOutputTokens: policy.maxOutputTokens, reasoningEffort: policy.reasoningEffort, projectRemaining, narrationRemaining: remainingBudget(this.config.narrationBudgetRub, this.narrationSettled) };
  }
  settle(key: string, usage?: AitunnelNarrationUsage) {
    const active = this.reservations.get(key);
    if (!active || !usage || !isTokenCount(usage.inputTokens) || !isTokenCount(usage.outputTokens)) { this.blocked = true; return { status: "aitunnel_usage_unavailable" as const }; }
    this.reservations.delete(key);
    const model = STAGE_POLICIES[active.stage].model === "economy" ? AITUNNEL_ECONOMY_MODEL : AITUNNEL_PRIMARY_MODEL;
    const actualCostRub = costRub(usage.inputTokens, usage.outputTokens, aitunnelPriceForModel(model)!);
    this.projectSettled = add(this.projectSettled, actualCostRub);
    if (active.stage.startsWith("narration_section_") || active.stage === "narration_global_rewrite" || active.stage === "narration_full_candidate" || active.stage === "narration_full_rewrite" || active.stage === "narration_targeted_repair" || active.stage === "narration" || active.stage === "narration_rewrite") this.narrationSettled = add(this.narrationSettled, actualCostRub);
    const overrun = decimalToScaled(actualCostRub) > decimalToScaled(active.reservation.costRub) || decimalToScaled(this.projectSettled) > decimalToScaled(this.config.projectBudgetRub) || decimalToScaled(this.narrationSettled) > decimalToScaled(this.config.narrationBudgetRub);
    if (overrun) this.blocked = true;
    return { status: overrun ? "aitunnel_project_budget_overrun" as const : "settled" as const, actualCostRub, reservation: active.reservation, projectRemaining: remainingBudget(this.config.projectBudgetRub, this.projectSettled), narrationRemaining: remainingBudget(this.config.narrationBudgetRub, this.narrationSettled) };
  }
}
const budgetContext = new AsyncLocalStorage<AitunnelProjectBudget>();
export function runWithAitunnelProjectBudget<T>(budget: AitunnelProjectBudget, callback: () => Promise<T>) { return budgetContext.run(budget, callback); }
export function currentAitunnelProjectBudget() { return budgetContext.getStore(); }

function reserveForPrice(inputTokens: number, outputTokens: number, price: typeof AITUNNEL_NARRATION_PRICE | typeof AITUNNEL_ECONOMY_PRICE): NarrationReservation { return { inputTokens, outputTokens, costRub: costRub(inputTokens, outputTokens, price) }; }
function estimateInputTokensForStage(stage: AitunnelStage, payload: unknown) { return isFullNarrationStage(stage) ? estimateInputTokensWithBytes(payload, FULL_NARRATION_INPUT_TOKEN_BYTES) : estimateInputTokens(payload); }
function isFullNarrationStage(stage: AitunnelStage): stage is AitunnelFullNarrationStage { return stage === "narration_full_candidate" || stage === "narration_full_rewrite" || stage === "narration_targeted_repair"; }
function estimateInputTokensWithBytes(payload: unknown, bytesPerToken: number) { const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8"); return Math.ceil(Math.ceil(bytes / bytesPerToken) * (100 + INPUT_TOKEN_SAFETY_PERCENT) / 100); }
function costRub(inputTokens: number, outputTokens: number, price: typeof AITUNNEL_NARRATION_PRICE | typeof AITUNNEL_ECONOMY_PRICE) { const total = BigInt(inputTokens) * decimalToScaled(price.inputRubPerMillion) + BigInt(outputTokens) * decimalToScaled(price.outputRubPerMillion); return scaledToDecimal(total / MILLION); }
function positiveDecimal(value: string | undefined) { if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return undefined; return decimalToScaled(value) > 0n ? value.trim() : undefined; }
function positiveInteger(value: string | undefined) { if (!value || !/^\d+$/.test(value.trim())) return undefined; const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined; }
function nonNegativeInteger(value: number) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function isTokenCount(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function decimalToScaled(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * SCALE + BigInt(`${fraction}00000000`.slice(0, 8)); }
function scaledToDecimal(value: bigint) { const sign = value < 0n ? "-" : ""; const absolute = value < 0n ? -value : value; return `${sign}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(8, "0")}`; }
function add(left: string, right: string) { return scaledToDecimal(decimalToScaled(left) + decimalToScaled(right)); }

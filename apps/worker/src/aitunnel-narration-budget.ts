import { AsyncLocalStorage } from "node:async_hooks";
import { getRussianStudentSpeechTimingBudget } from "@studydeck/shared";
import { AITUNNEL_PROVIDER_CATALOG, aitunnelPriceForApprovedModel } from "./aitunnel-provider-catalog.js";

type EnvLike = Record<string, string | undefined>;

export const AITUNNEL_NARRATION_PRICE = AITUNNEL_PROVIDER_CATALOG["gemini-3.6-flash"];
export const AITUNNEL_ECONOMY_PRICE = AITUNNEL_PROVIDER_CATALOG["gemini-3.5-flash-lite"];
export const AITUNNEL_NARRATION_DEFAULT_BUDGET_RUB = 20;
export const AITUNNEL_PROJECT_DEFAULT_BUDGET_RUB = 30;
// Keep the worst-case Flash request (compact plan + fixed source snapshot)
// below its immutable 4.25 RUB half-envelope reservation.
export const AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS = 1350;
export const AITUNNEL_NARRATION_DEFAULT_REASONING_EFFORT = "minimal";
export const AITUNNEL_ECONOMY_MODEL = "gemini-3.5-flash-lite";
export const AITUNNEL_PRIMARY_MODEL = "gemini-3.6-flash";

export type AitunnelStage = "narrative_plan" | "design_brief" | "quality_critique" | "narration_part_1" | "narration_part_2" | "narration" | "narration_rewrite" | "presentation" | "slide_text_repair" | "quality_repair";
export type AitunnelNarrationReasoningEffort = "minimal" | "low" | "medium" | "high";
export type AitunnelNarrationBudgetConfig = { budgetRub: string; maxOutputTokens: number; reasoningEffort: AitunnelNarrationReasoningEffort };
export type AitunnelNarrationUsage = { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
export type NarrationReservation = { inputTokens: number; outputTokens: number; costRub: string };

const STAGE_POLICIES: Record<AitunnelStage, { model: "economy" | "primary"; maxOutputTokens: number; reasoningEffort: "minimal" }> = {
  narrative_plan: { model: "economy", maxOutputTokens: 1200, reasoningEffort: "minimal" },
  design_brief: { model: "economy", maxOutputTokens: 1200, reasoningEffort: "minimal" },
  quality_critique: { model: "economy", maxOutputTokens: 800, reasoningEffort: "minimal" },
  narration_part_1: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration_part_2: { model: "primary", maxOutputTokens: AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS, reasoningEffort: "minimal" },
  narration: { model: "primary", maxOutputTokens: 2400, reasoningEffort: "minimal" },
  narration_rewrite: { model: "primary", maxOutputTokens: 2400, reasoningEffort: "minimal" },
  presentation: { model: "primary", maxOutputTokens: 6000, reasoningEffort: "minimal" },
  slide_text_repair: { model: "primary", maxOutputTokens: 2400, reasoningEffort: "minimal" },
  quality_repair: { model: "primary", maxOutputTokens: 3600, reasoningEffort: "minimal" },
};
const SCALE = 100_000_000n;
const MILLION = 1_000_000n;
const INPUT_TOKEN_BYTES = 2;
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
  const narrationOutputTokens = stage === "narration_part_1" || stage === "narration_part_2" ? AITUNNEL_NARRATION_SECTION_MAX_OUTPUT_TOKENS : narration.maxOutputTokens;
  return { model: aitunnelModelForStage(stage, env), maxOutputTokens: stage === "narration_part_1" || stage === "narration_part_2" || stage === "narration" || stage === "narration_rewrite" ? narrationOutputTokens : base.maxOutputTokens, reasoningEffort: stage === "narration_part_1" || stage === "narration_part_2" || stage === "narration" || stage === "narration_rewrite" ? narration.reasoningEffort : base.reasoningEffort };
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
export function estimateInputTokens(payload: unknown) { const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8"); return Math.ceil(Math.ceil(bytes / INPUT_TOKEN_BYTES) * (100 + INPUT_TOKEN_SAFETY_PERCENT) / 100); }
export function reserveNarrationCall(input: { estimatedInputTokens: number; maxOutputTokens: number }): NarrationReservation { const inputTokens = nonNegativeInteger(input.estimatedInputTokens); const outputTokens = nonNegativeInteger(input.maxOutputTokens); return { inputTokens, outputTokens, costRub: costRub(inputTokens, outputTokens, AITUNNEL_NARRATION_PRICE) }; }
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
    const reservation = reserveForPrice(estimateInputTokens(request), policy.maxOutputTokens, aitunnelPriceForModel(policy.model)!);
    const projectRemaining = remainingBudget(this.config.projectBudgetRub, this.projectSettled);
    if (!canStartCall({ remainingBudgetRub: projectRemaining, reservation })) return { status: "aitunnel_project_budget_exhausted_preflight" as const, reservation, projectRemaining };
    if (stage === "narration_part_1" || stage === "narration_part_2" || stage === "narration" || stage === "narration_rewrite") {
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
    if (active.stage === "narration_part_1" || active.stage === "narration_part_2" || active.stage === "narration" || active.stage === "narration_rewrite") this.narrationSettled = add(this.narrationSettled, actualCostRub);
    const overrun = decimalToScaled(actualCostRub) > decimalToScaled(active.reservation.costRub) || decimalToScaled(this.projectSettled) > decimalToScaled(this.config.projectBudgetRub) || decimalToScaled(this.narrationSettled) > decimalToScaled(this.config.narrationBudgetRub);
    if (overrun) this.blocked = true;
    return { status: overrun ? "aitunnel_project_budget_overrun" as const : "settled" as const, actualCostRub, reservation: active.reservation, projectRemaining: remainingBudget(this.config.projectBudgetRub, this.projectSettled), narrationRemaining: remainingBudget(this.config.narrationBudgetRub, this.narrationSettled) };
  }
}
const budgetContext = new AsyncLocalStorage<AitunnelProjectBudget>();
export function runWithAitunnelProjectBudget<T>(budget: AitunnelProjectBudget, callback: () => Promise<T>) { return budgetContext.run(budget, callback); }
export function currentAitunnelProjectBudget() { return budgetContext.getStore(); }

function reserveForPrice(inputTokens: number, outputTokens: number, price: typeof AITUNNEL_NARRATION_PRICE | typeof AITUNNEL_ECONOMY_PRICE): NarrationReservation { return { inputTokens, outputTokens, costRub: costRub(inputTokens, outputTokens, price) }; }
function costRub(inputTokens: number, outputTokens: number, price: typeof AITUNNEL_NARRATION_PRICE | typeof AITUNNEL_ECONOMY_PRICE) { const total = BigInt(inputTokens) * decimalToScaled(price.inputRubPerMillion) + BigInt(outputTokens) * decimalToScaled(price.outputRubPerMillion); return scaledToDecimal(total / MILLION); }
function positiveDecimal(value: string | undefined) { if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return undefined; return decimalToScaled(value) > 0n ? value.trim() : undefined; }
function positiveInteger(value: string | undefined) { if (!value || !/^\d+$/.test(value.trim())) return undefined; const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined; }
function nonNegativeInteger(value: number) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function isTokenCount(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function decimalToScaled(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * SCALE + BigInt(`${fraction}00000000`.slice(0, 8)); }
function scaledToDecimal(value: bigint) { const sign = value < 0n ? "-" : ""; const absolute = value < 0n ? -value : value; return `${sign}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(8, "0")}`; }
function add(left: string, right: string) { return scaledToDecimal(decimalToScaled(left) + decimalToScaled(right)); }

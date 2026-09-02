export const COST_ENVELOPE_POLICY_VERSION = "standard-generation-cost-envelope-v12";
// v12 keeps the existing narration and presentation reservations intact while
// making room for up to three AITunnel raster images in a six-slide deck.
export const COST_ENVELOPE_LIMIT_RUB = "13.50000000";
export const COST_ENVELOPE_BUCKETS = {
  // A source snapshot is valid only when at least three sources pass the
  // relevance gate. Reserve three bounded Tavily attempts so a weak first
  // query can be refined automatically without exposing a failed project.
  sources: "1.50000000",
  // The narrative plan is generated once for narration and again when the
  // accepted speech is turned into slides.
  narrative_plan: "1.50000000",
  narration_full_candidate: "1.00000000",
  // Luna recovery reservation after the measured prompt/output recalculation.
  narration_full_rewrite: "1.50000000",
  narration_targeted_repair: "0.75000000",
  design_brief: "0.50000000",
  // The CSV's 12,317 prompt / 6,000 completion sample recalculates to
  // 2.03600000 RUB at Luna's catalog rate. Keep 2.10 RUB for variance after
  // prompt compression and structured-output overhead; this is not a tariff.
  presentation: "2.10000000",
  quality_critique: "0.30000000",
  quality_repair: "1.00000000",
  slide_text_repair: "0.60000000",
  images: "2.00000000",
  export_infra: "0.75000000",
} as const;

/**
 * v5 is retained only to validate snapshots already persisted before the v6
 * rollout. New envelopes must always use COST_ENVELOPE_POLICY_VERSION.
 */
export const HISTORICAL_COST_ENVELOPE_V5_BUCKETS = {
  sources: "0.50000000",
  narrative_plan: "0.75000000",
  narration_section_1_candidate: "0.25000000",
  narration_section_1_fallback: "1.20000000",
  narration_section_2_candidate: "0.25000000",
  narration_section_2_fallback: "1.20000000",
  narration_section_3_candidate: "0.25000000",
  narration_section_3_fallback: "1.20000000",
  narration_section_4_candidate: "0.25000000",
  narration_section_4_fallback: "1.20000000",
  narration_section_5_candidate: "0.25000000",
  narration_section_5_fallback: "1.20000000",
  narration_section_6_candidate: "0.25000000",
  narration_section_6_fallback: "1.20000000",
  narration_section_7_candidate: "0.25000000",
  narration_section_7_fallback: "1.20000000",
  narration_section_8_candidate: "0.25000000",
  narration_section_8_fallback: "1.20000000",
  narration_section_9_candidate: "0.25000000",
  narration_section_9_fallback: "1.20000000",
  narration_section_10_candidate: "0.25000000",
  narration_section_10_fallback: "1.20000000",
  narration_global_rewrite: "1.20000000",
  images: "0.50000000",
  export_infra: "0.75000000",
} as const;

export type CostEnvelopeBucket = keyof typeof COST_ENVELOPE_BUCKETS | keyof typeof HISTORICAL_COST_ENVELOPE_V5_BUCKETS;
export type CostEnvelopePolicy = { version: string; limitRub: string; buckets: Record<string, string> };

export const AITUNNEL_APPROVED_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra"] as const;
export type AitunnelApprovedModel = typeof AITUNNEL_APPROVED_MODELS[number];
export type AitunnelCatalogPrice = { inputRubPerMillion: string; outputRubPerMillion: string; version: string; effectiveFrom: string };
export const AITUNNEL_PROVIDER_CATALOG_VERSION = "aitunnel-approved-catalog-2026-08-04";
export const AITUNNEL_PROVIDER_CATALOG: Record<AitunnelApprovedModel, AitunnelCatalogPrice> = {
  "gpt-5.6-luna": { inputRubPerMillion: "20", outputRubPerMillion: "120", version: "aitunnel-gpt-5.6-luna-pricing-2026-08-04", effectiveFrom: "2026-08-04T00:00:00.000Z" },
  "gpt-5.6-terra": { inputRubPerMillion: "200", outputRubPerMillion: "1200", version: "aitunnel-gpt-5.6-terra-pricing-2026-08-04", effectiveFrom: "2026-08-04T00:00:00.000Z" },
};

export function standardGenerationCostPolicy(): CostEnvelopePolicy { return { version: COST_ENVELOPE_POLICY_VERSION, limitRub: COST_ENVELOPE_LIMIT_RUB, buckets: { ...COST_ENVELOPE_BUCKETS } }; }
export function historicalStandardGenerationCostPolicyV5(): CostEnvelopePolicy { return { version: "standard-generation-cost-envelope-v5", limitRub: "18.20000000", buckets: { ...HISTORICAL_COST_ENVELOPE_V5_BUCKETS } }; }
export function costEnvelopePolicyIsValid(policy: unknown = standardGenerationCostPolicy()) {
  if (!policy || typeof policy !== "object") return false;
  const candidate = policy as Partial<CostEnvelopePolicy>;
  if (!candidate.buckets || typeof candidate.buckets !== "object" || typeof candidate.limitRub !== "string") return false;
  const amounts = Object.values(candidate.buckets);
  if (!amounts.length || amounts.some((amount) => !isRubAmount(amount))) return false;
  if (!isRubAmount(candidate.limitRub)) return false;
  const total = amounts.reduce((sum, amount) => sum + rubToUnits(amount), 0n);
  return total === rubToUnits(candidate.limitRub);
}
export function isApprovedAitunnelModel(value: string | undefined): value is AitunnelApprovedModel { return Boolean(value && (AITUNNEL_APPROVED_MODELS as readonly string[]).includes(value.trim().toLowerCase())); }
export function aitunnelCatalogSnapshot() { return { catalogVersion: AITUNNEL_PROVIDER_CATALOG_VERSION, models: AITUNNEL_APPROVED_MODELS.map((model) => ({ model, ...AITUNNEL_PROVIDER_CATALOG[model] })) }; }
export function aitunnelPriceForApprovedModel(model: string) { const normalized = model.trim().toLowerCase(); return isApprovedAitunnelModel(normalized) ? AITUNNEL_PROVIDER_CATALOG[normalized] : undefined; }
function rubToUnits(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 100_000_000n + BigInt(`${fraction}00000000`.slice(0, 8)); }
function isRubAmount(value: unknown): value is string { return typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value); }

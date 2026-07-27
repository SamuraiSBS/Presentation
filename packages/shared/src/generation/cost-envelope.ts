export const COST_ENVELOPE_POLICY_VERSION = "standard-generation-cost-envelope-v6";
export const COST_ENVELOPE_LIMIT_RUB = "20.00000000";
export const COST_ENVELOPE_BUCKETS = {
  sources: "0.50000000",
  narrative_plan: "0.75000000",
  narration_full_candidate: "2.50000000",
  narration_full_rewrite: "14.10000000",
  narration_targeted_repair: "0.90000000",
  images: "0.50000000",
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

export const AITUNNEL_APPROVED_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash"] as const;
export type AitunnelApprovedModel = typeof AITUNNEL_APPROVED_MODELS[number];
export type AitunnelCatalogPrice = { inputRubPerMillion: string; outputRubPerMillion: string; version: string; effectiveFrom: string };
export const AITUNNEL_PROVIDER_CATALOG_VERSION = "aitunnel-approved-catalog-2026-07-24";
export const AITUNNEL_PROVIDER_CATALOG: Record<AitunnelApprovedModel, AitunnelCatalogPrice> = {
  "gemini-3.5-flash-lite": { inputRubPerMillion: "60", outputRubPerMillion: "500", version: "aitunnel-gemini-3.5-flash-lite-model-page-2026-07-24", effectiveFrom: "2026-07-24T00:00:00.000Z" },
  "gemini-3.6-flash": { inputRubPerMillion: "455", outputRubPerMillion: "2275", version: "aitunnel-gemini-3.6-flash-pricing-2026-07-24", effectiveFrom: "2026-07-24T00:00:00.000Z" },
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

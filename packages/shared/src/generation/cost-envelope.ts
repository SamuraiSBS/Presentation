export const COST_ENVELOPE_POLICY_VERSION = "standard-generation-cost-envelope-v1";
export const COST_ENVELOPE_LIMIT_RUB = "10.00000000";
export const COST_ENVELOPE_BUCKETS = {
  sources: "0.50000000",
  narration_candidate: "1.50000000",
  narration_fallback: "7.00000000",
  images: "0.50000000",
  export_infra: "0.50000000",
} as const;

export type CostEnvelopeBucket = keyof typeof COST_ENVELOPE_BUCKETS;
export type CostEnvelopePolicy = { version: typeof COST_ENVELOPE_POLICY_VERSION; limitRub: typeof COST_ENVELOPE_LIMIT_RUB; buckets: typeof COST_ENVELOPE_BUCKETS };

export const AITUNNEL_APPROVED_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash"] as const;
export type AitunnelApprovedModel = typeof AITUNNEL_APPROVED_MODELS[number];
export type AitunnelCatalogPrice = { inputRubPerMillion: string; outputRubPerMillion: string; version: string; effectiveFrom: string };
export const AITUNNEL_PROVIDER_CATALOG_VERSION = "aitunnel-approved-catalog-2026-07-24";
export const AITUNNEL_PROVIDER_CATALOG: Record<AitunnelApprovedModel, AitunnelCatalogPrice> = {
  "gemini-3.5-flash-lite": { inputRubPerMillion: "60", outputRubPerMillion: "500", version: "aitunnel-gemini-3.5-flash-lite-model-page-2026-07-24", effectiveFrom: "2026-07-24T00:00:00.000Z" },
  "gemini-3.6-flash": { inputRubPerMillion: "455", outputRubPerMillion: "2275", version: "aitunnel-gemini-3.6-flash-pricing-2026-07-24", effectiveFrom: "2026-07-24T00:00:00.000Z" },
};

export function standardGenerationCostPolicy(): CostEnvelopePolicy { return { version: COST_ENVELOPE_POLICY_VERSION, limitRub: COST_ENVELOPE_LIMIT_RUB, buckets: { ...COST_ENVELOPE_BUCKETS } }; }
export function costEnvelopePolicyIsValid(policy = standardGenerationCostPolicy()) {
  const total = Object.values(policy.buckets).reduce((sum, amount) => sum + rubToUnits(amount), 0n);
  return total === rubToUnits(policy.limitRub) && total <= rubToUnits(COST_ENVELOPE_LIMIT_RUB);
}
export function isApprovedAitunnelModel(value: string | undefined): value is AitunnelApprovedModel { return Boolean(value && (AITUNNEL_APPROVED_MODELS as readonly string[]).includes(value.trim().toLowerCase())); }
export function aitunnelCatalogSnapshot() { return { catalogVersion: AITUNNEL_PROVIDER_CATALOG_VERSION, models: AITUNNEL_APPROVED_MODELS.map((model) => ({ model, ...AITUNNEL_PROVIDER_CATALOG[model] })) }; }
export function aitunnelPriceForApprovedModel(model: string) { const normalized = model.trim().toLowerCase(); return isApprovedAitunnelModel(normalized) ? AITUNNEL_PROVIDER_CATALOG[normalized] : undefined; }
function rubToUnits(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 100_000_000n + BigInt(`${fraction}00000000`.slice(0, 8)); }

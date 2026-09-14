export const COST_ENVELOPE_POLICY_VERSION = "standard-generation-cost-envelope-v15";
// v15 keeps the v14 AITunnel Luna tariff and provider-reported web-search
// reservation, while raising the raster image bucket for gpt-image-2.5-flare.
// Its catalog minimum is 0.85 RUB per image, so the managed six-slide quota
// needs 3 * 0.85 = 2.55 RUB before any provider-reported variance.
export const COST_ENVELOPE_LIMIT_RUB = "24.30000000";
export const COST_ENVELOPE_BUCKETS = {
  // A source snapshot is valid only when at least three sources pass the
  // relevance gate. Reserve three bounded Tavily attempts so a weak first
  // query can be refined automatically without exposing a failed project.
  sources: "2.50000000",
  // The narrative plan is generated once for narration and again when the
  // accepted speech is turned into slides.
  narrative_plan: "3.00000000",
  narration_full_candidate: "2.00000000",
  // Luna recovery reservation after the measured prompt/output recalculation.
  narration_full_rewrite: "3.00000000",
  narration_targeted_repair: "1.50000000",
  design_brief: "1.00000000",
  // The CSV's 12,317 prompt / 6,000 completion sample recalculates to
  // 4.07200000 RUB at the current Luna catalog rate. Keep 4.20 RUB for
  // variance after prompt compression and structured-output overhead; this
  // is not a tariff.
  presentation: "4.20000000",
  quality_critique: "0.60000000",
  quality_repair: "2.00000000",
  slide_text_repair: "1.20000000",
  images: "2.55000000",
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

export const AI_SCENE_V2_PROTOTYPE_COST_POLICY: CostEnvelopePolicy = {
  // This is deliberately separate from the standard deck envelope: the
  // two-slide stop/go run must not debit or reopen a finished presentation.
  version: "ai-scene-v2-prototype-v1",
  limitRub: "24.00000000",
  buckets: {
    style_direction: "1.00000000",
    slide_concept: "8.00000000",
    scene_analysis: "2.00000000",
    layer_generation: "8.00000000",
    scene_repair: "5.00000000",
  },
};

/**
 * A separate acceptance-run envelope. It covers exactly six A/B backgrounds
 * plus one text-layout and one high-detail vision review per candidate; C is
 * deliberately excluded and needs a separate user-approved run.
 */
export const AI_SCENE_V3_GATE_1_COST_POLICY: CostEnvelopePolicy = {
  version: "ai-scene-v3-gate-1-v1",
  limitRub: "150.00000000",
  buckets: {
    backgrounds: "90.00000000",
    native_text_layout: "24.00000000",
    high_detail_vision: "36.00000000",
  },
};

export type AiSceneCostEnvelopeBucket = keyof typeof AI_SCENE_V2_PROTOTYPE_COST_POLICY.buckets | keyof typeof AI_SCENE_V3_GATE_1_COST_POLICY.buckets;
export type CostEnvelopeBucket = keyof typeof COST_ENVELOPE_BUCKETS | keyof typeof HISTORICAL_COST_ENVELOPE_V5_BUCKETS | "design_regeneration" | AiSceneCostEnvelopeBucket;
export type CostEnvelopePolicy = { version: string; limitRub: string; buckets: Record<string, string> };

// A review retry is a separate, small purchase boundary. It never reopens the
// completed deck envelope or authorises a whole-presentation rerun.
export const DESIGN_REVIEW_REGENERATION_COST_POLICY: CostEnvelopePolicy = {
  version: "design-review-regeneration-v1",
  limitRub: "3.20000000",
  buckets: { design_regeneration: "2.00000000", images: "1.20000000" },
};
export type DesignReviewCostEnvelopeBucket = CostEnvelopeBucket;
export function designReviewRegenerationCostPolicy(): CostEnvelopePolicy { return { ...DESIGN_REVIEW_REGENERATION_COST_POLICY, buckets: { ...DESIGN_REVIEW_REGENERATION_COST_POLICY.buckets } }; }

export const AITUNNEL_APPROVED_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra"] as const;
export type AitunnelApprovedModel = typeof AITUNNEL_APPROVED_MODELS[number];
export type AitunnelCatalogPrice = { inputRubPerMillion: string; outputRubPerMillion: string; version: string; effectiveFrom: string };
export const AITUNNEL_PROVIDER_CATALOG_VERSION = "aitunnel-approved-catalog-2026-09-07";
export const AITUNNEL_PROVIDER_CATALOG: Record<AitunnelApprovedModel, AitunnelCatalogPrice> = {
  "gpt-5.6-luna": { inputRubPerMillion: "40", outputRubPerMillion: "240", version: "aitunnel-gpt-5.6-luna-pricing-2026-09-07", effectiveFrom: "2026-09-07T00:00:00.000Z" },
  "gpt-5.6-terra": { inputRubPerMillion: "200", outputRubPerMillion: "1200", version: "aitunnel-gpt-5.6-terra-pricing-2026-08-04", effectiveFrom: "2026-08-04T00:00:00.000Z" },
};

export function standardGenerationCostPolicy(): CostEnvelopePolicy { return { version: COST_ENVELOPE_POLICY_VERSION, limitRub: COST_ENVELOPE_LIMIT_RUB, buckets: { ...COST_ENVELOPE_BUCKETS } }; }
export function historicalStandardGenerationCostPolicyV5(): CostEnvelopePolicy { return { version: "standard-generation-cost-envelope-v5", limitRub: "18.20000000", buckets: { ...HISTORICAL_COST_ENVELOPE_V5_BUCKETS } }; }
export function aiScenePrototypeCostPolicy(): CostEnvelopePolicy { return { ...AI_SCENE_V2_PROTOTYPE_COST_POLICY, buckets: { ...AI_SCENE_V2_PROTOTYPE_COST_POLICY.buckets } }; }
export function aiSceneV3Gate1CostPolicy(): CostEnvelopePolicy { return { ...AI_SCENE_V3_GATE_1_COST_POLICY, buckets: { ...AI_SCENE_V3_GATE_1_COST_POLICY.buckets } }; }
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

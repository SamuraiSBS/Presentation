import {
  imageFirstEditableInitialCostPolicy,
  imageFirstEditableManualRegenerationCostPolicy,
  type CostEnvelopePolicy,
  type ImageFirstEditableSlideCount,
} from "@studydeck/shared";
import { createCostEnvelopeWithPolicy, reserveCostEnvelope } from "../../../cost-envelope.js";
import { getPrisma } from "../../../prisma.js";

export type ImageFirstEditableInitialStage = "source_search" | "narration" | "deck_content_lock" | "image";

export async function createImageFirstEditableInitialEnvelope(projectId: string, requestedSlideCount: ImageFirstEditableSlideCount) {
  return createCostEnvelopeWithPolicy(projectId, imageFirstEditableInitialCostPolicy(requestedSlideCount));
}

export async function createImageFirstEditableManualEnvelope(projectId: string) {
  return createCostEnvelopeWithPolicy(projectId, imageFirstEditableManualRegenerationCostPolicy());
}

/**
 * One exact stage reservation per provider call. The full bucket amount is
 * intentionally reserved: an invalid, timeout, or uncertain reply cannot
 * create spare budget for an automatic retry.
 */
export async function reserveImageFirstEditableInitialStage(input: {
  envelopeId: string;
  stage: ImageFirstEditableInitialStage;
  slideOrder?: number;
}) {
  const envelope = await getPrisma().costEnvelope.findUniqueOrThrow({ where: { id: input.envelopeId }, select: { policySnapshot: true } });
  const policy = assertInitialPolicy(envelope.policySnapshot as CostEnvelopePolicy);
  if (input.stage === "image") {
    if (!Number.isInteger(input.slideOrder) || !input.slideOrder || input.slideOrder < 1 || input.slideOrder > Number(policy.buckets.images)) throw new Error("image_first_editable_v1_image_slide_order_invalid");
    return reserveInitialStage({ envelopeId: input.envelopeId, idempotencyKey: `${input.envelopeId}:image_first_editable_v1:image:${input.slideOrder}`, bucket: "images", stage: `image_first_editable_v1:image:${input.slideOrder}`, amountRub: "1.00000000" });
  }
  const bucket = input.stage;
  const amountRub = policy.buckets[bucket];
  if (!amountRub) throw new Error(`image_first_editable_v1_stage_not_budgeted:${input.stage}`);
  return reserveInitialStage({ envelopeId: input.envelopeId, idempotencyKey: `${input.envelopeId}:image_first_editable_v1:${input.stage}`, bucket, stage: `image_first_editable_v1:${input.stage}`, amountRub });
}

export async function reserveImageFirstEditableManualRegeneration(input: { envelopeId: string; requestId: string }) {
  const envelope = await getPrisma().costEnvelope.findUniqueOrThrow({ where: { id: input.envelopeId }, select: { policySnapshot: true } });
  const policy = envelope.policySnapshot as CostEnvelopePolicy;
  if (policy.version !== imageFirstEditableManualRegenerationCostPolicy().version) throw new Error("image_first_editable_v1_manual_envelope_required");
  return reserveCostEnvelope({ envelopeId: input.envelopeId, idempotencyKey: `${input.envelopeId}:image_first_editable_v1:manual:${input.requestId}`, bucket: "manual_regeneration", stage: "image_first_editable_v1:manual_regeneration", amountRub: "1.00000000" });
}

function assertInitialPolicy(policy: CostEnvelopePolicy) {
  const match = /^image-first-editable-v1-initial-(6|8|10|12|14)$/.exec(policy.version);
  if (!match || !costPolicyMatchesCount(policy, Number(match[1]))) throw new Error("image_first_editable_v1_initial_envelope_required");
  return policy;
}

function costPolicyMatchesCount(policy: CostEnvelopePolicy, count: number) {
  const expected = imageFirstEditableInitialCostPolicy(count as ImageFirstEditableSlideCount);
  return policy.limitRub === expected.limitRub
    && Object.entries(expected.buckets).every(([bucket, amount]) => policy.buckets[bucket] === amount);
}

async function reserveInitialStage(input: Parameters<typeof reserveCostEnvelope>[0]) {
  const result = await reserveCostEnvelope(input);
  // A worker may safely observe a replayed ledger record, but this v1
  // purchase wrapper must never turn that record into another paid provider
  // attempt.  The caller gets an explicit stop signal instead.
  if (result.status === "reserved" && result.idempotent) return { status: "blocked" as const, reason: "stage_already_reserved" as const };
  return result;
}

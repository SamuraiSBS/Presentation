import { Prisma } from "@prisma/client";
import { aitunnelCatalogSnapshot, costEnvelopePolicyIsValid, standardGenerationCostPolicy, type CostEnvelopeBucket, type CostEnvelopePolicy } from "@studydeck/shared";
import { getPrisma } from "./prisma.js";
export { COST_ENVELOPE_BUCKETS, COST_ENVELOPE_LIMIT_RUB, COST_ENVELOPE_POLICY_VERSION, costEnvelopePolicyIsValid, standardGenerationCostPolicy } from "@studydeck/shared";
export type { CostEnvelopeBucket, CostEnvelopePolicy } from "@studydeck/shared";

const SCALE = 100_000_000n;

/** The complete, immutable input saved with every standard-generation run. */
export async function createCostEnvelope(projectId: string) {
  const policy = standardGenerationCostPolicy();
  if (!costEnvelopePolicyIsValid(policy)) throw new Error("cost_envelope_policy_invalid");
  return getPrisma().costEnvelope.create({
    data: {
      projectId,
      policyVersion: policy.version,
      limitRub: policy.limitRub,
      policySnapshot: policy,
      catalogSnapshot: aitunnelCatalogSnapshot(),
    },
  });
}

type ReserveInput = { envelopeId: string; idempotencyKey: string; bucket: CostEnvelopeBucket; stage: string; amountRub: string };
type SettleInput = {
  envelopeId: string;
  idempotencyKey: string;
  actualRub?: string;
  reason?: string;
  /**
   * A completed, chargeable operation can still be terminal for the run.
   * Settle its immutable cost before exhausting the envelope; do not recast
   * the post-provider business outcome as a provider transport failure.
   */
  exhaustEnvelope?: boolean;
};

/**
 * Locks a single envelope row. The reservation key makes BullMQ retries
 * idempotent; SERIALIZABLE prevents two workers from overspending a bucket.
 */
export async function reserveCostEnvelope(input: ReserveInput) {
  const amount = positiveAmount(input.amountRub);
  return getPrisma().$transaction(async (tx) => {
    const envelope = await lockEnvelope(tx, input.envelopeId);
    const existing = await tx.costEnvelopeReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { status: "reserved" as const, reservation: existing, idempotent: true };
    if (envelope.status !== "active") return { status: "blocked" as const, reason: `envelope_${envelope.status}` };
    const policy = parsePolicy(envelope.policySnapshot);
    const bucketCap = policy.buckets[input.bucket];
    const bucketReserved = await tx.costEnvelopeReservation.aggregate({
      where: { envelopeId: envelope.id, bucket: input.bucket, status: { in: ["reserved", "provider_error", "unknown_usage"] } },
      _sum: { reservedRub: true },
    });
    if (toScaled(bucketReserved._sum.reservedRub?.toString() || "0") + toScaled(amount) > toScaled(bucketCap)) {
      return { status: "blocked" as const, reason: "bucket_exhausted" };
    }
    if (toScaled(envelope.reservedRub.toString()) + toScaled(envelope.settledRub.toString()) + toScaled(amount) > toScaled(envelope.limitRub.toString())) {
      return { status: "blocked" as const, reason: "envelope_exhausted" };
    }
    const reservation = await tx.costEnvelopeReservation.create({ data: { envelopeId: envelope.id, idempotencyKey: input.idempotencyKey, bucket: input.bucket, stage: input.stage, reservedRub: amount } });
    await tx.costEnvelope.update({ where: { id: envelope.id }, data: { reservedRub: { increment: amount } } });
    return { status: "reserved" as const, reservation, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Reserve both fixed narration parts in one lock before either paid call. */
export async function reserveCostEnvelopeBatch(inputs: readonly ReserveInput[]) {
  if (!inputs.length) throw new Error("cost_envelope_batch_empty");
  const envelopeId = inputs[0]!.envelopeId;
  if (inputs.some((input) => input.envelopeId !== envelopeId)) throw new Error("cost_envelope_batch_mixed_envelope");
  return getPrisma().$transaction(async (tx) => {
    const envelope = await lockEnvelope(tx, envelopeId);
    const policy = parsePolicy(envelope.policySnapshot);
    if (envelope.status !== "active") return { status: "blocked" as const, reason: `envelope_${envelope.status}` };
    const existing = await Promise.all(inputs.map((input) => tx.costEnvelopeReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } })));
    if (existing.some(Boolean)) return { status: "blocked" as const, reason: "reservation_replay" };
    const amounts = inputs.map((input) => positiveAmount(input.amountRub));
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index]!;
      if (toScaled(amounts[index]!) > toScaled(policy.buckets[input.bucket])) return { status: "blocked" as const, reason: "bucket_exhausted" };
    }
    const total = amounts.reduce((sum, amount) => sum + toScaled(amount), 0n);
    if (toScaled(envelope.reservedRub.toString()) + toScaled(envelope.settledRub.toString()) + total > toScaled(envelope.limitRub.toString())) return { status: "blocked" as const, reason: "envelope_exhausted" };
    const reservations = await Promise.all(inputs.map((input, index) => tx.costEnvelopeReservation.create({ data: { envelopeId, idempotencyKey: input.idempotencyKey, bucket: input.bucket, stage: input.stage, reservedRub: amounts[index]! } })));
    await tx.costEnvelope.update({ where: { id: envelopeId }, data: { reservedRub: { increment: fromScaled(total) } } });
    return { status: "reserved" as const, reservations };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function settleCostEnvelope(input: SettleInput) {
  return getPrisma().$transaction(async (tx) => {
    const envelope = await lockEnvelope(tx, input.envelopeId);
    const reservation = await tx.costEnvelopeReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (!reservation || reservation.envelopeId !== envelope.id) return { status: "missing_reservation" as const };
    if (reservation.status !== "reserved") return { status: reservation.status as "settled" | "released" | "provider_error" | "unknown_usage" | "overrun", idempotent: true };
    if (!input.actualRub) {
      await tx.costEnvelopeReservation.update({ where: { id: reservation.id }, data: { status: "unknown_usage", reason: input.reason || "unknown_usage", settledAt: new Date() } });
      await tx.costEnvelope.update({ where: { id: envelope.id }, data: { status: "exhausted" } });
      return { status: "unknown_usage" as const };
    }
    const actual = positiveAmount(input.actualRub, true);
    const overrun = toScaled(actual) > toScaled(reservation.reservedRub.toString()) || toScaled(envelope.settledRub.toString()) + toScaled(actual) > toScaled(envelope.limitRub.toString());
    await tx.costEnvelopeReservation.update({ where: { id: reservation.id }, data: { status: overrun ? "overrun" : "settled", settledRub: actual, settledAt: new Date(), reason: input.reason } });
    await tx.costEnvelope.update({
      where: { id: envelope.id },
      data: {
        reservedRub: { decrement: reservation.reservedRub },
        settledRub: { increment: actual },
        ...(overrun || input.exhaustEnvelope ? { status: "exhausted" } : {}),
      },
    });
    return { status: overrun ? "overrun" as const : "settled" as const, actualRub: actual, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function releaseCostEnvelope(input: { envelopeId: string; idempotencyKey: string; reason?: string }) {
  return getPrisma().$transaction(async (tx) => {
    const envelope = await lockEnvelope(tx, input.envelopeId);
    const reservation = await tx.costEnvelopeReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (!reservation || reservation.envelopeId !== envelope.id) return { status: "missing_reservation" as const };
    if (reservation.status !== "reserved") return { status: reservation.status as "settled" | "released" | "provider_error" | "unknown_usage" | "overrun", idempotent: true };
    await tx.costEnvelopeReservation.update({ where: { id: reservation.id }, data: { status: "released", releasedRub: reservation.reservedRub, releasedAt: new Date(), reason: input.reason } });
    await tx.costEnvelope.update({ where: { id: envelope.id }, data: { reservedRub: { decrement: reservation.reservedRub }, releasedRub: { increment: reservation.reservedRub } } });
    return { status: "released" as const, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Provider failures are conservatively terminal: do not reuse an uncertain reservation. */
export async function failCostEnvelope(input: { envelopeId: string; idempotencyKey: string; reason?: string; exhaustEnvelope?: boolean }) {
  return getPrisma().$transaction(async (tx) => {
    const envelope = await lockEnvelope(tx, input.envelopeId);
    const reservation = await tx.costEnvelopeReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (!reservation || reservation.envelopeId !== envelope.id) return { status: "missing_reservation" as const };
    if (reservation.status !== "reserved") return { status: reservation.status as "settled" | "released" | "provider_error" | "unknown_usage" | "overrun", idempotent: true };
    await tx.costEnvelopeReservation.update({ where: { id: reservation.id }, data: { status: "provider_error", reason: input.reason || "provider_error", settledAt: new Date() } });
    await tx.costEnvelope.update({
      where: { id: envelope.id },
      // A bounded recovery flow may reserve the next slot after a provider
      // transport failure. Keep the uncertain reservation counted, but do
      // not discard the remaining, explicitly budgeted recovery capacity.
      data: input.exhaustEnvelope === false ? {} : { status: "exhausted" },
    });
    return { status: "provider_error" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Closes an otherwise reusable envelope after its narration job has reached a
 * terminal failure without a saved draft. This is deliberately distinct from
 * provider failure: it never changes a reservation or records a synthetic
 * usage event.
 */
export async function finalizeFailedCostEnvelope(input: { envelopeId: string }) {
  return getPrisma().$transaction(async (tx) => {
    const envelope = await lockEnvelope(tx, input.envelopeId);
    if (envelope.status !== "active") {
      return { status: envelope.status as "completed" | "cancelled" | "exhausted", idempotent: true };
    }
    await tx.costEnvelope.update({ where: { id: envelope.id }, data: { status: "exhausted" } });
    return { status: "exhausted" as const, idempotent: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function lockEnvelope(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "CostEnvelope" WHERE "id" = ${id} FOR UPDATE`);
  if (!rows.length) throw new Error("cost_envelope_not_found");
  const envelope = await tx.costEnvelope.findUnique({ where: { id } });
  if (!envelope) throw new Error("cost_envelope_not_found");
  return envelope;
}

function parsePolicy(value: Prisma.JsonValue): CostEnvelopePolicy {
  const policy = value as unknown as CostEnvelopePolicy;
  if (!policy || !policy.buckets || !costEnvelopePolicyIsValid(policy)) throw new Error("cost_envelope_policy_invalid");
  return policy;
}
function positiveAmount(value: string, allowZero = false) {
  if (!/^\d+(?:\.\d+)?$/.test(value) || (!allowZero && toScaled(value) <= 0n) || (allowZero && toScaled(value) < 0n)) throw new Error("cost_envelope_amount_invalid");
  return fromScaled(toScaled(value));
}
function toScaled(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * SCALE + BigInt(`${fraction}00000000`.slice(0, 8)); }
function fromScaled(value: bigint) { return `${value / SCALE}.${(value % SCALE).toString().padStart(8, "0")}`; }

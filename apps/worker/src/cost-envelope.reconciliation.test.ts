import { beforeEach, describe, expect, it, vi } from "vitest";
import { standardGenerationCostPolicy } from "@studydeck/shared";

type Reservation = {
  id: string;
  envelopeId: string;
  idempotencyKey: string;
  bucket: string;
  stage: string;
  status: "reserved" | "settled" | "released" | "provider_error" | "unknown_usage" | "overrun";
  reservedRub: string;
  settledRub: string;
  releasedRub: string;
  reason?: string;
};

const ledger = vi.hoisted(() => ({
  envelope: undefined as undefined | Record<string, unknown>,
  reservations: [] as Reservation[],
}));

function decimal(value: unknown) {
  return Number(String(value || "0"));
}

function rub(value: number) {
  return value.toFixed(8);
}

const transaction = {
  $queryRaw: async () => [{ id: "envelope-1" }],
  costEnvelope: {
    findUnique: async () => ledger.envelope,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      const envelope = ledger.envelope!;
      for (const [field, value] of Object.entries(data)) {
        if (value && typeof value === "object" && ("increment" in value || "decrement" in value)) {
          const mutation = value as { increment?: unknown; decrement?: unknown };
          envelope[field] = rub(decimal(envelope[field]) + decimal(mutation.increment) - decimal(mutation.decrement));
        } else {
          envelope[field] = value;
        }
      }
      return envelope;
    },
  },
  costEnvelopeReservation: {
    findUnique: async ({ where }: { where: { idempotencyKey: string } }) => ledger.reservations.find((row) => row.idempotencyKey === where.idempotencyKey) || null,
    aggregate: async ({ where }: { where: { envelopeId: string; bucket: string; status: { in: Reservation["status"][] } } }) => ({
      _sum: {
        reservedRub: rub(ledger.reservations
          .filter((row) => row.envelopeId === where.envelopeId && row.bucket === where.bucket && where.status.in.includes(row.status))
          .reduce((sum, row) => sum + decimal(row.reservedRub), 0)),
      },
    }),
    create: async ({ data }: { data: Omit<Reservation, "id" | "status" | "settledRub" | "releasedRub"> }) => {
      const row: Reservation = {
        id: `reservation-${ledger.reservations.length + 1}`,
        ...data,
        status: "reserved",
        settledRub: "0.00000000",
        releasedRub: "0.00000000",
      };
      ledger.reservations.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Reservation> }) => {
      const row = ledger.reservations.find((item) => item.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
  },
};

vi.mock("./prisma.js", () => ({
  getPrisma: () => ({
    $transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
  }),
}));

const { failCostEnvelope, finalizeFailedCostEnvelope, reserveCostEnvelope, settleCostEnvelope } = await import("./cost-envelope.js");

function sourceReservation() {
  return {
    envelopeId: "envelope-1",
    idempotencyKey: "envelope-1:mandatory-source-search",
    bucket: "sources" as const,
    stage: "mandatory_source_search",
    amountRub: "0.50000000",
  };
}

beforeEach(() => {
  ledger.reservations.length = 0;
  const policy = standardGenerationCostPolicy();
  ledger.envelope = {
    id: "envelope-1",
    policySnapshot: policy,
    limitRub: policy.limitRub,
    reservedRub: "0.00000000",
    settledRub: "0.00000000",
    releasedRub: "0.00000000",
    status: "active",
  };
});

describe("mandatory source search reconciliation", () => {
  it("settles a sufficient successful search once and keeps replay arithmetic unchanged", async () => {
    await expect(reserveCostEnvelope(sourceReservation())).resolves.toMatchObject({ status: "reserved", idempotent: false });
    await expect(settleCostEnvelope({
      envelopeId: "envelope-1",
      idempotencyKey: "envelope-1:mandatory-source-search",
      actualRub: "0.50000000",
    })).resolves.toMatchObject({ status: "settled", actualRub: "0.50000000", idempotent: false });

    expect(ledger.envelope).toMatchObject({ reservedRub: "0.00000000", settledRub: "0.50000000", releasedRub: "0.00000000", status: "active" });
    expect(ledger.reservations).toMatchObject([{ status: "settled", reservedRub: "0.50000000", settledRub: "0.50000000", releasedRub: "0.00000000" }]);

    await expect(settleCostEnvelope({
      envelopeId: "envelope-1",
      idempotencyKey: "envelope-1:mandatory-source-search",
      actualRub: "0.50000000",
    })).resolves.toMatchObject({ status: "settled", idempotent: true });
    expect(ledger.envelope).toMatchObject({ reservedRub: "0.00000000", settledRub: "0.50000000", releasedRub: "0.00000000" });
  });

  it("settles a chargeable insufficient search once, then exhausts without calling it provider_error", async () => {
    await reserveCostEnvelope(sourceReservation());
    await expect(settleCostEnvelope({
      envelopeId: "envelope-1",
      idempotencyKey: "envelope-1:mandatory-source-search",
      actualRub: "0.50000000",
      reason: "mandatory_source_search_insufficient",
      exhaustEnvelope: true,
    })).resolves.toMatchObject({ status: "settled", actualRub: "0.50000000" });

    expect(ledger.envelope).toMatchObject({ reservedRub: "0.00000000", settledRub: "0.50000000", releasedRub: "0.00000000", status: "exhausted" });
    expect(ledger.reservations).toMatchObject([{ status: "settled", reason: "mandatory_source_search_insufficient", settledRub: "0.50000000" }]);

    await expect(settleCostEnvelope({
      envelopeId: "envelope-1",
      idempotencyKey: "envelope-1:mandatory-source-search",
      actualRub: "0.50000000",
      reason: "mandatory_source_search_insufficient",
      exhaustEnvelope: true,
    })).resolves.toMatchObject({ status: "settled", idempotent: true });
    expect(ledger.envelope).toMatchObject({ reservedRub: "0.00000000", settledRub: "0.50000000", releasedRub: "0.00000000", status: "exhausted" });
  });

  it("keeps an HTTP/transport failure before chargeable success as an uncertain provider_error reservation", async () => {
    await reserveCostEnvelope(sourceReservation());
    await expect(failCostEnvelope({
      envelopeId: "envelope-1",
      idempotencyKey: "envelope-1:mandatory-source-search",
      reason: "mandatory_source_search_failed",
    })).resolves.toMatchObject({ status: "provider_error" });

    expect(ledger.envelope).toMatchObject({ reservedRub: "0.50000000", settledRub: "0.00000000", releasedRub: "0.00000000", status: "exhausted" });
    expect(ledger.reservations).toMatchObject([{ status: "provider_error", settledRub: "0.00000000", releasedRub: "0.00000000" }]);

    await expect(failCostEnvelope({
      envelopeId: "envelope-1",
      idempotencyKey: "envelope-1:mandatory-source-search",
      reason: "mandatory_source_search_failed",
    })).resolves.toMatchObject({ status: "provider_error", idempotent: true });
    expect(ledger.envelope).toMatchObject({ reservedRub: "0.50000000", settledRub: "0.00000000", releasedRub: "0.00000000" });
  });
});

describe("failed narration envelope finalization", () => {
  it("changes only an active envelope status, preserves ledger rows, and is idempotent", async () => {
    ledger.envelope = {
      ...ledger.envelope!,
      reservedRub: "0.00000000",
      settledRub: "9.52363000",
      releasedRub: "0.90000000",
    };
    ledger.reservations.push(
      {
        id: "reservation-settled",
        envelopeId: "envelope-1",
        idempotencyKey: "envelope-1:narration_full_candidate",
        bucket: "narration_candidate",
        stage: "narration_full_candidate",
        status: "settled",
        reservedRub: "2.50000000",
        settledRub: "1.19888000",
        releasedRub: "0.00000000",
      },
      {
        id: "reservation-released",
        envelopeId: "envelope-1",
        idempotencyKey: "envelope-1:narration_targeted_repair",
        bucket: "narration_repair",
        stage: "narration_targeted_repair",
        status: "released",
        reservedRub: "0.90000000",
        settledRub: "0.00000000",
        releasedRub: "0.90000000",
      },
    );
    const totalsBefore = {
      reservedRub: ledger.envelope.reservedRub,
      settledRub: ledger.envelope.settledRub,
      releasedRub: ledger.envelope.releasedRub,
    };
    const reservationsBefore = structuredClone(ledger.reservations);

    await expect(finalizeFailedCostEnvelope({ envelopeId: "envelope-1" }))
      .resolves.toEqual({ status: "exhausted", idempotent: false });

    expect(ledger.envelope).toMatchObject({ ...totalsBefore, status: "exhausted" });
    expect(ledger.reservations).toEqual(reservationsBefore);
    expect(ledger.reservations.some((reservation) => reservation.status === "provider_error")).toBe(false);

    await expect(finalizeFailedCostEnvelope({ envelopeId: "envelope-1" }))
      .resolves.toEqual({ status: "exhausted", idempotent: true });
    expect(ledger.envelope).toMatchObject({ ...totalsBefore, status: "exhausted" });
    expect(ledger.reservations).toEqual(reservationsBefore);
  });

  it.each(["exhausted", "completed", "cancelled"] as const)("does not mutate an already %s envelope", async (status) => {
    ledger.envelope!.status = status;
    const before = structuredClone(ledger.envelope);

    await expect(finalizeFailedCostEnvelope({ envelopeId: "envelope-1" }))
      .resolves.toEqual({ status, idempotent: true });

    expect(ledger.envelope).toEqual(before);
    expect(ledger.reservations).toEqual([]);
  });
});

import type { Prisma, PrismaClient } from "@prisma/client";

type QuotaTransaction = Pick<Prisma.TransactionClient, "generationQuotaReservation" | "generationQuotaCounter">;
type QuotaPrisma = Pick<PrismaClient, "$transaction">;

/** Refund a terminally failed presentation launch exactly once. */
export async function releaseGenerationQuotaReservation(prisma: QuotaPrisma, generationJobId: string) {
  return prisma.$transaction(async (tx) => {
    const quotaTx = tx as QuotaTransaction;
    const reservation = await quotaTx.generationQuotaReservation.findUnique({
      where: { generationJobId },
      select: { id: true, userId: true, period: true, quotaEpoch: true, status: true },
    });
    if (!reservation || reservation.status === "released") return false;
    const released = await quotaTx.generationQuotaReservation.updateMany({
      where: { id: reservation.id, status: "reserved" },
      data: { status: "released", releasedAt: new Date() },
    });
    if (released.count !== 1) return false;
    await quotaTx.generationQuotaCounter.updateMany({
      where: {
        userId: reservation.userId,
        period: reservation.period,
        quotaEpoch: reservation.quotaEpoch,
        used: { gt: 0 },
      },
      data: { used: { decrement: 1 } },
    });
    return true;
  });
}

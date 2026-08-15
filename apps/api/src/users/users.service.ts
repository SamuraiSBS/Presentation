import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { BillingService } from "../billing/billing.service.js";
import { badRequest } from "../errors/api-error.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { UsageService } from "../usage/usage.service.js";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly billing: BillingService,
    @InjectQueue("admin-maintenance") private readonly maintenanceQueue: Queue,
  ) {}

  async getMe(userId: string) {
    const usage = await this.usage.getSummary(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        image: true,
        telegramId: true,
        telegramUsername: true,
        planCode: true,
        createdAt: true,
        accountDeletion: {
          select: { status: true, requestedAt: true, completedAt: true, error: true },
        },
      },
    });
    return { ...user, planCode: usage.planCode, usage };
  }

  async removeMe(userId: string, confirmation: unknown) {
    const confirmed = confirmation === true
      || (typeof confirmation === "string" && confirmation.trim().toUpperCase() === "УДАЛИТЬ");
    if (!confirmed) {
      throw badRequest("ACCOUNT_DELETION_NOT_CONFIRMED", "Подтвердите удаление аккаунта");
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        stripeSubscriptionId: true,
        subscriptionStatus: true,
        accountDeletion: true,
      },
    });
    if (user.accountDeletion?.status === "completed" || user.accountDeletion?.status === "queued" || user.accountDeletion?.status === "processing") {
      return this.deletionResponse(user.accountDeletion);
    }

    const deletion = user.accountDeletion ?? await this.prisma.$transaction(async (tx) => {
      const created = await tx.accountDeletion.create({
        data: { userId, stripeSubscriptionId: user.stripeSubscriptionId },
      });
      await tx.user.update({
        where: { id: userId },
        data: { blockedAt: new Date(), blockReason: "ACCOUNT_DELETION_PENDING" },
      });
      return created;
    });

    try {
      const cancellation = deletion.subscriptionCancelledAt
        ? { subscriptionId: deletion.stripeSubscriptionId, cancelledAt: deletion.subscriptionCancelledAt }
        : await this.billing.cancelSubscriptionForAccountDeletion(user);
      const queued = await this.prisma.accountDeletion.update({
        where: { id: deletion.id },
        data: {
          status: "queued",
          stripeSubscriptionId: cancellation.subscriptionId,
          subscriptionCancelledAt: cancellation.cancelledAt,
          error: null,
        },
      });
      if (deletion.queueJobId) await (await this.maintenanceQueue.getJob(deletion.queueJobId))?.remove();
      const queueJob = await this.maintenanceQueue.add(
        "delete-account",
        { deletionId: deletion.id },
        {
          jobId: `account-deletion-${deletion.id}`,
          attempts: 60,
          backoff: { type: "fixed", delay: 30_000 },
          removeOnComplete: { age: 60 * 60 * 24 * 30, count: 1_000 },
          removeOnFail: { age: 60 * 60 * 24 * 90, count: 1_000 },
        },
      );
      const scheduled = await this.prisma.accountDeletion.update({
        where: { id: queued.id },
        data: { queueJobId: String(queueJob.id) },
      });
      return this.deletionResponse(scheduled);
    } catch (error) {
      const failed = await this.prisma.accountDeletion.update({
        where: { id: deletion.id },
        data: { status: "failed", error: safeErrorMessage(error) },
      });
      return this.deletionResponse(failed);
    }
  }

  async getDeletionStatus(userId: string) {
    const deletion = await this.prisma.accountDeletion.findUnique({ where: { userId } });
    return deletion ? this.deletionResponse(deletion) : { status: "none" as const };
  }

  private deletionResponse(deletion: {
    id: string;
    status: string;
    requestedAt: Date;
    completedAt: Date | null;
    error: string | null;
  }) {
    return {
      id: deletion.id,
      status: deletion.status,
      requestedAt: deletion.requestedAt,
      completedAt: deletion.completedAt,
      error: deletion.error,
      message: deletion.status === "completed"
        ? "Account data has been deleted."
        : "New jobs are blocked. Billing was cancelled before background data deletion begins.",
    };
  }
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "Account deletion could not be scheduled";
}

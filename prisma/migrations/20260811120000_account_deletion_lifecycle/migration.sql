-- A deletion request is durable state: it prevents an external billing action
-- and the destructive cleanup from being coupled to one HTTP request.
CREATE TYPE "AccountDeletionStatus" AS ENUM ('cancellation_pending', 'queued', 'processing', 'completed', 'failed');

CREATE TABLE "AccountDeletion" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'cancellation_pending',
    "stripeSubscriptionId" TEXT,
    "subscriptionCancelledAt" TIMESTAMP(3),
    "queueJobId" TEXT,
    "storageDeletedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountDeletion_userId_key" ON "AccountDeletion"("userId");
CREATE INDEX "AccountDeletion_status_requestedAt_idx" ON "AccountDeletion"("status", "requestedAt");
ALTER TABLE "AccountDeletion" ADD CONSTRAINT "AccountDeletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

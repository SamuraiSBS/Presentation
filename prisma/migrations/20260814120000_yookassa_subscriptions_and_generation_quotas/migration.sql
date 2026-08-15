ALTER TYPE "PlanCode" ADD VALUE IF NOT EXISTS 'plus';

CREATE TYPE "GenerationQuotaReservationStatus" AS ENUM ('reserved', 'released');

ALTER TABLE "User"
  ADD COLUMN "subscriptionExpiresAt" TIMESTAMP(3),
  ADD COLUMN "subscriptionQuotaEpoch" TEXT;

CREATE INDEX "User_subscriptionExpiresAt_idx" ON "User"("subscriptionExpiresAt");

CREATE TABLE "GenerationQuotaCounter" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "quotaEpoch" TEXT NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GenerationQuotaCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GenerationQuotaCounter_userId_period_quotaEpoch_key"
  ON "GenerationQuotaCounter"("userId", "period", "quotaEpoch");
CREATE INDEX "GenerationQuotaCounter_userId_period_idx"
  ON "GenerationQuotaCounter"("userId", "period");

ALTER TABLE "GenerationQuotaCounter"
  ADD CONSTRAINT "GenerationQuotaCounter_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GenerationQuotaReservation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "generationJobId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "quotaEpoch" TEXT NOT NULL,
  "planCode" "PlanCode" NOT NULL,
  "status" "GenerationQuotaReservationStatus" NOT NULL DEFAULT 'reserved',
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GenerationQuotaReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GenerationQuotaReservation_generationJobId_key"
  ON "GenerationQuotaReservation"("generationJobId");
CREATE INDEX "GenerationQuotaReservation_userId_period_quotaEpoch_status_idx"
  ON "GenerationQuotaReservation"("userId", "period", "quotaEpoch", "status");

ALTER TABLE "GenerationQuotaReservation"
  ADD CONSTRAINT "GenerationQuotaReservation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "GenerationQuotaReservation_generationJobId_fkey"
  FOREIGN KEY ("generationJobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "YooKassaPayment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "planCode" "PlanCode" NOT NULL,
  "amountRub" DECIMAL(24,2) NOT NULL,
  "status" TEXT NOT NULL,
  "confirmationUrl" TEXT,
  "paidAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "YooKassaPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "YooKassaPayment_idempotencyKey_key" ON "YooKassaPayment"("idempotencyKey");
CREATE UNIQUE INDEX "YooKassaPayment_providerPaymentId_key" ON "YooKassaPayment"("providerPaymentId");
CREATE INDEX "YooKassaPayment_userId_createdAt_idx" ON "YooKassaPayment"("userId", "createdAt");
CREATE INDEX "YooKassaPayment_status_createdAt_idx" ON "YooKassaPayment"("status", "createdAt");

ALTER TABLE "YooKassaPayment"
  ADD CONSTRAINT "YooKassaPayment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentTransaction" ADD COLUMN "yooKassaPaymentId" TEXT;
CREATE UNIQUE INDEX "PaymentTransaction_yooKassaPaymentId_key" ON "PaymentTransaction"("yooKassaPaymentId");

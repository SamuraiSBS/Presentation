CREATE TYPE "CostEnvelopeStatus" AS ENUM ('active', 'completed', 'exhausted', 'cancelled');
CREATE TYPE "CostEnvelopeReservationStatus" AS ENUM ('reserved', 'settled', 'released', 'provider_error', 'unknown_usage', 'overrun');

CREATE TABLE "CostEnvelope" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "limitRub" DECIMAL(24,8) NOT NULL,
  "policySnapshot" JSONB NOT NULL,
  "catalogSnapshot" JSONB NOT NULL,
  "reservedRub" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "settledRub" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "releasedRub" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "status" "CostEnvelopeStatus" NOT NULL DEFAULT 'active',
  "narrationJobId" TEXT,
  "presentationJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostEnvelope_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostEnvelopeReservation" (
  "id" TEXT NOT NULL,
  "envelopeId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "status" "CostEnvelopeReservationStatus" NOT NULL DEFAULT 'reserved',
  "reservedRub" DECIMAL(24,8) NOT NULL,
  "settledRub" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "releasedRub" DECIMAL(24,8) NOT NULL DEFAULT 0,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "CostEnvelopeReservation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AiUsageEvent" ADD COLUMN "costEnvelopeId" TEXT, ADD COLUMN "pricingSnapshot" JSONB;
ALTER TABLE "CostEvent" ADD COLUMN "costEnvelopeId" TEXT, ADD COLUMN "pricingSnapshot" JSONB;

CREATE UNIQUE INDEX "CostEnvelope_narrationJobId_key" ON "CostEnvelope"("narrationJobId");
CREATE UNIQUE INDEX "CostEnvelope_presentationJobId_key" ON "CostEnvelope"("presentationJobId");
CREATE INDEX "CostEnvelope_projectId_status_createdAt_idx" ON "CostEnvelope"("projectId", "status", "createdAt");
CREATE UNIQUE INDEX "CostEnvelopeReservation_idempotencyKey_key" ON "CostEnvelopeReservation"("idempotencyKey");
CREATE INDEX "CostEnvelopeReservation_envelopeId_bucket_status_idx" ON "CostEnvelopeReservation"("envelopeId", "bucket", "status");
CREATE INDEX "AiUsageEvent_costEnvelopeId_createdAt_idx" ON "AiUsageEvent"("costEnvelopeId", "createdAt");
CREATE INDEX "CostEvent_costEnvelopeId_occurredAt_idx" ON "CostEvent"("costEnvelopeId", "occurredAt");

ALTER TABLE "CostEnvelope" ADD CONSTRAINT "CostEnvelope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostEnvelope" ADD CONSTRAINT "CostEnvelope_narrationJobId_fkey" FOREIGN KEY ("narrationJobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostEnvelope" ADD CONSTRAINT "CostEnvelope_presentationJobId_fkey" FOREIGN KEY ("presentationJobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostEnvelopeReservation" ADD CONSTRAINT "CostEnvelopeReservation_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "CostEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_costEnvelopeId_fkey" FOREIGN KEY ("costEnvelopeId") REFERENCES "CostEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostEvent" ADD CONSTRAINT "CostEvent_costEnvelopeId_fkey" FOREIGN KEY ("costEnvelopeId") REFERENCES "CostEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

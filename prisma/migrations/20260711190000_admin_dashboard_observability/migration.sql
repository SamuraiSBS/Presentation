CREATE TYPE "AiUsageStatus" AS ENUM ('succeeded', 'failed', 'unknown_usage', 'unknown_price');
CREATE TYPE "CostCategory" AS ENUM ('web_search', 'image_search', 'storage', 'export_compute', 'payment_fee', 'other');
CREATE TYPE "CostMeasurement" AS ENUM ('provider_reported', 'calculated');
CREATE TYPE "PaymentTransactionType" AS ENUM ('payment', 'refund', 'dispute', 'fee', 'adjustment');
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('pending', 'succeeded', 'failed', 'reversed');
CREATE TYPE "OperationalService" AS ENUM ('web', 'api', 'worker');
CREATE TYPE "OperationalSeverity" AS ENUM ('info', 'warn', 'error', 'critical');

ALTER TABLE "User"
  ADD COLUMN "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN "blockedAt" TIMESTAMP(3),
  ADD COLUMN "blockedById" TEXT,
  ADD COLUMN "blockReason" TEXT,
  ADD COLUMN "planOverride" "PlanCode",
  ADD COLUMN "planOverrideStartsAt" TIMESTAMP(3),
  ADD COLUMN "planOverrideExpiresAt" TIMESTAMP(3),
  ADD COLUMN "planOverrideReason" TEXT,
  ADD COLUMN "planOverrideActorId" TEXT;

ALTER TABLE "GenerationJob" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
ALTER TABLE "Export" ADD COLUMN "queueJobId" TEXT;

CREATE TABLE "AiUsageEvent" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "userId" TEXT,
  "projectId" TEXT,
  "generationJobId" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "schemaName" TEXT,
  "stage" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "providerRequestId" TEXT,
  "status" "AiUsageStatus" NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "cachedInputTokens" INTEGER,
  "reasoningTokens" INTEGER,
  "totalTokens" INTEGER,
  "durationMs" INTEGER,
  "sourceCurrency" TEXT,
  "inputPricePerMillion" DECIMAL(24,10),
  "outputPricePerMillion" DECIMAL(24,10),
  "cachedPricePerMillion" DECIMAL(24,10),
  "reasoningPricePerMillion" DECIMAL(24,10),
  "sourceCost" DECIMAL(24,10),
  "exchangeRateToRub" DECIMAL(24,10),
  "rubCostAtEvent" DECIMAL(24,10),
  "pricingVersion" TEXT,
  "priceEffectiveFrom" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorClass" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CostEvent" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "category" "CostCategory" NOT NULL,
  "userId" TEXT,
  "projectId" TEXT,
  "generationJobId" TEXT,
  "exportId" TEXT,
  "provider" TEXT NOT NULL,
  "quantity" DECIMAL(24,10) NOT NULL,
  "unit" TEXT NOT NULL,
  "unitPrice" DECIMAL(24,10),
  "sourceCurrency" TEXT NOT NULL,
  "sourceCost" DECIMAL(24,10),
  "exchangeRateToRub" DECIMAL(24,10),
  "rubCostAtEvent" DECIMAL(24,10),
  "measurement" "CostMeasurement" NOT NULL,
  "pricingVersion" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CostEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExchangeRate" (
  "id" TEXT NOT NULL,
  "baseCurrency" TEXT NOT NULL,
  "quoteCurrency" TEXT NOT NULL DEFAULT 'RUB',
  "rate" DECIMAL(24,10) NOT NULL,
  "provider" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentTransaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "stripeEventId" TEXT NOT NULL,
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "stripeInvoiceId" TEXT,
  "stripePaymentIntentId" TEXT,
  "stripeChargeId" TEXT,
  "type" "PaymentTransactionType" NOT NULL,
  "status" "PaymentTransactionStatus" NOT NULL,
  "grossAmount" DECIMAL(24,10) NOT NULL,
  "feeAmount" DECIMAL(24,10) NOT NULL DEFAULT 0,
  "netAmount" DECIMAL(24,10) NOT NULL,
  "currency" TEXT NOT NULL,
  "grossRubAtEvent" DECIMAL(24,10),
  "feeRubAtEvent" DECIMAL(24,10),
  "netRubAtEvent" DECIMAL(24,10),
  "exchangeRateToRub" DECIMAL(24,10),
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalEvent" (
  "id" TEXT NOT NULL,
  "service" "OperationalService" NOT NULL,
  "severity" "OperationalSeverity" NOT NULL,
  "category" TEXT NOT NULL,
  "operation" TEXT,
  "stage" TEXT,
  "userId" TEXT,
  "projectId" TEXT,
  "jobId" TEXT,
  "exportId" TEXT,
  "message" TEXT NOT NULL,
  "errorClass" TEXT,
  "errorCode" TEXT,
  "httpStatus" INTEGER,
  "sentryEventId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminAuditLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" JSONB,
  "requestId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserActivityEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "projectId" TEXT,
  "type" TEXT NOT NULL,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserActivityEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiUsageEvent_idempotencyKey_key" ON "AiUsageEvent"("idempotencyKey");
CREATE INDEX "AiUsageEvent_createdAt_idx" ON "AiUsageEvent"("createdAt");
CREATE INDEX "AiUsageEvent_userId_createdAt_idx" ON "AiUsageEvent"("userId", "createdAt");
CREATE INDEX "AiUsageEvent_projectId_createdAt_idx" ON "AiUsageEvent"("projectId", "createdAt");
CREATE INDEX "AiUsageEvent_generationJobId_createdAt_idx" ON "AiUsageEvent"("generationJobId", "createdAt");
CREATE INDEX "AiUsageEvent_provider_model_createdAt_idx" ON "AiUsageEvent"("provider", "model", "createdAt");
CREATE INDEX "AiUsageEvent_status_createdAt_idx" ON "AiUsageEvent"("status", "createdAt");
CREATE UNIQUE INDEX "CostEvent_idempotencyKey_key" ON "CostEvent"("idempotencyKey");
CREATE INDEX "CostEvent_occurredAt_idx" ON "CostEvent"("occurredAt");
CREATE INDEX "CostEvent_category_occurredAt_idx" ON "CostEvent"("category", "occurredAt");
CREATE INDEX "CostEvent_userId_occurredAt_idx" ON "CostEvent"("userId", "occurredAt");
CREATE INDEX "CostEvent_projectId_occurredAt_idx" ON "CostEvent"("projectId", "occurredAt");
CREATE UNIQUE INDEX "ExchangeRate_baseCurrency_quoteCurrency_effectiveAt_key" ON "ExchangeRate"("baseCurrency", "quoteCurrency", "effectiveAt");
CREATE INDEX "ExchangeRate_baseCurrency_quoteCurrency_effectiveAt_idx" ON "ExchangeRate"("baseCurrency", "quoteCurrency", "effectiveAt");
CREATE UNIQUE INDEX "PaymentTransaction_stripeEventId_key" ON "PaymentTransaction"("stripeEventId");
CREATE INDEX "PaymentTransaction_occurredAt_idx" ON "PaymentTransaction"("occurredAt");
CREATE INDEX "PaymentTransaction_userId_occurredAt_idx" ON "PaymentTransaction"("userId", "occurredAt");
CREATE INDEX "PaymentTransaction_type_occurredAt_idx" ON "PaymentTransaction"("type", "occurredAt");
CREATE INDEX "OperationalEvent_occurredAt_idx" ON "OperationalEvent"("occurredAt");
CREATE INDEX "OperationalEvent_expiresAt_idx" ON "OperationalEvent"("expiresAt");
CREATE INDEX "OperationalEvent_severity_occurredAt_idx" ON "OperationalEvent"("severity", "occurredAt");
CREATE INDEX "OperationalEvent_service_occurredAt_idx" ON "OperationalEvent"("service", "occurredAt");
CREATE INDEX "OperationalEvent_fingerprint_occurredAt_idx" ON "OperationalEvent"("fingerprint", "occurredAt");
CREATE INDEX "OperationalEvent_userId_occurredAt_idx" ON "OperationalEvent"("userId", "occurredAt");
CREATE INDEX "OperationalEvent_projectId_occurredAt_idx" ON "OperationalEvent"("projectId", "occurredAt");
CREATE INDEX "OperationalEvent_jobId_occurredAt_idx" ON "OperationalEvent"("jobId", "occurredAt");
CREATE INDEX "AdminAuditLog_occurredAt_idx" ON "AdminAuditLog"("occurredAt");
CREATE INDEX "AdminAuditLog_actorUserId_occurredAt_idx" ON "AdminAuditLog"("actorUserId", "occurredAt");
CREATE INDEX "AdminAuditLog_targetType_targetId_occurredAt_idx" ON "AdminAuditLog"("targetType", "targetId", "occurredAt");
CREATE INDEX "UserActivityEvent_userId_occurredAt_idx" ON "UserActivityEvent"("userId", "occurredAt");
CREATE INDEX "UserActivityEvent_projectId_occurredAt_idx" ON "UserActivityEvent"("projectId", "occurredAt");
CREATE INDEX "UserActivityEvent_type_occurredAt_idx" ON "UserActivityEvent"("type", "occurredAt");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");
CREATE INDEX "User_blockedAt_idx" ON "User"("blockedAt");

ALTER TABLE "User" ADD CONSTRAINT "User_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_planOverrideActorId_fkey" FOREIGN KEY ("planOverrideActorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostEvent" ADD CONSTRAINT "CostEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostEvent" ADD CONSTRAINT "CostEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostEvent" ADD CONSTRAINT "CostEvent_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CostEvent" ADD CONSTRAINT "CostEvent_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "Export"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperationalEvent" ADD CONSTRAINT "OperationalEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperationalEvent" ADD CONSTRAINT "OperationalEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OperationalEvent" ADD CONSTRAINT "OperationalEvent_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "Export"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserActivityEvent" ADD CONSTRAINT "UserActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserActivityEvent" ADD CONSTRAINT "UserActivityEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserActivityEvent" ADD CONSTRAINT "UserActivityEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

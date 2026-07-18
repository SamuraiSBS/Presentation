-- Extend the existing generation queue without changing narration/presentation semantics.
ALTER TYPE "GenerationJobKind" ADD VALUE IF NOT EXISTS 'requirements_analysis';
ALTER TYPE "GenerationJobKind" ADD VALUE IF NOT EXISTS 'compliance';

CREATE TYPE "ProjectWorkflow" AS ENUM ('standard', 'requirements_driven');
CREATE TYPE "DefenseType" AS ENUM ('hackathon', 'diploma');
CREATE TYPE "ComplianceMode" AS ENUM ('strict', 'adaptive');
CREATE TYPE "DefenseAnalysisStatus" AS ENUM ('draft', 'queued', 'analyzing', 'review_ready', 'ready', 'failed');
CREATE TYPE "SourceRole" AS ENUM (
  'project_document',
  'technical_spec',
  'defense_spec',
  'style_reference',
  'screenshot',
  'logo',
  'supporting_image',
  'repository_document',
  'archive_document',
  'web_image'
);
CREATE TYPE "RequirementPriority" AS ENUM ('required', 'recommended', 'preference');
CREATE TYPE "RequirementOrigin" AS ENUM ('builtin', 'source', 'user');
CREATE TYPE "RequirementState" AS ENUM ('active', 'ignored');
CREATE TYPE "FactConfirmation" AS ENUM ('source', 'user');
CREATE TYPE "FactState" AS ENUM ('active', 'removed');
CREATE TYPE "ConflictState" AS ENUM ('unresolved', 'resolved', 'ignored');
CREATE TYPE "ComplianceItemResult" AS ENUM ('satisfied', 'partial', 'unsatisfied', 'ignored', 'needs_review');
CREATE TYPE "ComplianceReportStatus" AS ENUM ('queued', 'processing', 'ready', 'failed');

ALTER TABLE "Project"
ADD COLUMN "workflow" "ProjectWorkflow" NOT NULL DEFAULT 'standard';

ALTER TABLE "GenerationJob"
ADD COLUMN "requestKey" TEXT;

ALTER TABLE "Source"
ADD COLUMN "parentSourceId" TEXT,
ADD COLUMN "role" "SourceRole",
ADD COLUMN "metadata" JSONB;

CREATE TABLE "DefenseWorkspace" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "defenseType" "DefenseType" NOT NULL,
  "complianceMode" "ComplianceMode" NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'ru',
  "targetSlideCount" INTEGER NOT NULL DEFAULT 10,
  "targetDurationSeconds" INTEGER NOT NULL DEFAULT 420,
  "allowWebImages" BOOLEAN NOT NULL DEFAULT false,
  "authorProfile" JSONB NOT NULL DEFAULT '{}',
  "standardPresetVersion" TEXT NOT NULL,
  "analysisStatus" "DefenseAnalysisStatus" NOT NULL DEFAULT 'draft',
  "analysisRevision" INTEGER NOT NULL DEFAULT 0,
  "styleBrief" JSONB,
  "plan" JSONB,
  "planRevision" INTEGER NOT NULL DEFAULT 0,
  "analysisError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DefenseWorkspace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DefenseWorkspace_targetSlideCount_check" CHECK ("targetSlideCount" BETWEEN 4 AND 20),
  CONSTRAINT "DefenseWorkspace_targetDurationSeconds_check" CHECK ("targetDurationSeconds" BETWEEN 60 AND 900),
  CONSTRAINT "DefenseWorkspace_language_check" CHECK ("language" = 'ru')
);

CREATE TABLE "ProjectFact" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "key" TEXT,
  "statement" TEXT NOT NULL,
  "value" JSONB,
  "state" "FactState" NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FactEvidence" (
  "id" TEXT NOT NULL,
  "factId" TEXT NOT NULL,
  "confirmation" "FactConfirmation" NOT NULL,
  "sourceId" TEXT,
  "locator" TEXT,
  "excerpt" TEXT,
  "confirmedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FactEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectRequirement" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "key" TEXT,
  "text" TEXT NOT NULL,
  "priority" "RequirementPriority" NOT NULL DEFAULT 'required',
  "origin" "RequirementOrigin" NOT NULL,
  "state" "RequirementState" NOT NULL DEFAULT 'active',
  "sourceId" TEXT,
  "locator" TEXT,
  "excerpt" TEXT,
  "rule" JSONB,
  "presetVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectConflict" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "options" JSONB NOT NULL,
  "state" "ConflictState" NOT NULL DEFAULT 'unresolved',
  "resolution" JSONB,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectConflict_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplianceReport" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "status" "ComplianceReportStatus" NOT NULL DEFAULT 'queued',
  "requestKey" TEXT,
  "queueJobId" TEXT,
  "presentationRevision" INTEGER NOT NULL,
  "analysisRevision" INTEGER NOT NULL,
  "planRevision" INTEGER NOT NULL,
  "document" JSONB NOT NULL DEFAULT '{}',
  "requiredSatisfied" INTEGER NOT NULL DEFAULT 0,
  "requiredTotal" INTEGER NOT NULL DEFAULT 0,
  "recommendedSatisfied" INTEGER NOT NULL DEFAULT 0,
  "recommendedTotal" INTEGER NOT NULL DEFAULT 0,
  "preferenceSatisfied" INTEGER NOT NULL DEFAULT 0,
  "preferenceTotal" INTEGER NOT NULL DEFAULT 0,
  "pdfObjectKey" TEXT,
  "pdfStatus" "ExportStatus",
  "pdfQueueJobId" TEXT,
  "pdfRequestKey" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ComplianceReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DefenseWorkspace_projectId_key" ON "DefenseWorkspace"("projectId");
CREATE INDEX "DefenseWorkspace_analysisStatus_updatedAt_idx" ON "DefenseWorkspace"("analysisStatus", "updatedAt");
CREATE INDEX "Source_parentSourceId_idx" ON "Source"("parentSourceId");
CREATE INDEX "Source_projectId_role_idx" ON "Source"("projectId", "role");
CREATE UNIQUE INDEX "ProjectFact_workspaceId_key_key" ON "ProjectFact"("workspaceId", "key");
CREATE INDEX "ProjectFact_workspaceId_state_idx" ON "ProjectFact"("workspaceId", "state");
CREATE INDEX "FactEvidence_factId_idx" ON "FactEvidence"("factId");
CREATE INDEX "FactEvidence_sourceId_idx" ON "FactEvidence"("sourceId");
CREATE INDEX "FactEvidence_confirmedById_idx" ON "FactEvidence"("confirmedById");
CREATE UNIQUE INDEX "ProjectRequirement_workspaceId_key_key" ON "ProjectRequirement"("workspaceId", "key");
CREATE INDEX "ProjectRequirement_workspaceId_state_priority_idx" ON "ProjectRequirement"("workspaceId", "state", "priority");
CREATE INDEX "ProjectRequirement_sourceId_idx" ON "ProjectRequirement"("sourceId");
CREATE INDEX "ProjectConflict_workspaceId_state_idx" ON "ProjectConflict"("workspaceId", "state");
CREATE INDEX "ProjectConflict_resolvedById_idx" ON "ProjectConflict"("resolvedById");
CREATE INDEX "ComplianceReport_workspaceId_createdAt_idx" ON "ComplianceReport"("workspaceId", "createdAt");
CREATE INDEX "ComplianceReport_workspaceId_status_createdAt_idx" ON "ComplianceReport"("workspaceId", "status", "createdAt");
CREATE UNIQUE INDEX "GenerationJob_projectId_kind_requestKey_key" ON "GenerationJob"("projectId", "kind", "requestKey");
CREATE UNIQUE INDEX "ComplianceReport_workspaceId_requestKey_key" ON "ComplianceReport"("workspaceId", "requestKey");

ALTER TABLE "Source"
ADD CONSTRAINT "Source_parentSourceId_fkey"
FOREIGN KEY ("parentSourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DefenseWorkspace"
ADD CONSTRAINT "DefenseWorkspace_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectFact"
ADD CONSTRAINT "ProjectFact_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "DefenseWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FactEvidence"
ADD CONSTRAINT "FactEvidence_factId_fkey"
FOREIGN KEY ("factId") REFERENCES "ProjectFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FactEvidence"
ADD CONSTRAINT "FactEvidence_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FactEvidence"
ADD CONSTRAINT "FactEvidence_confirmedById_fkey"
FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectRequirement"
ADD CONSTRAINT "ProjectRequirement_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "DefenseWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectRequirement"
ADD CONSTRAINT "ProjectRequirement_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectConflict"
ADD CONSTRAINT "ProjectConflict_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "DefenseWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectConflict"
ADD CONSTRAINT "ProjectConflict_resolvedById_fkey"
FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ComplianceReport"
ADD CONSTRAINT "ComplianceReport_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "DefenseWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

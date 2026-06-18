CREATE TYPE "GenerationJobKind" AS ENUM ('narration', 'presentation');

ALTER TYPE "ProjectStatus" ADD VALUE 'script_queued';
ALTER TYPE "ProjectStatus" ADD VALUE 'script_generating';
ALTER TYPE "ProjectStatus" ADD VALUE 'script_ready';

ALTER TABLE "Project"
ADD COLUMN "speechDraft" TEXT,
ADD COLUMN "speechDraftUpdatedAt" TIMESTAMP(3);

ALTER TABLE "GenerationJob"
ADD COLUMN "kind" "GenerationJobKind" NOT NULL DEFAULT 'presentation';

CREATE INDEX "GenerationJob_projectId_kind_createdAt_idx" ON "GenerationJob"("projectId", "kind", "createdAt");

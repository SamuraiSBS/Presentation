CREATE TABLE "GenerationFailureArtifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "generationJobId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "releaseIdentifier" TEXT,
    "candidateHash" TEXT,
    "failureFingerprint" TEXT NOT NULL,
    "structuralDiff" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationFailureArtifact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GenerationFailureArtifact_expiresAt_idx" ON "GenerationFailureArtifact"("expiresAt");
CREATE INDEX "GenerationFailureArtifact_projectId_createdAt_idx" ON "GenerationFailureArtifact"("projectId", "createdAt");
CREATE INDEX "GenerationFailureArtifact_generationJobId_idx" ON "GenerationFailureArtifact"("generationJobId");
CREATE INDEX "GenerationFailureArtifact_failureFingerprint_createdAt_idx" ON "GenerationFailureArtifact"("failureFingerprint", "createdAt");

ALTER TABLE "GenerationFailureArtifact" ADD CONSTRAINT "GenerationFailureArtifact_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GenerationFailureArtifact" ADD CONSTRAINT "GenerationFailureArtifact_generationJobId_fkey"
  FOREIGN KEY ("generationJobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Review data is deliberately separate from Presentation: existing ready
-- projects continue using their current document and never enter this flow.
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'design_review';
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'design_finalizing';

CREATE TYPE "DesignReviewStatus" AS ENUM ('active', 'finalizing', 'failed');
CREATE TYPE "DesignCandidateStatus" AS ENUM ('pending', 'approved', 'regenerating', 'failed');

CREATE TABLE "DesignReview" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "DesignReviewStatus" NOT NULL DEFAULT 'active',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DesignReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DesignReview_projectId_key" ON "DesignReview"("projectId");
CREATE TABLE "DesignReviewCandidate" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "slideId" TEXT NOT NULL,
  "slideOrder" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "DesignCandidateStatus" NOT NULL DEFAULT 'pending',
  "canvas" JSONB NOT NULL,
  "visualAssets" JSONB,
  "diagramModel" JSONB,
  "comment" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DesignReviewCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DesignReviewCandidate_reviewId_slideId_version_key" ON "DesignReviewCandidate"("reviewId", "slideId", "version");
CREATE INDEX "DesignReviewCandidate_reviewId_slideOrder_version_idx" ON "DesignReviewCandidate"("reviewId", "slideOrder", "version");
ALTER TABLE "DesignReview" ADD CONSTRAINT "DesignReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DesignReviewCandidate" ADD CONSTRAINT "DesignReviewCandidate_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "DesignReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

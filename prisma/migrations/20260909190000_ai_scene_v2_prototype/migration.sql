-- Additive v2 scene metadata.  The 20260908120000 design-review migration is
-- intentionally left untouched so existing review records remain readable.
ALTER TABLE "DesignReview"
  ADD COLUMN "deckStyleSpec" JSONB,
  ADD COLUMN "designEngine" TEXT NOT NULL DEFAULT 'template',
  ADD COLUMN "styleVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "DesignReviewCandidate"
  ADD COLUMN "conceptObjectKey" TEXT,
  ADD COLUMN "renderedPreviewObjectKey" TEXT,
  ADD COLUMN "sceneSpec" JSONB,
  ADD COLUMN "contentLock" JSONB,
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "qualityReport" JSONB,
  ADD COLUMN "providerMetadata" JSONB,
  ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'template',
  ADD COLUMN "generationDurationMs" INTEGER;

CREATE INDEX "DesignReviewCandidate_reviewId_engine_idx"
  ON "DesignReviewCandidate"("reviewId", "engine");

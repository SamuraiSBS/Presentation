-- A source remains unconfirmed for funnel reporting until its owner explicitly
-- reviews its inclusion in the presentation. No source text is copied here.
ALTER TABLE "Source" ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "Source_projectId_reviewedAt_idx" ON "Source"("projectId", "reviewedAt");

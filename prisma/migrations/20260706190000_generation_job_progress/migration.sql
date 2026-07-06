ALTER TABLE "GenerationJob"
  ADD COLUMN "progressStage" TEXT NOT NULL DEFAULT 'queued',
  ADD COLUMN "progressLabel" TEXT NOT NULL DEFAULT 'В очереди',
  ADD COLUMN "progressPercent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "stageStartedAt" TIMESTAMP(3);

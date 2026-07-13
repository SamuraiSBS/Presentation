ALTER TABLE "Source"
ADD COLUMN "included" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Export"
ADD COLUMN "presentationRevision" INTEGER;

UPDATE "Export" AS export
SET "presentationRevision" = COALESCE(presentation."revision", 0)
FROM "Presentation" AS presentation
WHERE presentation."projectId" = export."projectId";

UPDATE "Export"
SET "presentationRevision" = 0
WHERE "presentationRevision" IS NULL;

ALTER TABLE "Export"
ALTER COLUMN "presentationRevision" SET NOT NULL;

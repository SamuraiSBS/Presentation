-- Retention and quota enforcement need a durable byte count rather than an
-- object-store listing at request time. Existing rows are intentionally zero:
-- their objects will age out through the normal retention pass.
ALTER TABLE "Export" ADD COLUMN "sizeBytes" INTEGER NOT NULL DEFAULT 0;

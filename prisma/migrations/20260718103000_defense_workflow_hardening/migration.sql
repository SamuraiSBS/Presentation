-- Make user-visible defense actions retry-safe without changing the legacy flow.
ALTER TABLE "Project"
ADD COLUMN "creationRequestKey" TEXT;

CREATE UNIQUE INDEX "Project_userId_creationRequestKey_key"
ON "Project"("userId", "creationRequestKey");

CREATE UNIQUE INDEX "Source_projectId_role_url_key"
ON "Source"("projectId", "role", "url");

ALTER TABLE "Export"
ADD COLUMN "requestKey" TEXT;

CREATE UNIQUE INDEX "Export_projectId_type_presentationRevision_requestKey_key"
ON "Export"("projectId", "type", "presentationRevision", "requestKey");

ALTER TABLE "Source"
ADD COLUMN "uploadRequestKey" TEXT,
ADD COLUMN "uploadFieldName" TEXT;

CREATE UNIQUE INDEX "Source_projectId_uploadRequestKey_uploadFieldName_key"
ON "Source"("projectId", "uploadRequestKey", "uploadFieldName");

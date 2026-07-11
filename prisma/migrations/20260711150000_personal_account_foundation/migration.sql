-- CreateEnum
CREATE TYPE "ProjectMemberRole" AS ENUM ('editor', 'viewer');

-- CreateEnum
CREATE TYPE "FolderColor" AS ENUM ('orange', 'green', 'purple', 'blue', 'neutral');

-- ExtendUser
ALTER TABLE "User"
ADD COLUMN "telegramId" TEXT,
ADD COLUMN "telegramUsername" TEXT;

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" "FolderColor" NOT NULL DEFAULT 'orange',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- ExtendProject
ALTER TABLE "Project" ADD COLUMN "folderId" TEXT;

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInvitation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "ProjectMemberRole" NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectInvitation_pkey" PRIMARY KEY ("id")
);

-- ExtendPresentation
ALTER TABLE "Presentation" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- ExtendUsageCounter
ALTER TABLE "UsageCounter" ADD COLUMN "presentationsCreated" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_ownerId_name_key" ON "Folder"("ownerId", "name");

-- CreateIndex
CREATE INDEX "Folder_ownerId_sortOrder_idx" ON "Folder"("ownerId", "sortOrder");

-- CreateIndex
CREATE INDEX "Project_folderId_updatedAt_idx" ON "Project"("folderId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_updatedAt_idx" ON "ProjectMember"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInvitation_tokenHash_key" ON "ProjectInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "ProjectInvitation_projectId_createdAt_idx" ON "ProjectInvitation"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill monthly creation usage from projects that still exist. Prisma stores
-- DateTime as a timestamp without time zone, so interpret it as UTC before
-- grouping by the product period in Europe/Moscow.
WITH "projectCounts" AS (
    SELECT
        "userId",
        to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow', 'YYYY-MM') AS "period",
        COUNT(*)::INTEGER AS "presentationsCreated"
    FROM "Project"
    GROUP BY
        "userId",
        to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow', 'YYYY-MM')
)
INSERT INTO "UsageCounter" (
    "id",
    "userId",
    "period",
    "generated",
    "presentationsCreated",
    "createdAt",
    "updatedAt"
)
SELECT
    'usage_' || md5("userId" || ':' || "period"),
    "userId",
    "period",
    0,
    "presentationsCreated",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "projectCounts"
ON CONFLICT ("userId", "period") DO UPDATE
SET
    "presentationsCreated" = GREATEST(
        "UsageCounter"."presentationsCreated",
        EXCLUDED."presentationsCreated"
    ),
    "updatedAt" = CURRENT_TIMESTAMP;

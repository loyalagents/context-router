/*
  Warnings:

  - You are about to drop the `preferences` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "PreferenceStatus" AS ENUM ('ACTIVE', 'SUGGESTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('USER', 'INFERRED', 'IMPORTED', 'SYSTEM');

-- DropForeignKey
ALTER TABLE "preferences" DROP CONSTRAINT "preferences_location_id_fkey";

-- DropForeignKey
ALTER TABLE "preferences" DROP CONSTRAINT "preferences_user_id_fkey";

-- DropTable
DROP TABLE "preferences";

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "location_id" TEXT,
    "slug" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "status" "PreferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceType" "SourceType" NOT NULL DEFAULT 'USER',
    "confidence" DOUBLE PRECISION,
    "evidence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_preferences_user_id_location_id_idx" ON "user_preferences"("user_id", "location_id");

-- CreateIndex
CREATE INDEX "user_preferences_slug_idx" ON "user_preferences"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_location_id_slug_status_key" ON "user_preferences"("user_id", "location_id", "slug", "status");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("location_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index for global preferences (locationId IS NULL)
-- Postgres treats NULL as "not equal" in UNIQUE constraints, so the standard unique index
-- does NOT prevent duplicate global prefs. This partial index enforces uniqueness for global prefs.
CREATE UNIQUE INDEX "user_preferences_global_unique"
ON "user_preferences" ("user_id", "slug", "status")
WHERE "location_id" IS NULL;

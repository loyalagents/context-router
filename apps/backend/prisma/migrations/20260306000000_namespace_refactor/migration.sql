-- ============================================================
-- namespace_refactor: restructure preference_definitions and
-- user_preferences for namespace-aware, UUID-keyed definitions
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- STEP 1: Drop all user_preferences FKs and indexes that
--         reference preference_definitions(slug) FIRST,
--         so we can safely change the PK on preference_definitions.
-- ────────────────────────────────────────────────────────────
ALTER TABLE "user_preferences" DROP CONSTRAINT IF EXISTS "user_preferences_slug_fkey";
DROP INDEX IF EXISTS "user_preferences_user_id_location_id_slug_status_key";
DROP INDEX IF EXISTS "user_preferences_global_unique";
DROP INDEX IF EXISTS "user_preferences_slug_idx";
DROP INDEX IF EXISTS "user_preferences_user_id_location_id_idx";

-- ────────────────────────────────────────────────────────────
-- STEP 2: Restructure preference_definitions
-- ────────────────────────────────────────────────────────────

-- 2a. Add new columns (nullable so existing rows are compatible)
ALTER TABLE "preference_definitions"
  ADD COLUMN "id"            TEXT,
  ADD COLUMN "namespace"     TEXT NOT NULL DEFAULT 'GLOBAL',
  ADD COLUMN "display_name"  TEXT,
  ADD COLUMN "owner_user_id" TEXT,
  ADD COLUMN "archived_at"   TIMESTAMP(3);

-- 2b. Populate id for every existing row
UPDATE "preference_definitions" SET "id" = gen_random_uuid()::TEXT WHERE "id" IS NULL;

-- 2c. Make id NOT NULL
ALTER TABLE "preference_definitions" ALTER COLUMN "id" SET NOT NULL;

-- 2d. Swap primary key: drop slug-based PK, add id-based PK
ALTER TABLE "preference_definitions" DROP CONSTRAINT "preference_definitions_pkey";
ALTER TABLE "preference_definitions" ADD CONSTRAINT "preference_definitions_pkey" PRIMARY KEY ("id");

-- 2e. Add FK for owner_user_id → users
ALTER TABLE "preference_definitions"
  ADD CONSTRAINT "preference_definitions_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2f. Partial unique index: only one active (non-archived) def per (namespace, slug)
CREATE UNIQUE INDEX "uniq_active_def_per_namespace_slug"
  ON "preference_definitions"("namespace", "slug")
  WHERE ("archived_at" IS NULL);

-- 2g. Supporting indexes
CREATE INDEX "preference_definitions_namespace_slug_idx" ON "preference_definitions"("namespace", "slug");
CREATE INDEX "preference_definitions_namespace_idx"       ON "preference_definitions"("namespace");
CREATE INDEX "preference_definitions_owner_user_id_idx"   ON "preference_definitions"("owner_user_id");

-- ────────────────────────────────────────────────────────────
-- STEP 3: Restructure user_preferences
-- ────────────────────────────────────────────────────────────

-- 3a. Add new columns (nullable first)
ALTER TABLE "user_preferences"
  ADD COLUMN "context_key"   TEXT,
  ADD COLUMN "definition_id" TEXT;

-- 3b. Populate context_key from existing location_id
UPDATE "user_preferences"
  SET "context_key" = CASE
    WHEN "location_id" IS NULL THEN 'GLOBAL'
    ELSE 'LOCATION:' || "location_id"
  END
  WHERE "context_key" IS NULL;

-- 3c. Populate definition_id by joining slug → preference_definitions.id
UPDATE "user_preferences" up
  SET "definition_id" = pd."id"
  FROM "preference_definitions" pd
  WHERE pd."slug" = up."slug"
    AND pd."namespace" = 'GLOBAL';

-- 3d. Make both columns NOT NULL
ALTER TABLE "user_preferences" ALTER COLUMN "context_key"   SET NOT NULL;
ALTER TABLE "user_preferences" ALTER COLUMN "definition_id" SET NOT NULL;

-- 3e. Drop old slug column
ALTER TABLE "user_preferences" DROP COLUMN "slug";

-- 3f. Add FK for definition_id → preference_definitions
ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_definition_id_fkey"
  FOREIGN KEY ("definition_id") REFERENCES "preference_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3g. New unique constraint and indexes
CREATE UNIQUE INDEX "user_preferences_user_id_context_key_definition_id_status_key"
  ON "user_preferences"("user_id", "context_key", "definition_id", "status");

CREATE INDEX "user_preferences_user_id_context_key_idx" ON "user_preferences"("user_id", "context_key");
CREATE INDEX "user_preferences_definition_id_idx"        ON "user_preferences"("definition_id");

-- Reconcile legacy users table columns left behind by older migration paths.
-- Account identity is now only user_id, email, and timestamps; editable profile
-- data lives in profile.* preferences.

UPDATE "users"
SET "email" = CONCAT('missing-', "user_id", '@unknown.local')
WHERE "email" IS NULL;

ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;

ALTER TABLE "users" DROP COLUMN IF EXISTS "phone";
ALTER TABLE "users" DROP COLUMN IF EXISTS "username";
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash";
ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified";
ALTER TABLE "users" DROP COLUMN IF EXISTS "phone_verified";
ALTER TABLE "users" DROP COLUMN IF EXISTS "status";

DROP TYPE IF EXISTS "UserStatus";

-- CreateTable
CREATE TABLE "external_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

-- Migrate existing auth0_id data to external_identities table
INSERT INTO "external_identities" (id, user_id, provider, provider_user_id, created_at, updated_at)
SELECT
    gen_random_uuid(),
    user_id,
    'auth0',
    auth0_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "users"
WHERE auth0_id IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_provider_provider_user_id_key" ON "external_identities"("provider", "provider_user_id");

-- CreateIndex
CREATE INDEX "external_identities_user_id_idx" ON "external_identities"("user_id");

-- CreateIndex
CREATE INDEX "external_identities_provider_provider_user_id_idx" ON "external_identities"("provider", "provider_user_id");

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex
DROP INDEX IF EXISTS "users_auth0_id_idx";

-- DropIndex
DROP INDEX IF EXISTS "users_auth0_id_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN IF EXISTS "auth0_id";

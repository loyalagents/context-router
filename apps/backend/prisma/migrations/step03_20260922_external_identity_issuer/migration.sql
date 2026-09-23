BEGIN;

LOCK TABLE "users", "external_identities" IN ACCESS EXCLUSIVE MODE;

-- A user-owned definition can be referenced by a preference through a
-- RESTRICT edge while the definition itself cascades from users. Delete the
-- referencing rows explicitly before deleting every user-owned row.
DELETE FROM "user_preferences";
DELETE FROM "users";

ALTER TABLE "external_identities" ADD COLUMN "issuer" TEXT NOT NULL;

DROP INDEX "external_identities_provider_provider_user_id_key";
DROP INDEX "external_identities_provider_provider_user_id_idx";
DROP INDEX "users_email_key";

CREATE UNIQUE INDEX "external_identities_provider_issuer_provider_user_id_key"
ON "external_identities"("provider", "issuer", "provider_user_id");

CREATE INDEX "external_identities_provider_issuer_provider_user_id_idx"
ON "external_identities"("provider", "issuer", "provider_user_id");

COMMIT;

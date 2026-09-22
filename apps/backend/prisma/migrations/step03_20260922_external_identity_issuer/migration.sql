BEGIN;

ALTER TABLE "external_identities" ADD COLUMN "issuer" TEXT;

UPDATE "external_identities"
SET "issuer" = 'urn:context-router:legacy-issuer'
WHERE "issuer" IS NULL;

ALTER TABLE "external_identities" ALTER COLUMN "issuer" SET NOT NULL;

CREATE UNIQUE INDEX "external_identities_provider_issuer_provider_user_id_key"
ON "external_identities"("provider", "issuer", "provider_user_id");

CREATE INDEX "external_identities_provider_issuer_provider_user_id_idx"
ON "external_identities"("provider", "issuer", "provider_user_id");

DROP INDEX "external_identities_provider_provider_user_id_key";
DROP INDEX "external_identities_provider_provider_user_id_idx";

COMMIT;

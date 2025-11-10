-- AlterTable
ALTER TABLE "users" ADD COLUMN "auth0_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_auth0_id_key" ON "users"("auth0_id");

-- CreateIndex
CREATE INDEX "users_auth0_id_idx" ON "users"("auth0_id");

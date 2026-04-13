-- CreateEnum
CREATE TYPE "GrantAction" AS ENUM ('READ', 'WRITE');

-- CreateEnum
CREATE TYPE "GrantEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateTable
CREATE TABLE "permission_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_key" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "action" "GrantAction" NOT NULL,
    "effect" "GrantEffect" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "permission_grants_user_id_client_key_target_action_key"
ON "permission_grants"("user_id", "client_key", "target", "action");

-- CreateIndex
CREATE INDEX "permission_grants_user_id_client_key_action_idx"
ON "permission_grants"("user_id", "client_key", "action");

-- AddForeignKey
ALTER TABLE "permission_grants"
ADD CONSTRAINT "permission_grants_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

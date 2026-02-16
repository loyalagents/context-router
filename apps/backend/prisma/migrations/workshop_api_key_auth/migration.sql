-- DropTable
DROP TABLE IF EXISTS "external_identities";

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key_users" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_key_users_api_key_id_idx" ON "api_key_users"("api_key_id");

-- CreateIndex
CREATE INDEX "api_key_users_user_id_idx" ON "api_key_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_users_api_key_id_user_id_key" ON "api_key_users"("api_key_id", "user_id");

-- AddForeignKey
ALTER TABLE "api_key_users" ADD CONSTRAINT "api_key_users_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key_users" ADD CONSTRAINT "api_key_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

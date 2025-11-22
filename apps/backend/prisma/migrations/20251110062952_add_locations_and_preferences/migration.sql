-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('HOME', 'WORK', 'OTHER');

-- CreateTable
CREATE TABLE "locations" (
    "location_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("location_id")
);

-- CreateTable
CREATE TABLE "preferences" (
    "preference_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "location_id" TEXT,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preferences_pkey" PRIMARY KEY ("preference_id")
);

-- CreateIndex
CREATE INDEX "locations_user_id_idx" ON "locations"("user_id");

-- CreateIndex
CREATE INDEX "locations_user_id_type_idx" ON "locations"("user_id", "type");

-- CreateIndex
CREATE INDEX "preferences_user_id_idx" ON "preferences"("user_id");

-- CreateIndex
CREATE INDEX "preferences_location_id_idx" ON "preferences"("location_id");

-- CreateIndex
CREATE INDEX "preferences_user_id_category_idx" ON "preferences"("user_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "preferences_user_id_location_id_category_key_key" ON "preferences"("user_id", "location_id", "category", "key");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("location_id") ON DELETE CASCADE ON UPDATE CASCADE;

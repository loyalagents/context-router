-- AlterTable
ALTER TABLE "users" ADD COLUMN "schema_namespace" TEXT NOT NULL DEFAULT 'GLOBAL';

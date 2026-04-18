-- CreateEnum
CREATE TYPE "AuditTargetType" AS ENUM ('PREFERENCE', 'PREFERENCE_DEFINITION');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'MCP_CLIENT', 'SYSTEM', 'WORKFLOW', 'IMPORT');

-- CreateEnum
CREATE TYPE "AuditOrigin" AS ENUM ('GRAPHQL', 'MCP', 'DOCUMENT_ANALYSIS', 'WORKFLOW', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM (
    'PREFERENCE_SET',
    'PREFERENCE_SUGGESTED_UPSERTED',
    'PREFERENCE_SUGGESTION_ACCEPTED',
    'PREFERENCE_SUGGESTION_REJECTED',
    'PREFERENCE_DELETED',
    'DEFINITION_CREATED',
    'DEFINITION_UPDATED',
    'DEFINITION_ARCHIVED'
);

-- CreateTable
CREATE TABLE "preference_audit_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "target_type" "AuditTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "event_type" "AuditEventType" NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_client_key" TEXT,
    "origin" "AuditOrigin" NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "metadata" JSONB,

    CONSTRAINT "preference_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "preference_audit_events_user_id_occurred_at_idx" ON "preference_audit_events"("user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "preference_audit_events_user_id_event_type_occurred_at_idx" ON "preference_audit_events"("user_id", "event_type", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "preference_audit_events_target_type_target_id_occurred_at_idx" ON "preference_audit_events"("target_type", "target_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "preference_audit_events_correlation_id_idx" ON "preference_audit_events"("correlation_id");

-- AddForeignKey
ALTER TABLE "preference_audit_events" ADD CONSTRAINT "preference_audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "McpAccessSurface" AS ENUM ('TOOLS_CALL', 'RESOURCES_READ');

-- CreateEnum
CREATE TYPE "McpAccessOutcome" AS ENUM ('SUCCESS', 'DENY', 'ERROR');

-- CreateTable
CREATE TABLE "mcp_access_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "surface" "McpAccessSurface" NOT NULL,
    "operation_name" TEXT NOT NULL,
    "outcome" "McpAccessOutcome" NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "request_metadata" JSONB,
    "response_metadata" JSONB,
    "error_metadata" JSONB,

    CONSTRAINT "mcp_access_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_access_events_user_id_occurred_at_idx" ON "mcp_access_events"("user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "mcp_access_events_user_id_client_key_occurred_at_idx" ON "mcp_access_events"("user_id", "client_key", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "mcp_access_events_user_id_operation_name_occurred_at_idx" ON "mcp_access_events"("user_id", "operation_name", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "mcp_access_events_user_id_outcome_occurred_at_idx" ON "mcp_access_events"("user_id", "outcome", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "mcp_access_events_correlation_id_idx" ON "mcp_access_events"("correlation_id");

-- AddForeignKey
ALTER TABLE "mcp_access_events" ADD CONSTRAINT "mcp_access_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

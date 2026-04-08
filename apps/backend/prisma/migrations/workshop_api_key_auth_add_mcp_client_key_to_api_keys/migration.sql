CREATE TYPE "ApiKeyMcpClientKey" AS ENUM ('CLAUDE', 'CODEX', 'FALLBACK', 'UNKNOWN');

ALTER TABLE "api_keys"
ADD COLUMN "mcp_client_key" "ApiKeyMcpClientKey";

UPDATE "api_keys"
SET "mcp_client_key" = 'CLAUDE'
WHERE "mcp_client_key" IS NULL;

ALTER TABLE "api_keys"
ALTER COLUMN "mcp_client_key" SET NOT NULL;

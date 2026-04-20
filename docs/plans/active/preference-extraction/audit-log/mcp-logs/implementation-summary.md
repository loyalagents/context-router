# MCP Access Logs Implementation Summary

## What shipped

This pass added request-level MCP access history as a separate system from
`PreferenceAuditEvent`.

Shipped scope:

- append-only `McpAccessEvent` persistence for MCP access history
- central logging in `McpService` for read-only `tools/call` and all `resources/read`
- wrapper result types for MCP tools/resources so handlers can attach sanitized metadata
- dispatch correlation IDs on every `tools/call` and `resources/read`
- MCP write tools continue to write mutation audit rows, now using the dispatch correlation ID
- user-scoped GraphQL `mcpAccessHistory(input)` read API with cursor pagination
- `/dashboard/history` tabs for Audit and MCP Access
- integration and e2e coverage for persistence, query semantics, dispatch logging, metadata, and fail-open behavior

Out of scope:

- `tools/list` and `resources/list` logging
- pre-dispatch Auth0/JWT failure logging
- object-level MCP access fan-out
- admin/global MCP telemetry
- retention or archival policy

## Model and API

Added Prisma enums:

- `McpAccessSurface`
  - `TOOLS_CALL`
  - `RESOURCES_READ`
- `McpAccessOutcome`
  - `SUCCESS`
  - `DENY`
  - `ERROR`

Added model:

- `McpAccessEvent`
  - `id`
  - `userId`
  - `clientKey`
  - `occurredAt`
  - `surface`
  - `operationName`
  - `outcome`
  - `correlationId`
  - `latencyMs`
  - `requestMetadata`
  - `responseMetadata`
  - `errorMetadata`

Added GraphQL query:

- `mcpAccessHistory(input: McpAccessHistoryInput!): McpAccessHistoryPage!`

Filters:

- `clientKey`
- `surface`
- `operationName`
- `outcome`
- `correlationId`
- `occurredFrom`
- `occurredTo`

## Logging behavior

`McpService` logs:

- known read-only tools using `descriptor.annotations.readOnlyHint === true`
- all resource reads
- unknown tool calls as `ERROR` with `errorMetadata.source = DISPATCH`
- unknown resource reads as `ERROR` with `errorMetadata.source = DISPATCH`
- dispatch authorization denials as `DENY` with `errorMetadata.source = AUTHORIZATION`
- tool results with `isError: true` as `ERROR` with `errorMetadata.source = TOOL_RESULT`
- thrown handler exceptions as `ERROR` with `errorMetadata.source = HANDLER_EXCEPTION`

Known MCP write tools are not logged as `McpAccessEvent` rows in v1:

- `suggestPreference`
- `deletePreference`
- `createPreferenceDefinition`

## Metadata

Sanitized metadata shipped for:

- `searchPreferences`
- `listPreferenceSlugs`
- `smartSearchPreferences`
- `consolidateSchema`
- `listPermissionGrants`
- `schema://graphql`

Metadata intentionally avoids:

- raw natural-language query text
- raw preference values
- full returned payloads
- full slug lists
- AI interpretation text

## Tests and verification

Added:

- `apps/backend/test/integration/mcp-access-log.service.spec.ts`
- `apps/backend/test/integration/mcp-access-log-query.service.spec.ts`
- `apps/backend/test/e2e/mcp-access-log.e2e-spec.ts`

Updated:

- MCP tool/resource interfaces and wrapper-return unit tests
- existing MCP mutation tools to reuse dispatch correlation IDs
- web history page and generated GraphQL types

Verification run:

- `pnpm --filter backend prisma:generate`
- `pnpm --filter backend test:db:migrate`
- `pnpm --filter backend exec jest test/integration/mcp-access-log.service.spec.ts test/integration/mcp-access-log-query.service.spec.ts --runInBand`
- `pnpm --filter backend exec jest src/mcp/tools/preference-list.tool.spec.ts src/mcp/tools/smart-search.tool.spec.ts src/mcp/tools/schema-consolidation.tool.spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/mcp-access-log.e2e-spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/mcp.e2e-spec.ts test/e2e/workflows.e2e-spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/audit-history.e2e-spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/permission-grants.e2e-spec.ts --runInBand`
- `pnpm --filter backend test:integration`
- `pnpm --filter backend build`
- `pnpm --filter web codegen`
- `pnpm --filter web lint`
- `pnpm --filter web build`

## Known limitations

- MCP access history is request-level only.
- Discovery calls are not logged.
- Failed auth before MCP dispatch is not represented in user-facing history.
- The MCP Access UI shows formatted JSON metadata, not a tree view.
- No MCP-protocol tool/resource exposes access history yet; the read surface is GraphQL and web only.

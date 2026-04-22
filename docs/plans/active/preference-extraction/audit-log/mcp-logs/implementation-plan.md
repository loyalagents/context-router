# MCP Access Logs Plan

## Summary
Add request-level MCP access history as a separate system from `PreferenceAuditEvent`. Use a new append-only `McpAccessEvent` table, central logging in `McpService`, wrapper-based sanitized metadata from tools/resources, a user-scoped GraphQL read API, and a separate MCP Access tab on `/dashboard/history`.

V1 logs known read-only `tools/call` requests and all `resources/read` requests. It does not log `tools/list`, `resources/list`, or pre-dispatch JWT/Auth0 failures from `McpAuthGuard`. Known MCP write tools remain covered by `PreferenceAuditEvent` and do not create `McpAccessEvent` rows in v1.

## Key Changes
- Add Prisma enums `McpAccessSurface = TOOLS_CALL | RESOURCES_READ` and `McpAccessOutcome = SUCCESS | DENY | ERROR`.
- Add `McpAccessEvent` with `id`, `userId`, `clientKey`, `occurredAt`, `surface`, `operationName`, `outcome`, `correlationId`, `latencyMs`, `requestMetadata`, `responseMetadata`, and `errorMetadata`.
- Add indexes `(userId, occurredAt desc)`, `(userId, clientKey, occurredAt desc)`, `(userId, operationName, occurredAt desc)`, `(userId, outcome, occurredAt desc)`, and `(correlationId)`.
- Put MCP access-log persistence, query service, GraphQL resolver, DTOs, and models under `src/mcp/access-log/`; keep mutation audit code under `modules/preferences/audit`.
- Add wrapper types:
  ```ts
  interface McpAccessLogMetadata {
    requestMetadata?: unknown;
    responseMetadata?: unknown;
    errorMetadata?: unknown;
  }

  interface McpToolExecutionResult {
    result: CallToolResult;
    accessLog?: McpAccessLogMetadata;
  }

  interface McpResourceExecutionResult {
    result: ReadResourceResult;
    accessLog?: McpAccessLogMetadata;
  }
  ```
- Update all 8 MCP tools and `SchemaResource` to return wrapper results. Write tools return `{ result }` without access metadata.
- Add `correlationId?: string` to `McpContext`; generate one for every `tools/call` and `resources/read` dispatch before handler execution.
- Update MCP mutation tools to use `context.correlationId ?? randomUUID()` for existing `PreferenceAuditEvent` mutation audit rows.

## Logging Behavior
- Log known tool calls only when `tool.descriptor.annotations?.readOnlyHint === true`.
- Do not log known write tools in v1: `suggestPreference`, `deletePreference`, and `createPreferenceDefinition`. There is no separate `applyPreference` MCP tool today.
- Log unknown tool calls as `ERROR` with `operationName` from the request and `errorMetadata.source = DISPATCH`.
- Log all `resources/read` requests. For resource errors, use `catch -> log -> rethrow` so the MCP SDK still returns its normal JSON-RPC error.
- Log unknown resource URI as `ERROR` with `errorMetadata.source = DISPATCH`.
- Log `McpAuthorizationError` as `DENY` with `errorMetadata.source = AUTHORIZATION`.
- Log thrown non-authorization handler errors as `ERROR` with `errorMetadata.source = HANDLER_EXCEPTION`.
- Log tool wrapper results where `result.isError === true` as `ERROR` with `errorMetadata.source = TOOL_RESULT`.
- Measure latency with `performance.now()` around authorization plus handler execution and persist non-negative integer `latencyMs`.
- Logging is fail-open at the `McpService` call site: catch and log `McpAccessLogService.record()` failures, but return or rethrow the original MCP result/error.

## Metadata
- `searchPreferences`: request metadata stores `locationId`, `includeSuggestions`, `queryPresent`, and `queryLength`; response metadata stores `activeCount` and `suggestedCount`.
- `listPreferenceSlugs`: request metadata stores `category`; response metadata stores `count` and `categories`.
- `smartSearchPreferences`: request metadata stores `locationId`, `includeSuggestions`, `queryPresent`, and `queryLength`; response metadata stores matched definition, active, and suggested counts.
- `consolidateSchema`: request metadata stores `scope`; response metadata stores `totalDefinitionsAnalyzed` and `consolidationGroupCount`.
- `listPermissionGrants`: response metadata stores grant count. Standardize this tool with the same try/catch pattern used by other MCP tools.
- `schema://graphql`: request metadata stores `uri`; response metadata stores byte length and cache hit/miss computed during the same read call.
- Do not store raw query text, natural-language AI interpretation, raw preference values, full returned payloads, or full slug lists in v1.

## Implementation Checkpoints
- Checkpoint 1: Add schema, migration, generated Prisma client updates, `McpAccessLogService`, and `McpAccessLogQueryService`. Integration tests cover insert shape, JSON metadata, enum values, query filters, pagination, empty results, invalid cursors, and user isolation.
- Checkpoint 2: Add wrapper types and migrate all tools/resources to wrapper returns. Instrument `McpService` for `tools/call` and `resources/read`, including resource `catch -> log -> rethrow`. E2E tests cover dispatch-to-log creation, outcome mapping, latency, write-tool exclusion, and fail-open behavior.
- Checkpoint 3: Add sanitized metadata for the listed tools/resources. E2E tests assert representative metadata for `searchPreferences`, `listPreferenceSlugs`, `smartSearchPreferences`, `consolidateSchema`, `listPermissionGrants`, and `schema://graphql`.
- Checkpoint 4: Add `mcpAccessHistory(input: McpAccessHistoryInput!): McpAccessHistoryPage!` with filters for `clientKey`, `surface`, `operationName`, `outcome`, `correlationId`, `occurredFrom`, and `occurredTo`. Reuse the existing audit-history cursor pattern.
- Checkpoint 5: Update `/dashboard/history` with `Audit` and `MCP Access` tabs. Keep current audit behavior unchanged and add a sibling access-log tab with filters, active chips, expandable metadata JSON, latency formatted as `${latencyMs}ms`, and cursor `Load more`.
- Checkpoint 6: Docs cleanup and implementation summary. Add a note to `mcp-logs-rough-plan.md` that `McpReadEvent` was superseded by `McpAccessEvent`, update `audit-log/TODO.md`, and write `mcp-logs/implementation-summary.md` describing what was implemented, tests run, and known limitations.

## Test Plan
- Add new integration test files for MCP access-log persistence and query behavior rather than appending to existing audit tests.
- Add a new `mcp-access-log.e2e-spec.ts` for dispatch logging behavior rather than expanding `mcp.e2e-spec.ts`.
- Integration tests verify `McpAccessLogService.record()` persists base fields and metadata, and `McpAccessLogQueryService` enforces user isolation, ordering, pagination, filters, empty pages, and invalid cursor errors.
- E2E tests verify `searchPreferences`, `listPreferenceSlugs`, `smartSearchPreferences`, `consolidateSchema`, `listPermissionGrants`, and `schema://graphql` create `SUCCESS` rows with sanitized metadata.
- E2E tests verify unknown client denial for a read tool creates `DENY`, unknown tool/resource create `ERROR`, and a read tool returning `isError: true` creates `ERROR` with `source = TOOL_RESULT`.
- E2E tests verify known write tools create no `McpAccessEvent` rows in v1, while MCP write-tool `PreferenceAuditEvent` rows still get a correlation id.
- E2E fail-open test should spy on the injected `McpAccessLogService.record()` and force it to reject, then assert the MCP response still succeeds or the original resource error is still rethrown.
- Frontend verification includes web codegen, existing audit history behavior, MCP Access tab switching, filters, load more, empty state, error state, expanded metadata panels, and latency formatting.

## Assumptions And Defaults
- Wrapper returns are preferred over optional metadata methods so metadata is produced alongside typed handler results instead of recovered by parsing MCP response text.
- `McpAccessEvent`, not `McpReadEvent`, is the durable name.
- V1 is request-level only; no object-level fan-out rows.
- Dispatch-level denials are logged; pre-dispatch Auth0/JWT failures from `McpAuthGuard` are not logged in v1.
- MCP access logs are user-facing history, not an admin/global telemetry surface.
- `tools/list` and `resources/list` remain out of scope for v1.
- If `consolidateSchema` becomes write-capable later, its `readOnlyHint` should flip to false and it will stop creating access-log rows under the v1 rule.
- No retention, archival, or admin query surface is added in v1.

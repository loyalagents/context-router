# Full-Auto MCP Mutation Implementation Summary

- Status: implemented
- Last reviewed: 2026-04-22
- Source of truth: `apps/backend/src/mcp/**`, `apps/backend/src/modules/preferences/**`, `apps/backend/prisma/schema.prisma`, `apps/backend/test/e2e/mcp.e2e-spec.ts`, `apps/backend/test/e2e/permission-grants.e2e-spec.ts`, `apps/backend/test/e2e/mcp-access-log.e2e-spec.ts`

## Summary

This implementation replaces the previous MCP mutation surface with one operation-based tool: `mutatePreferences`.

The final mutation surface is demo-focused and intentionally does not preserve old MCP tool names or old grant semantics. Existing `permission_grants` rows are cleared by the cutover migration so stale demo data cannot silently change meaning.

## Permission Changes

Prisma and GraphQL `GrantAction` now support:

- `READ`
- `SUGGEST`
- `WRITE`
- `DEFINE`

MCP capabilities now map 1:1 to:

- `preferences:read`
- `preferences:suggest`
- `preferences:write`
- `preferences:define`

Value permissions use a hierarchy:

- `READ`
- `SUGGEST`, which includes `READ`
- `WRITE`, which includes `SUGGEST` and `READ`

`DEFINE` is separate. A client with `DEFINE` can mutate definitions but cannot suggest or write preference values unless it also has the relevant value permission.

Slug grants are still target-based. A `WRITE` operation checks `READ`, `SUGGEST`, and `WRITE` grants for the slug; a `SUGGEST` operation checks `READ` and `SUGGEST`; a `DEFINE` operation checks only `DEFINE`.

## MCP Dispatcher Changes

`McpToolInterface.requiredAccess` now accepts a single access requirement or an array. The dispatcher uses any-of authorization for tool visibility and coarse `tools/call` dispatch.

The dispatcher validates every declared access entry at module startup. This prevents array declarations from bypassing the existing `toCapability()` validation path.

`mutatePreferences` is visible and callable when a client has at least one of `SUGGEST`, `WRITE`, or `DEFINE`. Exact operation and slug authorization happens inside the tool handler.

## `mutatePreferences`

`mutatePreferences` supports:

- `SUGGEST_PREFERENCE`, requiring `SUGGEST`
- `SET_PREFERENCE`, requiring `WRITE`
- `CREATE_DEFINITION`, requiring `DEFINE`
- `UPDATE_DEFINITION`, requiring `DEFINE`
- `ARCHIVE_DEFINITION`, requiring `DEFINE`
- `DELETE_PREFERENCE`, requiring `WRITE`

The tool keeps MCP-compatible `preference.value` as a JSON string. `preference.evidence` is a structured object; runtime validation rejects JSON-encoded strings, arrays, and `null`.

Successful responses include `success`, `changed`, `operation`, `requiredPermission`, `target`, optional `preference`, optional `definition`, and `audit`.

Failures return `success: false`, `changed: false`, `code`, `requiredPermission`, `target`, and `error`.

Suppressed suggestions are explicit no-ops:

- `success: true`
- `changed: false`
- `code: "SUGGESTION_SUPPRESSED"`
- `preference: null`

## Tool Registry Cleanup

The MCP registry now exposes `mutatePreferences` instead of the old mutation tools.

Removed from the MCP registry and deleted from backend MCP tool code:

- `suggestPreference`
- `createPreferenceDefinition`
- `deletePreference`

GraphQL mutations with those names still exist for the dashboard and existing GraphQL workflows.

## Access Logging

`McpToolInterface` now supports `accessLogPolicy?: 'default' | 'always'`.

Default behavior remains read-only logging via `readOnlyHint === true`. `mutatePreferences` sets `accessLogPolicy: 'always'`, so every attempt creates an `McpAccessEvent` row for:

- success
- target-level permission denial
- validation error
- handler error
- coarse dispatch denial when the client lacks every mutation capability

Mutation access-log metadata is sanitized. It stores operation, target slug when available, required permission, success flag, error code, and safe object ids/counts. It does not store raw preference values, raw evidence, or full returned objects.

## Audit Behavior

Actual domain writes still flow through existing preference and definition services, so domain audit rows are recorded for:

- active preference writes
- suggestions
- preference deletes
- definition creates
- definition updates
- definition archives

MCP-originated writes carry MCP actor provenance and the request correlation id into preference audit history.

Validation errors, denied attempts, and suppressed suggestions create MCP access-log rows but do not create domain audit rows.

## Frontend Updates

The dashboard permissions page now supports all four grant actions in its types and action dropdown:

- `READ`
- `SUGGEST`
- `WRITE`
- `DEFINE`

Web GraphQL generated types were regenerated from the updated backend schema.

## Known Limitations

- A suggest-only or define-only client can see the full `mutatePreferences` input schema because tool visibility is any-of across mutation capabilities. Unauthorized operations return structured permission errors.
- There is no combined define-and-set operation yet.
- Definition shape-changing updates are allowed for the demo.
- MCP active writes always use `sourceType: INFERRED` in this version.
- Auth0 API scope definitions and the `Context Router M2M` client grant were verified out of band. The API advertises and issues `preferences:read`, `preferences:suggest`, `preferences:write`, and `preferences:define` in both the token response `scope` and JWT `permissions` claims for the M2M smoke test.
- Auth0 access mode should match the OAuth flow:
  - `Context Router M2M` uses `client_credentials`, so it should use Client Access with the needed scopes. User Access is not needed for that app.
  - `Context Router MCP Connector - claude` and `Context Router MCP Connector - codex` use user OAuth login, so they should use User Access with `preferences:read`, `preferences:suggest`, `preferences:write`, and `preferences:define`. Client Access can stay unauthorized.
  - `Context Router MCP Connector - fallback` also uses user OAuth login, so it should use User Access with `preferences:read` only. Client Access can stay unauthorized.
- Actual MCP connector app token claims still need final demo verification after refreshing/logging in real clients.

## Verification

Run so far:

- `pnpm --filter backend prisma:generate`
- `pnpm --filter backend test:db:migrate`
- `pnpm --filter backend exec tsc --noEmit`
- `pnpm --filter backend exec jest src/modules/permission-grant/permission-grant.service.spec.ts src/mcp/auth/mcp-authorization.service.spec.ts --runInBand`
- `pnpm --filter backend exec jest test/e2e/mcp.e2e-spec.ts test/e2e/permission-grants.e2e-spec.ts test/e2e/audit-history.e2e-spec.ts test/e2e/mcp-access-log.e2e-spec.ts --runInBand`
- `pnpm --filter backend test:integration`
- `pnpm --filter backend build`
- `pnpm --filter web codegen`
- `pnpm --filter web lint`
- `pnpm --filter web build`

Out-of-band Auth0 verification:

- MCP OAuth metadata endpoints returned all four preference scopes plus `offline_access`.
- The Auth0 `Context Router API` resource defines all four preference scopes.
- A client-credentials token for `Context Router M2M` was successfully issued with all four preference scopes in the token response and decoded JWT claims.
- `Context Router M2M` was verified through Auth0 Client Access, which is the correct access mode for the `client_credentials` smoke test.

# MCP Authorization

- Status: current
- Read when: changing MCP auth, client policy, permission grants, or MCP tool access
- Source of truth: `apps/backend/src/mcp/**`,
  `apps/backend/src/modules/permission-grant/**`,
  `apps/backend/test/e2e/mcp.e2e-spec.ts`,
  `apps/backend/test/e2e/permission-grants.e2e-spec.ts`, and
  `apps/backend/test/e2e/mcp-access-log.e2e-spec.ts`
- Last reviewed: 2026-09-22

## Components

This document describes the hosted MCP transport. Both the SQLite `local-database-preview` and explicit PostgreSQL
`local-identity-preview` exclude `McpModule`, OAuth/DCR, and every HTTP/MCP
listener. Each private human bearer is a separate credential and never
authenticates an MCP client; Step 07 owns local MCP identity and transport.

- `McpController` handles HTTP JSON-RPC requests.
- `McpAuthGuard` validates Auth0 JWTs and emits OAuth challenges and metadata.
- `McpClientRegistryService` resolves the calling client bucket from OAuth client IDs or redirect URIs.
- `McpAuthorizationService` applies coarse capabilities, static target rules, and DB-backed permission grants.
- `PermissionGrantModule` stores and evaluates per-client, per-target grant rules.

## Authorization Layers

Authorization is intentionally layered:

1. Client bucket capability policy
2. Static target rules from MCP client config
3. Database-backed `PermissionGrant` rules

The DB layer can only narrow access. It never widens a denial from an earlier layer.

## Permission Grants

`PermissionGrant` rules are scoped by:

- `userId`
- `clientKey`
- `target`
- `action`
- `effect`

Current actions:

- `READ`: read preference values and schema.
- `SUGGEST`: create reviewable preference suggestions. Includes `READ`.
- `WRITE`: create, update, or delete concrete preference values. Includes `SUGGEST` and `READ`.
- `DEFINE`: create, update, or archive preference definitions. This is separate from the value-permission ladder.

Current target grammar:

- `*`
- `food.*`
- `food.french.*`
- exact slugs such as `food.dietary_restrictions`

Evaluation rules:

- Most specific match wins.
- If multiple matches exist at the same specificity, deny wins.
- No matching grant means allow at the DB-grant layer.
- For value actions, grant checks follow the hierarchy. A `WRITE` operation is denied if any matching `READ`, `SUGGEST`, or `WRITE` grant denies the slug. A `SUGGEST` operation is denied if any matching `READ` or `SUGGEST` grant denies the slug.
- `DEFINE` grants are evaluated independently of value grants.
- Grants are slug-based, not namespace-aware.

## Current MCP Surface

Important tools and resources:

- `listPreferenceSlugs`
- `searchPreferences`
- `mutatePreferences`
- `smartSearchPreferences`
- `consolidateSchema`
- `listPermissionGrants`
- `schema://graphql`

## Read Tool Result Contract

These five read-only tools advertise an object `outputSchema`:

- `listPreferenceSlugs`
- `searchPreferences`
- `smartSearchPreferences`
- `listPermissionGrants`
- `consolidateSchema`

On success, each returns a canonical object with `success: true` in two places:

- `structuredContent` is the preferred structured result for clients that support it.
- `content[0].text` is serialized JSON of the same payload for MCP clients that only surface text content blocks.

Handler failures set `isError: true` and return the same
`{ success: false, error }` object through both result locations. Clients that
support structured results should prefer `structuredContent`; parsing the JSON
text remains a compatibility path.

Access logs remain sanitized. They store request metadata and response counts,
not returned preference values or full response bodies.

`listPermissionGrants` is scoped to the calling client bucket. Grant mutation
stays in GraphQL and the web dashboard.

## Mutation Tool Result Contract

`mutatePreferences` is the single MCP mutation tool. It supports:

- `SUGGEST_PREFERENCE` requiring `SUGGEST`
- `SET_PREFERENCE` requiring `WRITE`
- `DELETE_PREFERENCE` requiring `WRITE`
- `CREATE_DEFINITION` requiring `DEFINE`
- `UPDATE_DEFINITION` requiring `DEFINE`
- `ARCHIVE_DEFINITION` requiring `DEFINE`

The mutation tool intentionally has a different result contract from the five
read tools. It currently advertises no `outputSchema` and returns no
`structuredContent`; its result envelope is JSON serialized only in
`content[0].text`.

Preference `value` input is itself a JSON-encoded string, such as
`"\"concise\""`, `"[\"nuts\"]"`, or `"true"`. Optional `evidence` is the
opposite: callers pass a structured, non-null, non-array object and must not
JSON-encode it.

A successful changed result includes `success: true`, `changed: true`, the
operation, required permission, target, relevant preference or definition, and
audit provenance containing MCP origin, client key, and correlation id. A
failure includes `success: false`, `changed: false`, a stable code and error,
required permission, and target; the MCP result sets `isError: true`.

Suggestion suppression is an explicit successful no-op:

```json
{
  "success": true,
  "changed": false,
  "code": "SUGGESTION_SUPPRESSED",
  "preference": null
}
```

It creates an MCP access event but no domain mutation audit event. Validation
and authorization failures likewise create no domain audit event. Current MCP
active writes use `sourceType: INFERRED`.

## MCP Access Logging

Read-only tools and resource reads are logged as before. `mutatePreferences`
opts into always-on access logging, so every mutation-tool attempt that reaches
MCP dispatch creates an `McpAccessEvent` row for success, permission denial,
validation error, and handler error. Authentication failures rejected before
dispatch are outside this log.

Mutation access-log metadata is sanitized. It stores operation, target slug when available, required permission, outcome, error code, and safe object ids/counts; it does not store raw preference values, raw evidence, or full returned objects.

## Related Product Surface

- GraphQL exposes `myPermissionGrants`, `setPermissionGrant`, and `removePermissionGrant`.
- The web dashboard exposes a permissions page at `/dashboard/permissions`.

## Known Constraints

- Old MCP mutation tools are no longer exposed in `tools/list`: `suggestPreference`, `deletePreference`, and `createPreferenceDefinition`.
- A suggest-only client can see the full `mutatePreferences` input schema because visibility is based on any mutation capability; unauthorized operations return structured permission errors.
- Static target rules with namespace matching are rejected at startup.
- Grants are slug-based today, so a slug grant applies to both global and user-owned definitions with the same slug.
- Setup details belong in `docs/useful/MCP_LOCAL_SETUP.md`, not here.

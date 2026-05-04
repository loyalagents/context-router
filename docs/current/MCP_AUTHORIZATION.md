# MCP Authorization

- Status: current
- Read when: changing MCP auth, client policy, permission grants, or MCP tool access
- Source of truth: `apps/backend/src/mcp/**`, `apps/backend/src/modules/permission-grant/**`, `apps/backend/test/e2e/mcp.e2e-spec.ts`, `apps/backend/test/e2e/permission-grants.e2e-spec.ts`
- Last reviewed: 2026-04-22

## Components

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

Read-only MCP tools return the same machine-readable payload in two places:

- `structuredContent` is the preferred structured result for clients that support it.
- `content[0].text` is serialized JSON of the same payload for MCP clients that only surface text content blocks.

Access logs remain sanitized. They store request metadata and response counts, not returned preference values or full response bodies.

`mutatePreferences` is the single MCP mutation tool. It supports:

- `SUGGEST_PREFERENCE` requiring `SUGGEST`
- `SET_PREFERENCE` requiring `WRITE`
- `DELETE_PREFERENCE` requiring `WRITE`
- `CREATE_DEFINITION` requiring `DEFINE`
- `UPDATE_DEFINITION` requiring `DEFINE`
- `ARCHIVE_DEFINITION` requiring `DEFINE`

`listPermissionGrants` is read-only and scoped to the calling client bucket. Grant mutation stays in GraphQL and the web dashboard.

## MCP Access Logging

Read-only tools and resource reads are logged as before. `mutatePreferences` opts into always-on access logging, so every mutation-tool attempt creates an `McpAccessEvent` row for success, permission denial, validation error, and handler error.

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

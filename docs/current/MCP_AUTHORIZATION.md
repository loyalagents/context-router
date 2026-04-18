# MCP Authorization

- Status: current
- Read when: changing MCP auth, client policy, permission grants, or MCP tool access
- Source of truth: `apps/backend/src/mcp/**`, `apps/backend/src/modules/permission-grant/**`, `apps/backend/test/e2e/mcp.e2e-spec.ts`, `apps/backend/test/e2e/permission-grants.e2e-spec.ts`
- Last reviewed: 2026-04-18

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

Current target grammar:

- `*`
- `food.*`
- `food.french.*`
- exact slugs such as `food.dietary_restrictions`

Evaluation rules:

- Most specific match wins.
- If multiple matches exist at the same specificity, deny wins.
- No matching grant means allow at the DB-grant layer.
- Grants are slug-based, not namespace-aware.

## Current MCP Surface

Important tools and resources:

- `listPreferenceSlugs`
- `searchPreferences`
- `suggestPreference`
- `deletePreference`
- `createPreferenceDefinition`
- `smartSearchPreferences`
- `consolidateSchema`
- `listPermissionGrants`
- `schema://graphql`

`listPermissionGrants` is read-only and scoped to the calling client bucket. Grant mutation stays in GraphQL and the web dashboard.

## Related Product Surface

- GraphQL exposes `myPermissionGrants`, `setPermissionGrant`, and `removePermissionGrant`.
- The web dashboard exposes a permissions page at `/dashboard/permissions`.

## Known Constraints

- MCP grant mutation tools are intentionally not exposed.
- Static target rules with namespace matching are rejected at startup.
- Grants are slug-based today, so a slug grant applies to both global and user-owned definitions with the same slug.
- Setup details belong in `docs/useful/MCP_LOCAL_SETUP.md`, not here.

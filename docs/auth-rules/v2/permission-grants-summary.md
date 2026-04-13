# Permission Grants Summary

## What shipped

This branch adds per-client, per-slug authorization on top of the existing MCP client bucket policy.

The new persistence layer is a `PermissionGrant` Prisma model stored in `permission_grants` with:

- `userId`
- `clientKey`
- `target`
- `action`
- `effect`

`action` and `effect` are backed by Prisma enums:

- `GrantAction = READ | WRITE`
- `GrantEffect = ALLOW | DENY`

The unique key is:

- `(userId, clientKey, target, action)`

That allows one effective rule per user/client/target/action pair.

## Core algorithm

Authorization is based on prefix-chain decomposition plus most-specific-wins evaluation.

Examples:

- `food.dietary_restrictions` -> `['food.dietary_restrictions', 'food.*', '*']`
- `food.french.wine` -> `['food.french.wine', 'food.french.*', 'food.*', '*']`

Evaluation order is:

1. Existing coarse MCP capability policy
2. Existing static `targetRules`
3. DB-backed `PermissionGrant` rules

DB grants can only narrow access. They never widen past the existing static policy.

No matching DB grant means:

- `no-grant`
- allow-by-default at the DB grant layer

So allowlist behavior is expressed as:

- `deny * read`
- plus explicit allow exceptions such as `allow food.* read`

## New backend pieces

### PermissionGrant module

`PermissionGrantModule` now provides:

- `PermissionGrantRepository`
- `PermissionGrantService`
- `PermissionGrantResolver`

Repository API includes:

- `upsert`
- `remove`
- `findByUserAndClient`
- `findByUserClientAction`
- `findByUser`
- `findMatchingGrants`

Service API includes:

- `buildPrefixChain`
- `evaluateAccess`
- `filterSlugsByAccess`
- `assertValidTarget`

### Authorization changes

`McpAuthorizationService` now has async target-aware helpers:

- `canAccessTarget(...)`
- `assertAccessTarget(...)`
- `filterByTargetAccess(...)`

These call the existing `canAccess(..., target)` path first so static `targetRules` still apply, then consult `PermissionGrantService`.

### Startup validation

`McpClientRegistry` now rejects static `targetRules` with `matcher.namespace`.

That is intentional for v1 because bulk filtering is currently slug-only.

## MCP changes

### Single-target writes

These tools now perform target-aware authorization before executing:

- `suggestPreference`
- `createPreferenceDefinition`
- `deletePreference`

### Read filtering

These MCP read paths now filter by slug grants:

- `searchPreferences`
- `listPreferenceSlugs`
- `smartSearchPreferences`
- `consolidateSchema`

### AI prompt filtering

Blocked slugs are filtered before prompt construction in:

- `PreferenceSearchWorkflow`
- `SchemaConsolidationWorkflow`

This is done via `PreferenceSchemaSnapshotService.getGrantFilteredSnapshot(...)`.

### Read-only introspection tool

A new MCP tool is available:

- `listPermissionGrants`

It is read-only and scoped to the calling client key, so Claude sees only Claude grants, Codex sees only Codex grants, etc.

MCP write tools for grant mutation were intentionally not added. A write-capable client could otherwise remove its own restrictions.

## GraphQL API

The web UI now manages grants through GraphQL:

- `myPermissionGrants`
- `setPermissionGrant`
- `removePermissionGrant`

This is backed by:

- `PermissionGrantModel`
- `SetPermissionGrantInput`
- `PermissionGrantResolver`

Target validation accepts:

- `*`
- prefix wildcards like `food.*` or `food.french.*`
- exact slugs like `food.dietary_restrictions`

## Web testing UI

A minimal dashboard page now exists at:

- `/dashboard/permissions`

It supports:

- listing current grants
- creating/updating grants
- deleting grants

This is a testing UI, not a polished permissions UX.

## Namespace behavior

Grants are slug-based and namespace-agnostic in this version.

That means a grant on `food.dietary_restrictions` applies to:

- the GLOBAL definition
- any `USER:<userId>` definition with the same slug

If namespace-aware grants are needed later, `McpTarget.namespace` is the natural extension point.

## Test coverage

Added tests:

- `test/integration/permission-grant.repository.spec.ts`
- `src/modules/permission-grant/permission-grant.service.spec.ts`
- `test/e2e/permission-grants.e2e-spec.ts`

Coverage includes:

- repository CRUD and specificity ordering
- prefix-chain evaluation rules
- target-aware MCP write denial
- bulk read filtering
- AI prompt filtering
- scoped MCP grant introspection
- GraphQL grant CRUD

## Verification run

Verified during implementation:

- `pnpm prisma:generate`
- `pnpm test:db:migrate`
- targeted repository/service/auth/workflow tests
- `pnpm test --testPathPattern=permission-grants`
- `pnpm test` in `apps/backend`
- `pnpm --filter web build`

The full backend suite passed. Jest still reports an existing open-handle warning after completion, but the test run itself is green.

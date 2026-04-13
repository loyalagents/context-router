# Migrate v2 Permission Grants to the API-Key Branch

## Purpose

This note is for moving commit `d26cc1c5fa941b8326d725945012e7644b91bef7` onto `gates-workshop-2026` or a branch cut from it.

That commit implements the `docs/auth-rules/v2` permission-grants system:

- DB-backed per-client per-slug grants
- target-aware MCP authorization
- read filtering for MCP tools and AI-backed workflows
- a read-only MCP `listPermissionGrants` tool
- GraphQL grant CRUD
- a minimal dashboard testing UI

The important constraint is that `gates-workshop-2026` does **not** use the Auth0/OAuth request path from `main`. It uses API keys plus a resolved `mcpClientKey`. The migration should preserve that branch's auth model and port the permission-grant logic into it.

## Main Rule

Do **not** replace the API-key branch with the `main` versions of MCP auth files.

Port the permission-grant logic into the `gates-workshop-2026` variants of the code instead.

That matters because the API-key branch already has branch-specific behavior that `main` does not:

- `ApiKeyGuard` on MCP and GraphQL paths
- `ApiKeyService.validateApiKeyUserContext(...)` returning `mcpClientKey`
- `McpController` building `context.client` from `apiKeyAuth.mcpClientKey`
- `McpContext.user.schemaNamespace`
- branch-only MCP write surface `applyPreference`
- a different coarse capability matrix in `mcp.config.ts` (`codex` is read-only on the workshop branch)

If you accept the `main` versions of those files wholesale, you will reintroduce OAuth assumptions and likely break workshop-only behavior.

## What Transfers Cleanly

These pieces are mostly auth-agnostic and should transfer with minimal changes:

- `apps/backend/src/modules/permission-grant/permission-grant.repository.ts`
- `apps/backend/src/modules/permission-grant/permission-grant.service.ts`
- `apps/backend/src/modules/permission-grant/permission-grant.service.spec.ts`
- `apps/backend/src/modules/permission-grant/dto/set-permission-grant.input.ts`
- `apps/backend/src/modules/permission-grant/models/permission-grant.model.ts`
- `apps/backend/src/modules/permission-grant/permission-grant.module.ts`
- `apps/backend/src/mcp/tools/permission-grant-list.tool.ts`
- `apps/backend/test/integration/permission-grant.repository.spec.ts`
- most of `apps/backend/src/mcp/auth/mcp-authorization.service.ts`

These all work in terms of `userId`, `clientKey`, and slug matching. They do not fundamentally care whether the caller reached MCP through OAuth or API keys.

## Files To Treat As Manual Merges

These should be merged intentionally, not accepted from the cherry-pick:

- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/app.module.ts`
- `apps/backend/src/config/mcp.config.ts`
- `apps/backend/src/mcp/mcp.controller.ts`
- `apps/backend/src/mcp/mcp.module.ts`
- `apps/backend/src/mcp/types/mcp-context.type.ts`
- `apps/backend/test/setup/test-app.ts`
- `apps/backend/test/e2e/mcp.e2e-spec.ts`
- `apps/backend/test/e2e/permission-grants.e2e-spec.ts`
- `apps/web/app/dashboard/permissions/page.tsx`
- `apps/web/app/dashboard/permissions/PermissionsClient.tsx`

Generated artifacts should also be regenerated on the API-key branch instead of hand-merged:

- `apps/backend/src/infrastructure/prisma/generated-client.ts`
- `apps/backend/src/schema.gql`

## Files In The Commit That Are Not Core To v2

The commit also includes preference-dashboard files that are not part of the `docs/auth-rules/v2` plan:

- `apps/web/app/dashboard/preferences/PreferencesClient.tsx`
- `apps/web/app/dashboard/preferences/components/ManualPreferenceForm.tsx`
- `apps/web/app/dashboard/preferences/page.tsx`

Treat those as separate UI work. They are not required to get permission grants working on `gates-workshop-2026`.

## Checkpoint 1: Prisma Merge

Goal: add permission grants without losing the workshop branch's API-key schema.

On `gates-workshop-2026`, merge in:

- `GrantAction`
- `GrantEffect`
- `PermissionGrant`
- `User.permissionGrants`

But keep the workshop branch's existing schema pieces:

- `ApiKey`
- `ApiKeyUser`
- `ApiKeyMcpClientKey`
- `User.schemaNamespace`
- `User.apiKeyUsers`

Do not accept `main`'s full `schema.prisma`, because it still has `ExternalIdentity` and does not have the workshop branch's API-key models.

After the schema merge:

1. Run Prisma generate on the API-key branch.
2. Run the migration against the test DB.
3. Keep the branch-generated `generated-client.ts`, not the cherry-picked one.

Suggested checkpoint verification:

```bash
pnpm --filter backend prisma:generate
pnpm --filter backend test:db:migrate
pnpm --filter backend exec jest test/integration/permission-grant.repository.spec.ts
```

## Checkpoint 2: Shared Authorization Layer

Goal: reuse the new authorization logic while preserving API-key client resolution.

Port these changes:

- `McpAuthorizationService.canAccessTarget(...)`
- `McpAuthorizationService.assertAccessTarget(...)`
- `McpAuthorizationService.filterByTargetAccess(...)`
- the startup validation that rejects static `targetRules` with `matcher.namespace`
- `MANAGED_MCP_CLIENT_KEYS` in `mcp-authorization.types.ts`

Keep these branch-specific behaviors:

- `McpController` should still use `ApiKeyGuard`
- `McpController` should still read `req.apiKeyAuth`
- `McpController` should still resolve the MCP client with `resolveFromClientKey(apiKeyAuth.mcpClientKey)`
- `McpContext.user` should still include `schemaNamespace`
- `mcp.config.ts` should keep the workshop branch's coarse policy defaults unless you explicitly want to change them

Important: `main` currently gives `codex` read+write, but `gates-workshop-2026` keeps `codex` read-only. Permission grants only narrow access; they should not silently change that baseline.

Suggested checkpoint verification:

```bash
pnpm --filter backend exec jest src/mcp/auth/mcp-authorization.service.spec.ts
pnpm --filter backend exec jest src/mcp/auth/mcp-client-registry.service.spec.ts
```

## Checkpoint 3: Port Grant Checks Into The API-Key Branch Tool Variants

Goal: apply the new slug-level checks without regressing workshop-only behavior.

The safest pattern is:

1. Start from the `gates-workshop-2026` version of each file.
2. Copy in the permission-grant logic from `main`.
3. Preserve the branch-only `schemaNamespace` arguments and request-context behavior.

This is especially important in these files:

- `apps/backend/src/mcp/tools/preference-definition.tool.ts`
- `apps/backend/src/mcp/tools/preference-delete.tool.ts`
- `apps/backend/src/mcp/tools/preference-search.tool.ts`
- `apps/backend/src/mcp/tools/preference-list.tool.ts`
- `apps/backend/src/mcp/tools/smart-search.tool.ts`
- `apps/backend/src/mcp/tools/schema-consolidation.tool.ts`
- `apps/backend/src/modules/preferences/preference-definition/preference-schema-snapshot.service.ts`
- `apps/backend/src/modules/workflows/preferences/preference-search/preference-search.workflow.ts`
- `apps/backend/src/modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.ts`

On the workshop branch, many of those files already thread `schemaNamespace` through definition lookup and workflow calls. Keep that.

Concrete example:

- `main`'s `PreferenceSchemaSnapshotService.getGrantFilteredSnapshot(...)` is correct in principle
- the API-key branch should extend its existing snapshot API, not replace it with the `main` signature that drops `schemaNamespace`

### Branch-only MCP write path

`gates-workshop-2026` still exposes `applyPreference` through:

- `apps/backend/src/mcp/tools/preference-apply.tool.ts`
- `apps/backend/src/mcp/tools/preference-mutation.tool.ts`

That path is **not** covered by `d26cc1c...` because `main` no longer has the same tool layout.

Do not miss this. `applyPreference` must get the same target-aware write enforcement as:

- `suggestPreference`
- `createPreferenceDefinition`
- `deletePreference`

Otherwise the API-key branch will have a write bypass around the new permission-grant layer.

Suggested checkpoint verification:

```bash
pnpm --filter backend exec jest test/e2e/permission-grants.e2e-spec.ts
```

## Checkpoint 4: GraphQL And Dashboard UI

Goal: keep backend grant management usable without importing Auth0-only assumptions.

### GraphQL resolver

`apps/backend/src/modules/permission-grant/permission-grant.resolver.ts` from `main` uses `GqlAuthGuard`.

On `gates-workshop-2026`, switch that resolver to `ApiKeyGuard` so it matches the rest of the workshop branch's GraphQL auth model.

The resolver logic itself should otherwise transfer cleanly.

### Dashboard permissions page

The new permissions page on `main` is Auth0-oriented:

- `apps/web/app/dashboard/permissions/page.tsx` calls `auth0.getSession()`
- it fetches an access token with `auth0.getAccessToken()`
- `PermissionsClient.tsx` posts `Authorization: Bearer <accessToken>`

That is the wrong auth model for `gates-workshop-2026`.

If you want the UI on the API-key branch, port it to the workshop branch style:

- use client-side fetches
- use `localStorage` workshop credentials
- send `Authorization: Bearer <apiKey>`
- send `x-user-id`
- reuse the existing client-side auth-header pattern from the workshop branch

If backend stability is the priority, it is reasonable to:

1. ship backend + tests first
2. leave the permissions dashboard for a follow-up patch

## Test Strategy For The API-Key Branch

The new tests from `main` are useful, but they need API-key branch adaptations.

Key points:

- keep the new repository and service tests
- adapt MCP E2E tests so client identity comes from `mcpClientKey` on the API key, not OAuth client IDs
- preserve the workshop branch's real-auth coverage that creates API keys with `mcpClientKey`
- add/keep at least one read-write client case and one read-only client case
- add coverage for the branch-only `applyPreference` path
- keep `schemaNamespace` visible in MCP test context

Suggested checkpoint verification:

```bash
pnpm --filter backend exec jest test/integration/permission-grant.repository.spec.ts
pnpm --filter backend exec jest src/modules/permission-grant/permission-grant.service.spec.ts
pnpm --filter backend exec jest test/e2e/permission-grants.e2e-spec.ts
pnpm --filter backend exec jest test/e2e/mcp.e2e-spec.ts
```

## Acceptance Criteria

The migration is in good shape when all of these are true:

- API-key MCP auth still works
- `context.client.key` still comes from the API key's `mcpClientKey`
- `context.user.schemaNamespace` is still preserved
- the branch keeps its intended coarse client capability matrix
- permission grants narrow access on top of that baseline
- `listPermissionGrants` only returns grants for the calling client
- read tools and AI-backed workflows do not leak denied slugs
- branch-only write paths such as `applyPreference` are also grant-gated
- generated Prisma and GraphQL artifacts were regenerated on the API-key branch
- no Auth0-only MCP runtime behavior was reintroduced

## Recommended Merge Order

If doing this as a real cherry-pick integration, the safest order is:

1. Merge Prisma schema + migration and regenerate generated files.
2. Merge `PermissionGrantModule`, repository, service, resolver, and tests.
3. Merge the shared authorization changes.
4. Port tool/workflow filtering into the API-key branch variants.
5. Fix and run targeted tests.
6. Only then decide whether to port the dashboard permissions UI.

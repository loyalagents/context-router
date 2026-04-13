# Resolve `d26cc1c` onto `gates-workshop-2026` With Explicit Workshop-Branch Merge Rules

## Summary

Port the v2 permission-grant backend into the workshop branch by preserving API-key auth, `mcpClientKey` resolution, `schemaNamespace`, and the workshop branch’s coarse MCP defaults, then layering in slug-grant enforcement from `d26cc1c`. Fix app-bootstrap blockers before any Nest app compile or e2e run, regenerate Prisma and GraphQL artifacts on this branch, and explicitly defer the new permissions dashboard UI.

## Preflight Blockers

- Fix `apps/backend/src/modules/permission-grant/permission-grant.resolver.ts` immediately for this branch by replacing `GqlAuthGuard` with `ApiKeyGuard`. This is required before any app-bootstrap action, including e2e tests and `schema.gql` regeneration.
- Resolve `apps/backend/test/setup/test-app.ts` to the workshop branch shape:
  - keep `mockAuthGuards?: boolean`
  - keep `ApiKeyGuard` override
  - discard `mockAuth0`, `overrideGraphqlAuthGuards`, `GqlAuthGuard`, and `JwtAuthGuard`
- Mark `apps/backend/test/e2e/permission-grants.e2e-spec.ts` as branch-incompatible in its current form:
  - remove `AUTH0_MCP_*` env usage
  - replace old client-ID-based MCP helpers with workshop mocked MCP headers or real API-key helpers
  - replace unauthenticated GraphQL setup with the workshop `mockAuthGuards: false` path
- Take HEAD for unrelated frontend conflicts:
  - `apps/web/app/dashboard/preferences/PreferencesClient.tsx`
  - `apps/web/app/dashboard/preferences/page.tsx`

## Conflict Map

- `apps/backend/prisma/schema.prisma`: manual merge
  - keep `ApiKey`, `ApiKeyUser`, `ApiKeyMcpClientKey`, `User.schemaNamespace`, `AGENT` in `SourceType`
  - add `GrantAction`, `GrantEffect`, `PermissionGrant`, `User.permissionGrants`
- `apps/backend/src/infrastructure/prisma/generated-client.ts`: do not merge, regenerate
- `apps/backend/src/mcp/mcp.module.ts`: manual merge
  - keep workshop controller setup
  - add `PermissionGrantModule`
  - add `PermissionGrantListTool`
  - keep `PreferenceApplyTool`
- `apps/backend/src/mcp/tools/preference-list.tool.ts`: manual merge
  - keep workshop `schemaNamespace` behavior
  - add slug filtering and derive categories from filtered entries
- `apps/backend/src/mcp/tools/preference-search.tool.ts`: manual merge
  - keep workshop catalog lookup shape
  - add slug filtering
- `apps/backend/src/modules/preferences/preference-definition/preference-definition.module.ts`: manual merge
  - add `PermissionGrantModule`
  - keep `AuthModule` only if desired for local consistency; it is not functionally required
- `apps/backend/src/modules/preferences/preference-definition/preference-schema-snapshot.service.ts`: manual merge
  - keep `GetSnapshotOptions { schemaNamespace?, scope? }`
  - add grant-aware snapshot API without dropping `schemaNamespace`
- `apps/backend/src/modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.ts`: manual merge
  - use grant-filtered snapshot
  - preserve `schemaNamespace`
- `apps/backend/src/modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.spec.ts`: rewrite to match the workshop-specific snapshot signature
- `apps/backend/test/e2e/mcp.e2e-spec.ts`: keep workshop real API-key approach and extend with grant coverage
- `apps/backend/test/setup/test-app.ts`: keep workshop shape, discard Auth0 test plumbing
- `apps/web/app/dashboard/preferences/PreferencesClient.tsx`: take HEAD
- `apps/web/app/dashboard/preferences/page.tsx`: take HEAD

## Checkpoints

1. Prisma merge and generated artifact baseline  
   Merge the Prisma schema manually, keep workshop auth/schema pieces, add permission-grant enums/model/relation, then run Prisma generate. Immediately confirm the generated client exports both workshop and grant enums:
   - `ApiKeyMcpClientKey`
   - `GrantAction`
   - `GrantEffect`
   Do not accept the cherry-picked `generated-client.ts`.  
   Verify:
   - `pnpm --filter backend prisma:generate`
   - `pnpm --filter backend test:db:migrate`
   - `pnpm --filter backend exec jest test/integration/permission-grant.repository.spec.ts`

2. Shared authorization layer and config review  
   Port `canAccessTarget(...)`, `assertAccessTarget(...)`, `filterByTargetAccess(...)`, `MANAGED_MCP_CLIENT_KEYS`, and namespace-matcher startup rejection into the workshop branch auth layer. Manually review auto-resolved `mcp.config.ts` and restore workshop defaults:
   - `codex` stays read-only
   - no OAuth/Auth0 config is required for runtime behavior
   Manually review `mcp-client-registry.service.ts`; keep optional OAuth-related types/helpers only if they remain inert and do not distort workshop behavior or tests.  
   Verify:
   - `pnpm --filter backend exec jest src/mcp/auth/mcp-authorization.service.spec.ts`
   - `pnpm --filter backend exec jest src/mcp/auth/mcp-client-registry.service.spec.ts`

3. MCP tool enforcement on the workshop branch  
   Start from the workshop tool variants and add grant enforcement without dropping `schemaNamespace`. Cover:
   - `suggestPreference`
   - `createPreferenceDefinition`
   - `deletePreference`
   - `applyPreference`
   - `searchPreferences`
   - `listPreferenceSlugs`
   - `smartSearchPreferences`
   - `consolidateSchema`
   Review `preference-mutation.tool.ts` as the actual write path behind `applyPreference`.  
   Verify:
   - `pnpm --filter backend exec jest src/mcp/tools/preference-list.tool.spec.ts`
   - `pnpm --filter backend exec jest src/mcp/tools/smart-search.tool.spec.ts`
   - `pnpm --filter backend exec jest src/mcp/tools/schema-consolidation.tool.spec.ts`

4. Snapshot/workflow merge with `schemaNamespace` preserved  
   Extend snapshot/workflow APIs instead of replacing them. The merged workflow input should carry both:
   - `clientKey`
   - workshop `schemaNamespace`
   Ensure the AI prompt input is filtered before model calls while continuing to use the branch’s namespace-aware definition visibility. Manually review auto-resolved workflow and tool files to restore any lost `schemaNamespace` propagation:
   - `preference-search.workflow.ts`
   - `smart-search.tool.ts`
   - `schema-consolidation.tool.ts`
   - `app.module.ts`  
   Verify:
   - `pnpm --filter backend exec jest src/modules/workflows/preferences/preference-search/preference-search.workflow.spec.ts`
   - `pnpm --filter backend exec jest src/modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.spec.ts`
   - `pnpm --filter backend exec jest src/modules/permission-grant/permission-grant.service.spec.ts`

5. GraphQL permission-grant auth on API-key flow  
   Keep the permission-grant module/resolver/repository/service/model/input, but make GraphQL auth workshop-native:
   - `ApiKeyGuard`, not `GqlAuthGuard`
   - `@CurrentUser()` resolved from API-key request context
   - grant mutation remains GraphQL/web only
   After backend code is stable, regenerate `apps/backend/src/schema.gql` instead of conflict-merging it.  
   Verify:
   - GraphQL permission-grant CRUD through workshop auth headers
   - unauthenticated GraphQL access rejected via `ApiKeyGuard`

6. Final backend verification and branch-specific e2e adaptation  
   Keep the workshop `mcp.e2e` real API-key helpers and extend them with permission-grant coverage rather than taking the OAuth-style cherry-picked version. Rework `permission-grants.e2e-spec.ts` to use the same workshop auth model for both mocked MCP and real API-key cases.  
   Verify:
   - `pnpm --filter backend prisma:generate`
   - `pnpm --filter backend test:db:migrate`
   - `pnpm --filter backend exec jest test/integration/permission-grant.repository.spec.ts`
   - `pnpm --filter backend exec jest src/modules/permission-grant/permission-grant.service.spec.ts`
   - `pnpm --filter backend exec jest src/mcp/auth/mcp-authorization.service.spec.ts`
   - `pnpm --filter backend exec jest src/mcp/auth/mcp-client-registry.service.spec.ts`
   - `pnpm --filter backend exec jest src/mcp/tools/preference-list.tool.spec.ts`
   - `pnpm --filter backend exec jest src/mcp/tools/smart-search.tool.spec.ts`
   - `pnpm --filter backend exec jest src/mcp/tools/schema-consolidation.tool.spec.ts`
   - `pnpm --filter backend exec jest src/modules/workflows/preferences/preference-search/preference-search.workflow.spec.ts`
   - `pnpm --filter backend exec jest src/modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.spec.ts`
   - `pnpm --filter backend exec jest test/e2e/permission-grants.e2e-spec.ts`
   - `pnpm --filter backend exec jest test/e2e/mcp.e2e-spec.ts`

## Assumptions And Deferrals

- `/dashboard/permissions` is deferred for this patch; do not port the Auth0-based page now.
- The incidental preference-dashboard cherry-pick changes are discarded in favor of HEAD.
- Generated artifacts are regenerated, not merged:
  - `apps/backend/src/infrastructure/prisma/generated-client.ts`
  - `apps/backend/src/schema.gql`
- Optional OAuth-related helper code in `mcp-client-registry.service.ts` may remain temporarily if inert, but workshop runtime behavior must stay API-key-based end to end.

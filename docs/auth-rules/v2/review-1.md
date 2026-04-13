# Review 1

## Scope

Reviewed:

- `docs/auth-rules/v1/*`
- `docs/auth-rules/v2/implementation-plan.md`
- `docs/auth-rules/v2/permission-grants-summary.md`
- `git diff main...HEAD`

I also ran this targeted backend unit slice and it passed:

```bash
pnpm --filter backend exec jest \
  src/mcp/auth/mcp-authorization.service.spec.ts \
  src/modules/permission-grant/permission-grant.service.spec.ts \
  src/modules/workflows/preferences/preference-search/preference-search.workflow.spec.ts \
  src/modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.spec.ts
```

## Findings

1. `[P1]` Exact-slug exceptions are resolved by string length, so valid one-segment suffixes break the documented "exact beats wildcard" rule.

   In [`apps/backend/src/modules/permission-grant/permission-grant.service.ts:74`](../../../apps/backend/src/modules/permission-grant/permission-grant.service.ts), specificity is determined with `grant.target.length`. That makes an exact target like `a.b` tie with `a.*`, because both strings are length 3. The tie-breaker is then "deny wins", so `deny a.*` + `allow a.b` incorrectly denies `a.b` even though the exact slug should override the category wildcard. Since the slug grammar allows single-character segments, this is a real correctness bug in the new allowlist/exception model, not just a theoretical edge case.

2. `[P2]` AI-backed filtering bypasses static `targetRules`, so denied slugs can still leak into prompts.

   [`apps/backend/src/modules/preferences/preference-definition/preference-schema-snapshot.service.ts:59`](../../../apps/backend/src/modules/preferences/preference-definition/preference-schema-snapshot.service.ts) only applies DB grants through `PermissionGrantService.filterSlugsByAccess(...)`. It never runs the static policy layer from `McpAuthorizationService.canAccess(...)`, even though the v1/v2 design says enforcement order is coarse policy -> static `targetRules` -> DB grants. `McpClientRegistry` only rejects `matcher.namespace`; slug and slugPrefix rules are still valid config today, so a future static deny can be silently ignored by `smartSearchPreferences` and `consolidateSchema`, leaking blocked definitions into the AI prompt while the non-AI read paths stay correctly filtered.

3. `[P2]` The GraphQL grant API accepts arbitrary `clientKey` strings, which creates silent dead grants.

   [`apps/backend/src/modules/permission-grant/dto/set-permission-grant.input.ts:11`](../../../apps/backend/src/modules/permission-grant/dto/set-permission-grant.input.ts) validates `clientKey` as only a non-empty string, and [`apps/backend/src/modules/permission-grant/permission-grant.resolver.ts:48`](../../../apps/backend/src/modules/permission-grant/permission-grant.resolver.ts) persists it directly. But the actual client buckets are fixed in [`apps/backend/src/config/mcp.config.ts:6`](../../../apps/backend/src/config/mcp.config.ts). A typo like `codeex` or a stale frontend value will write a row that is never enforced for any MCP client and will never show up in `listPermissionGrants` for a real caller. That turns a simple user input mistake into silent authorization misconfiguration.

## What Landed

The branch does implement most of the v2 plan:

- Prisma `PermissionGrant` model + migration
- `PermissionGrantModule` with repository, service, resolver, DTOs, and GraphQL model
- Target-aware authorization hooks in `McpAuthorizationService`
- Grant-aware enforcement in the write tools (`suggestPreference`, `createPreferenceDefinition`, `deletePreference`)
- Grant-aware filtering in `searchPreferences`, `listPreferenceSlugs`, `smartSearchPreferences`, and `consolidateSchema`
- Read-only MCP introspection via `listPermissionGrants`
- GraphQL CRUD for grant management
- Minimal `/dashboard/permissions` UI
- New integration/unit/e2e coverage around repository logic, grant evaluation, MCP enforcement, and GraphQL CRUD

## Gaps Vs Plan

- The code TODO explaining why MCP grant mutation tools are intentionally omitted does not appear to have been added.
- `docs/auth-rules/v1/gates-workshop-2026-handoff.md` was not updated with the permission-grant merge follow-up described in Checkpoint 11.
- The new permission-grants E2E file does not cover a few plan items yet: invalid target rejection, unauthenticated GraphQL access, or the coarse-policy-vs-DB-grant case (`codex` still cannot write even with `allow * write`).

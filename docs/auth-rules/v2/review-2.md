# Review 2

## Scope

Reviewed:

- `docs/auth-rules/v1/*`
- `docs/auth-rules/v2/implementation-plan.md`
- `docs/auth-rules/v2/permission-grants-summary.md`
- `docs/auth-rules/v2/review-1.md`
- `git diff main...HEAD` (all 42 changed files, ~2800 lines added)
- Full read of every changed backend source file, test, and migration

## Status of review-1 findings

Before new findings, here is where the three review-1 issues stand:

1. `[P1]` **String-length specificity bug** — still present. `evaluateAgainstGrants` at [`permission-grant.service.ts:74`](../../../apps/backend/src/modules/permission-grant/permission-grant.service.ts) still uses `grant.target.length` as the specificity metric. A slug like `a.b` (length 3) ties with `a.*` (length 3), so the deny-wins tiebreaker fires and `deny a.*` + `allow a.b` incorrectly denies the exact slug. This blocks the allowlist-via-exceptions pattern for short slugs.

2. `[P2]` **AI-backed filtering bypasses static targetRules** — still present. Confirmed below with additional detail (finding 2).

3. `[P2]` **GraphQL accepts arbitrary clientKey** — still present. Expanded below (finding 3).

---

## New findings

### 1. `[P2]` `matchedDefinitions` is not post-filtered in `SmartSearchTool`

In [`smart-search.tool.ts:85-93`](../../../apps/backend/src/mcp/tools/smart-search.tool.ts), the tool post-filters `matchedActivePreferences` and `matchedSuggestedPreferences` via `filterByTargetAccess`, but `matchedDefinitions` is spread through unfiltered:

```typescript
const filteredResult = {
  ...result,
  matchedActivePreferences: result.matchedActivePreferences.filter(…),
  matchedSuggestedPreferences: result.matchedSuggestedPreferences.filter(…),
};
```

`matchedDefinitions` comes from the grant-filtered snapshot in the workflow, so it reflects the grant state at workflow start time. But the post-filter re-evaluates grants at tool return time. If a grant is added mid-request (TOCTOU), or if `filterByTargetAccess` rejects a slug that `filterSlugsByAccess` allowed (because `filterByTargetAccess` also checks static `targetRules`), the response will contain a definition entry for a slug whose preferences were filtered out. This leaks the slug name and description metadata.

**Suggested fix:** Also filter `matchedDefinitions` against `allowedSlugs`:

```typescript
matchedDefinitions: result.matchedDefinitions.filter((def) =>
  allowedSlugs.has(def.slug),
),
```

### 2. `[P2]` `getGrantFilteredSnapshot` still bypasses the static targetRules layer (review-1 #2 expansion)

[`preference-schema-snapshot.service.ts:67`](../../../apps/backend/src/modules/preferences/preference-definition/preference-schema-snapshot.service.ts) calls `permissionGrantService.filterSlugsByAccess(...)` directly. This only evaluates DB grants. It never calls `McpAuthorizationService.canAccess(client, access, grants, { slug })`, which is the method that evaluates coarse policy + static `targetRules`.

Compare with `filterByTargetAccess` in [`mcp-authorization.service.ts:186-207`](../../../apps/backend/src/mcp/auth/mcp-authorization.service.ts), which first filters by `canAccess` (static rules) then by `filterSlugsByAccess` (DB grants). The non-AI read tools (`searchPreferences`, `listPreferenceSlugs`) call `filterByTargetAccess` and get both layers. The AI-backed tools get only the DB layer.

The `McpClientRegistry` startup guard rejects `matcher.namespace` static rules but explicitly allows `slug` and `slugPrefix` rules. If someone adds a `slugPrefix`-based static rule, non-AI tools would filter correctly while AI tools would leak the slugs into the prompt.

**Suggested fix:** `getGrantFilteredSnapshot` should accept a `ResolvedMcpClient` and `McpCapability[]` (grants), and call through `McpAuthorizationService.filterByTargetAccess` instead of directly to `PermissionGrantService.filterSlugsByAccess`. Alternatively, the method signature could accept a pre-built filter function to avoid coupling the snapshot service to MCP auth types.

### 3. `[P2]` `clientKey` validation gap creates silent dead grants and bad dashboard UX (review-1 #3 expansion)

[`set-permission-grant.input.ts:11`](../../../apps/backend/src/modules/permission-grant/dto/set-permission-grant.input.ts) only validates `@IsNotEmpty()` and `@IsString()`. The resolver at [`permission-grant.resolver.ts:48`](../../../apps/backend/src/modules/permission-grant/permission-grant.resolver.ts) persists whatever string is passed.

This is worse than just a silent no-op:

- The `/dashboard/permissions` UI currently passes `clientKey` from a text/select input. A typo creates a grant that silently does nothing.
- `listPermissionGrants` MCP tool only returns grants matching the calling client's own key. Dead grants are invisible via MCP introspection.
- `myPermissionGrants` GraphQL query WILL return dead grants, so the dashboard shows them as active rules even though they have no enforcement effect.
- A user could believe they've restricted a client when they haven't.

**Suggested fix:** Add a `@IsIn(['claude', 'codex', 'fallback'])` validator on the DTO, or validate against `McpClientRegistry.getAllClientKeys()` at the resolver level.

### 4. `[P2]` `removePermissionGrant` is not idempotent — throws on missing grant

[`permission-grant.repository.ts:47`](../../../apps/backend/src/modules/permission-grant/permission-grant.repository.ts) uses `prisma.permissionGrant.delete()`, which throws Prisma `P2025` (Record to delete does not exist) if the grant isn't found. The resolver at [`permission-grant.resolver.ts:68`](../../../apps/backend/src/modules/permission-grant/permission-grant.resolver.ts) doesn't catch this, so removing a non-existent grant returns an unhandled GraphQL error.

The mutation signature `@Mutation(() => Boolean)` returning `true` implies idempotent semantics ("ensure this grant does not exist"). The current behavior breaks that contract and will cause confusing errors in the dashboard UI if a user double-clicks delete or if a grant was already removed in another tab.

**Suggested fix:** Use `deleteMany` instead of `delete`, or wrap with try/catch returning `false` on `P2025`.

### 5. `[P3]` `consolidateSchema` tool has no post-filter for DB grants

Unlike `smartSearchPreferences`, the `consolidateSchema` tool at [`schema-consolidation.tool.ts:40-44`](../../../apps/backend/src/mcp/tools/schema-consolidation.tool.ts) does not apply any post-filter via `filterByTargetAccess` after the workflow returns. It relies entirely on `getGrantFilteredSnapshot` in the workflow.

This means `consolidateSchema` has only one layer of grant enforcement (the snapshot pre-filter), while `smartSearchPreferences` has two (snapshot pre-filter + tool post-filter). The smart-search tool's post-filter catches preferences fetched after the snapshot (e.g., `getActivePreferences` could return a preference for a slug the user added a grant for after the snapshot was built). `consolidateSchema` doesn't fetch preferences, so this is less risky, but it creates an inconsistency in the defense-in-depth model across tools.

### 6. `[P3]` `preference-list` tool accesses `context.client` without null guard when `requiresAuth = false`

[`preference-list.tool.ts:92-103`](../../../apps/backend/src/mcp/tools/preference-list.tool.ts) checks `if (context?.user)` but then accesses `context.client` unconditionally inside the block. The tool has `requiresAuth = false`, meaning it can execute without auth. If an unauthenticated request somehow populates `context.user` but not `context.client` (e.g., a partial mock in a future test), this would throw a runtime error. Currently safe in production because the auth guard either populates both or neither, but it's a latent fragility.

---

## Test coverage gaps

The E2E file [`permission-grants.e2e-spec.ts`](../../../apps/backend/test/e2e/permission-grants.e2e-spec.ts) covers the core happy paths well. Missing scenarios from the implementation plan (Checkpoint 9):

| Plan scenario | Status |
|---|---|
| Default (no grants) — all tools work as before | Not explicitly tested (implicitly covered by existing MCP E2E) |
| Global deny `deny * read` -> all reads empty | Not tested |
| Category deny + slug exception | Not tested (review-1 noted this) |
| Sub-category wildcard `deny food.french.*` | Not tested |
| Per-client isolation (deny for claude doesn't affect codex) | Not tested |
| Per-user isolation (user A grants don't affect user B) | Not tested |
| Coarse policy interaction (codex + `allow * write` still can't write) | Not tested |
| Allowlist pattern (`deny * read` + `allow food.* read`) | Not tested |
| Invalid target format returns validation error (GraphQL) | Not tested |
| Unauthenticated GraphQL access returns 401 | Not tested |
| `createPreferenceDefinition` denied by slug grant | Not tested |

---

## Gaps vs plan

- **Missing TODO comment:** The plan (Checkpoint 6) calls for a comment block explaining why MCP grant mutation tools are deferred. Not present in code.
- **`gates-workshop-2026-handoff.md` not updated:** Checkpoint 11 says to update this doc with permission-grant merge follow-up notes. Not done.
- **No `clientKey` validation in GraphQL:** The plan mentions "Target format validation via custom validator" but not clientKey validation. This is a plan gap as much as an implementation gap.

---

## What landed well

- The prefix-chain decomposition algorithm is clean and correct (modulo the length-based specificity issue for short segments).
- The layering in `McpAuthorizationService` — coarse policy, then static targetRules, then DB grants via `canAccessTarget` / `assertAccessTarget` — is well-structured and matches the documented model.
- The `filterByTargetAccess` batch path is efficient: one DB query for all grants, then in-memory evaluation per slug.
- The defense-in-depth in `SmartSearchTool` (snapshot pre-filter + tool post-filter) catches preferences that could appear between grant evaluation and response construction.
- E2E tests validate the AI prompt content (not just the response), confirming that `getGrantFilteredSnapshot` actually keeps denied slugs out of the model's context window.
- The `PermissionGrantListTool` scoping to calling client key prevents cross-client grant enumeration.
- The GraphQL CRUD surface follows existing resolver patterns and integrates naturally with the auth guard.
- The migration and schema are clean — the unique constraint `(userId, clientKey, target, action)` prevents conflicting allow/deny for the same tuple.

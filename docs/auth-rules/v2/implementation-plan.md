# Permission Grants: Per-Client Per-Slug Authorization

## Context

The current MCP auth system has coarse read/write permissions per client bucket (claude=read+write, codex=read+write, fallback=read-only, etc.) but no way for users to control which slugs/categories each client can access. The goal is to let users set granular permissions like "codex can read `food.*` but not `dev.*`" — stored in the DB, configurable via the web UI.

The approach: a `PermissionGrant` table with **prefix matching** (`*`, `food.*`, `food.french.*`, exact slug). The authorizer decomposes a target slug into a prefix chain and picks the most specific matching grant. No grant = allow by default (coarse policy still applies as the first gate).

## Key design decisions

- **Default stance:** Allow by default — no grant means the coarse policy decides (trivial to flip later). Note: to express "codex may read only `food.*`", users set `deny * read` + `allow food.* read`. This is the allowlist-via-exceptions pattern — the default is easy to flip if a deny-by-default UX is preferred later.
- **Unique constraint:** `(userId, clientKey, target, action)` — one effect per target+action, no conflicting allow/deny
- **Wildcard safety:** `*` is forbidden in slug names by existing regex `/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/`
- **Layering order:** Coarse policy -> static `targetRules` -> DB grants. Each layer can only further narrow, never widen past the previous layer.
- **Read and write are independent:** granting write does not imply read
- **Target grammar:** Valid targets are: `*` (global wildcard), `<one-or-more-segments>.*` (prefix wildcard, e.g. `food.*`, `food.french.*`), or an exact slug (e.g. `food.dietary_restrictions`). The `<segments>` portion follows slug segment rules: `[a-z][a-z0-9_]*`.
- **Namespace-agnostic grants:** Grants match by slug only, not by namespace. A grant for `food.dietary_restrictions` applies to both the GLOBAL definition and any `USER:<userId>` definition with the same slug. This is intentional — the slug represents the same conceptual preference regardless of namespace. If namespace-aware grants are needed later, `McpTarget` already has a `namespace` field that could be incorporated.
- **No MCP grant management tools in v1:** Grant management is done via the web UI only. This avoids the problem of a write-capable client being able to remove its own restrictions. A TODO will be left in code noting that MCP-based grant management is an open question pending a trust model decision (e.g., separate `permissions:write` capability, or self-modification guard). `PermissionGrantModule` is still used by MCP for enforcement and the read-only `listPermissionGrants` tool; only grant mutation stays out of MCP.
- **`listPermissionGrants` scoping:** The read-only MCP tool only returns grants for the calling client's own `clientKey`. Codex sees codex grants, Claude sees claude grants. **Privacy note:** Even scoped this way, grant entries can reveal which slugs exist and which the user cared enough to restrict. This is a known information leakage vector, documented but not solved in v1.
- **DB enums for `action` and `effect`:** Use Prisma enums (`GrantAction`, `GrantEffect`) instead of plain strings. The codebase already uses enums for `PreferenceValueType`, `PreferenceScope`, etc. — this gives DB-level integrity with minimal cost.
- **Bulk filtering and static targetRules:** `filterByTargetAccess` evaluates DB grants on slugs only. Static `targetRules` with `namespace` matchers are only evaluated in single-target `canAccessTarget` checks, not in bulk filtering. This is acceptable because no static targetRules exist in current config. If namespace-based static rules are added later, bulk filtering will need full `McpTarget` plumbing (namespace through `EnrichedPreference` and the filtering paths).
- **Startup guard for unsupported static rules:** While bulk filtering is slug-only, startup validation must reject any configured static `targetRule` with `matcher.namespace`. This prevents silent partial enforcement if someone later adds namespace-based static rules.
- **Scope of this plan:** This plan covers backend enforcement, the MCP read-only introspection tool, a **GraphQL API** for grant CRUD (resolver + DTOs + model), and a **minimal dashboard UI** for testing grant management end to end. A polished permissions UX is out of scope and can come later.

## Files to create

| File | Purpose |
|------|---------|
| `prisma/migrations/<ts>_add_permission_grants/migration.sql` | Auto-generated |
| `src/modules/permission-grant/permission-grant.repository.ts` | CRUD + prefix-chain query |
| `src/modules/permission-grant/permission-grant.service.ts` | `buildPrefixChain`, `evaluateAccess`, `filterSlugsByAccess` |
| `src/modules/permission-grant/permission-grant.module.ts` | NestJS module (exports service + repo) |
| `src/modules/permission-grant/permission-grant.service.spec.ts` | Unit tests for prefix-chain/grant evaluation logic |
| `src/mcp/tools/permission-grant-list.tool.ts` | MCP tool: list own grants (read-only, scoped to calling client) |
| `src/modules/permission-grant/permission-grant.resolver.ts` | GraphQL resolver: queries + mutations for grant CRUD |
| `src/modules/permission-grant/dto/set-permission-grant.input.ts` | GraphQL input for creating/updating a grant |
| `src/modules/permission-grant/models/permission-grant.model.ts` | GraphQL ObjectType for grant |
| `apps/web/app/dashboard/permissions/page.tsx` | Server page: fetch grants and access token for testing UI |
| `apps/web/app/dashboard/permissions/PermissionsClient.tsx` | Simple client UI for listing/creating/removing grants |
| `test/integration/permission-grant.repository.spec.ts` | Repository integration tests |
| `test/e2e/permission-grants.e2e-spec.ts` | Full E2E tests |

## Files to modify

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `PermissionGrant` model + User relation |
| `src/app.module.ts` | Import `PermissionGrantModule` so GraphQL resolver is registered |
| `src/mcp/auth/mcp-authorization.service.ts` | Add async `canAccessTarget`, `assertAccessTarget`, `filterByTargetAccess` |
| `src/mcp/auth/mcp-authorization.service.spec.ts` | Tests for new async methods |
| `src/mcp/auth/mcp-client-registry.service.ts` | Reject unsupported static `targetRules` with `matcher.namespace` at startup |
| `src/mcp/auth/mcp-client-registry.service.spec.ts` | Startup validation test for unsupported namespace matchers |
| `src/mcp/mcp.module.ts` | Import `PermissionGrantModule` for grant-aware auth + register `listPermissionGrants` tool in `MCP_TOOLS` |
| `src/mcp/tools/preference-suggest.tool.ts` | Add target-aware auth check using `params.slug` |
| `src/mcp/tools/preference-definition.tool.ts` | Add target-aware auth check using `params.slug` |
| `src/mcp/tools/preference-delete.tool.ts` | Look up slug from preference ID, then target-aware auth check |
| `src/mcp/tools/preference-search.tool.ts` | Post-filter results by slug access |
| `src/mcp/tools/preference-list.tool.ts` | Post-filter entries, derive `categories` from filtered entries |
| `src/mcp/tools/smart-search.tool.ts` | Pre-filter snapshot before AI prompt construction |
| `src/mcp/tools/schema-consolidation.tool.ts` | Pre-filter snapshot before AI prompt construction |
| `src/modules/preferences/preference-definition/preference-schema-snapshot.service.ts` | Add grant-aware variant that filters definitions before building promptJson |
| `src/modules/workflows/preferences/preference-search/preference-search.workflow.ts` | Accept `clientKey` in input, use grant-filtered snapshot |
| `src/modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.ts` | Accept `clientKey` in input, use grant-filtered snapshot |
| `apps/web/app/dashboard/page.tsx` | Add a link to the new permissions test page |

## Checkpoints

### Checkpoint 1: Prisma model + migration + repository

**Schema addition** (`prisma/schema.prisma`):
```prisma
enum GrantAction {
  READ
  WRITE
}

enum GrantEffect {
  ALLOW
  DENY
}

model PermissionGrant {
  id        String      @id @default(uuid())
  userId    String      @map("user_id")
  clientKey String      @map("client_key")
  target    String      // '*', 'food.*', 'food.french.*', 'food.dietary_restrictions'
  action    GrantAction
  effect    GrantEffect
  createdAt DateTime    @default(now()) @map("created_at")
  updatedAt DateTime    @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [userId], onDelete: Cascade)

  @@unique([userId, clientKey, target, action])
  @@index([userId, clientKey, action])
  @@map("permission_grants")
}
```

Add `permissionGrants PermissionGrant[]` to `User` model.

**Repository** (`permission-grant.repository.ts`):
- `upsert(userId, clientKey, target, action, effect)` — create or update
- `remove(userId, clientKey, target, action)` — delete specific grant
- `findByUserAndClient(userId, clientKey)` — all grants for user+client
- `findByUserClientAction(userId, clientKey, action)` — all grants for one action (used by bulk filtering)
- `findByUser(userId)` — all grants for user
- `findMatchingGrants(userId, clientKey, action, prefixChain: string[])` — `WHERE target IN (prefixChain)` ordered by `LENGTH(target) DESC`

**Tests** (`test/integration/permission-grant.repository.spec.ts`):
- CRUD operations
- Unique constraint on upsert
- `findMatchingGrants` returns correct rows in specificity order
- Cascade delete with user

**Run:**
- `pnpm --filter backend prisma:generate`
- `pnpm --filter backend test:db:migrate`
- `cd apps/backend && pnpm test --testPathPattern=permission-grant.repository`

---

### Checkpoint 2: Grant evaluation service + unit tests

**Service** (`permission-grant.service.ts`):

`buildPrefixChain(slug)`:
- `'food.french.wine'` -> `['food.french.wine', 'food.french.*', 'food.*', '*']`
- `'food.dietary_restrictions'` -> `['food.dietary_restrictions', 'food.*', '*']`

`evaluateAccess(userId, clientKey, action, slug)` -> `'allow' | 'deny' | 'no-grant'`:
1. Build prefix chain
2. Query `findMatchingGrants(userId, clientKey, action, chain)`
3. No matches -> `'no-grant'`
4. Take most specific match (longest target). If tie at same length, deny wins.
5. Return its effect

`filterSlugsByAccess(userId, clientKey, action, slugs)` -> `string[]`:
- Batch: load all grants for `(userId, clientKey, action)` once via `findByUserClientAction(...)`
- Evaluate each slug in memory against the grant set
- Return allowed slugs (slugs with no matching grant are allowed — allow-by-default)

**Unit tests** (`permission-grant.service.spec.ts` — exception to normal pattern, testing pure logic):
- Prefix chain construction (2-segment, 3-segment, edge cases)
- Most-specific-wins precedence
- Deny-wins on tie at same specificity
- No-grant default returns `'no-grant'`
- Exact slug beats category wildcard
- Global wildcard `*`
- Multi-segment prefix: `food.french.*` matches `food.french.wine`
- Batch filter correctness

**Run:** `cd apps/backend && pnpm test --testPathPattern=permission-grant.service`

---

### Checkpoint 3: Wire into McpAuthorizationService

**New methods on `McpAuthorizationService`**:

```typescript
async canAccessTarget(client, access, grants, userId, target: McpTarget): Promise<boolean>
```
1. **Call existing `canAccess(client, access, grants, target)` WITH the target** — this evaluates coarse policy AND static `targetRules`. If denied, return false immediately.
2. If no `target.slug`, return true (no slug to check grants against).
3. Call `permissionGrantService.evaluateAccess(userId, client.key, access.action, target.slug)`
4. `'deny'` -> false, `'allow'` -> true, `'no-grant'` -> true

This ensures the layering is: coarse policy -> static targetRules -> DB grants. DB grants can only further narrow, never widen past static policy.

```typescript
async assertAccessTarget(client, access, grants, userId, surface, target): Promise<void>
```
Throws `McpAuthorizationError` on denial.

```typescript
async filterByTargetAccess(client, access, grants, userId, slugs): Promise<string[]>
```
Coarse check first (with target per slug), then `permissionGrantService.filterSlugsByAccess`.

**Module wiring:** Import `PermissionGrantModule` in `McpModule` so target-aware authorization can inject `PermissionGrantService` and MCP can register the read-only `listPermissionGrants` tool. This does **not** add MCP mutation tools.

**Startup validation for unsupported static rules:** Update `McpClientRegistry.validateTargetRules(...)` to reject any `rule.matcher.namespace`. This is a v1 safeguard: bulk filtering is slug-only, so namespace-based static `targetRules` are unsupported until full `McpTarget` plumbing exists across bulk read paths.

**Tests** (`mcp-authorization.service.spec.ts`): Mock `PermissionGrantService`, test:
- `canAccessTarget` calls existing `canAccess` WITH target (static targetRules evaluated)
- Static targetRule deny short-circuits before DB grants are checked
- DB grant `deny` narrows past static allow
- DB grant `allow` cannot widen past static deny
- `no-grant` defaults to allow
- `filterByTargetAccess` correctly filters

**Tests** (`mcp-client-registry.service.spec.ts`):
- Startup validation throws if any configured static `targetRule` uses `matcher.namespace`
- Existing slug/slugPrefix/static validation behavior remains unchanged

**Run:** `cd apps/backend && pnpm test --testPathPattern=mcp-authorization`

---

### Checkpoint 4: Target-aware auth in single-target tools

Each tool injects `McpAuthorizationService` and calls `assertAccessTarget` before its operation.

**`preference-suggest.tool.ts`:** Extract `params.slug`, check before calling `mutationTool.suggest()`.

**`preference-definition.tool.ts`:** Extract `params.slug`, check before calling the definition service.

**`preference-delete.tool.ts`:** Call `preferenceService.getPreference(id, userId)` to get slug, check, then call `mutationTool.delete()`.

**Note:** The existing coarse check in `mcp.service.ts` stays unchanged — it's the first gate. These per-tool checks are a second, target-aware gate.

**Tests** (in `test/e2e/permission-grants.e2e-spec.ts`):
- Deny `food.*` write for claude -> `suggestPreference(food.dietary_restrictions)` denied
- `suggestPreference(system.response_tone)` still works (no matching grant)
- Deny specific slug + allow category -> specific slug denied, others in category allowed
- Delete tool with denied slug -> denied

**Run:** `cd apps/backend && pnpm test --testPathPattern=permission-grants`

---

### Checkpoint 5: Grant-aware filtering in read tools

Two different patterns depending on whether the tool uses AI:

#### 5a: AI-backed tools — pre-filter BEFORE prompt construction

The AI-backed workflows (`PreferenceSearchWorkflow`, `SchemaConsolidationWorkflow`) load definitions via `PreferenceSchemaSnapshotService.getSnapshot()` and send them to the AI model as prompt context. Blocked slugs must be filtered **before** the model sees them, not after.

**`preference-schema-snapshot.service.ts`:** Add a grant-aware method:
```typescript
async getGrantFilteredSnapshot(userId, clientKey, action, scope?): Promise<PreferenceSchemaSnapshot>
```
This calls `getSnapshot()` then filters `definitions` and rebuilds `promptJson` from the filtered set.

**`preference-search.workflow.ts`:** Add `clientKey` to `PreferenceSearchWorkflowInput`. In step 1, call `snapshotService.getGrantFilteredSnapshot(userId, clientKey, 'read')` instead of `getSnapshot(userId)`. This ensures the AI prompt never contains blocked slugs. Steps 3-4 (slug validation + preference fetching) naturally exclude blocked slugs since they weren't in the snapshot.

**`smart-search.tool.ts`:** Pass `context.client.key` as `clientKey` in the workflow input. Also post-filter `matchedActivePreferences` and `matchedSuggestedPreferences` (fetched after AI returns slugs, may include preferences the user set before the grant was added).

**`schema-consolidation.workflow.ts`:** Add `clientKey` to `SchemaConsolidationWorkflowInput`. In step 1, call `snapshotService.getGrantFilteredSnapshot(userId, clientKey, 'read', scope)` instead of `getSnapshot(userId, scope)`. Post-filter `consolidationGroups` to remove groups referencing blocked slugs.

**`schema-consolidation.tool.ts`:** Pass `context.client.key` as `clientKey` in the workflow input.

#### 5b: Non-AI tools — post-filter results

**`preference-search.tool.ts`:** Filter `filteredActive` and `suggestions` arrays by slug after fetching.

**`preference-list.tool.ts`:** Filter catalog `entries` by slug. **Derive `categories` from the filtered entries** (not from a separate `defRepo.getAllCategories()` call), so blocked category names don't leak. Update `count` from filtered set.

**Tests:**
- Deny `food.*` read for claude -> search/list don't return food slugs
- `preference-list` `categories` array does not include `food` when all food slugs are denied
- Smart search with denied slugs -> AI never receives them in prompt, results don't include them
- Schema consolidation with denied slugs -> excluded from analysis
- Allowed slugs still appear in all tools
- No grants -> everything returned (allow-by-default)

**Run:** `cd apps/backend && pnpm test --testPathPattern=permission-grants`

---

### Checkpoint 6: Read-only MCP grant introspection + TODO for write tools

**`permission-grant-list.tool.ts`** (read): List the calling client's own grants. Scoped to `context.client.key` — a client can only see its own effective grants.
- `requiredAccess: { resource: 'preferences', action: 'read' }`
- No input parameters (always returns grants for the calling client)
- Returns: array of `{ target, action, effect, createdAt }`

Register in `mcp.module.ts` and `MCP_TOOLS` factory.

**TODO in code:** Add a comment block in `permission-grant-list.tool.ts` (or near the MCP_TOOLS registration) noting:
```
// TODO: MCP tools for setting/removing grants (setPermissionGrant, removePermissionGrant)
// are intentionally omitted in v1. A write-capable client could remove its own restrictions.
// Open questions before adding:
// - Separate `permissions:write` capability?
// - Self-modification guard (client cannot modify grants for its own clientKey)?
// - Grant management via MCP at all, or UI-only?
// For now, grants are managed via the web UI.
```

**Tests:**
- Claude calls `listPermissionGrants` -> sees only claude grants
- Codex calls `listPermissionGrants` -> sees only codex grants (does not see claude/fallback grants)
- No grants exist -> returns empty array
- Grants seeded in DB -> correctly returned with expected shape

**Run:** `cd apps/backend && pnpm test --testPathPattern=permission-grants`

---

### Checkpoint 7: GraphQL API for grant management

Backend API surface for the web UI to manage grants. Follows existing resolver patterns (see `preference-definition.resolver.ts`, `preference.resolver.ts`).

**`permission-grant.model.ts`** (GraphQL ObjectType):
- Fields: `id`, `clientKey`, `target`, `action` (GrantAction enum), `effect` (GrantEffect enum), `createdAt`, `updatedAt`
- Register `GrantAction` and `GrantEffect` enums with `registerEnumType`

**`set-permission-grant.input.ts`** (GraphQL InputType):
- Fields: `clientKey` (String, required), `target` (String, required), `action` (GrantAction, required), `effect` (GrantEffect, required)
- Validation: `@IsNotEmpty()`, `@IsString()`, `@IsEnum()`
- Target format validation via custom validator or reuse of the grant target grammar check from the service

**`permission-grant.resolver.ts`:**
- `@UseGuards(GqlAuthGuard)` — all operations require authentication
- `@Query(() => [PermissionGrantModel]) myPermissionGrants(@CurrentUser() user, @Args('clientKey', { nullable: true }) clientKey?)` — returns user's grants, optionally filtered by clientKey
- `@Mutation(() => PermissionGrantModel) setPermissionGrant(@CurrentUser() user, @Args('input') input)` — upserts a grant
- `@Mutation(() => Boolean) removePermissionGrant(@CurrentUser() user, @Args('clientKey') clientKey, @Args('target') target, @Args('action') action)` — deletes a grant

The resolver delegates to `PermissionGrantRepository` (or a thin service wrapper). Target format validation happens before the upsert.

**Module wiring:** Add resolver to `PermissionGrantModule` providers. Import `PermissionGrantModule` in `AppModule` so the GraphQL schema includes the grant CRUD resolver. Do not rely on `McpModule` transitively for GraphQL registration.

**Tests** (in `test/e2e/permission-grants.e2e-spec.ts`):
- GraphQL `myPermissionGrants` query returns grants for authenticated user
- GraphQL `setPermissionGrant` creates a grant, verify via query
- GraphQL `setPermissionGrant` upserts (change effect), verify via query
- GraphQL `removePermissionGrant` deletes, verify via query
- Invalid target format returns validation error
- Unauthenticated request returns 401

**Run:** `cd apps/backend && pnpm test --testPathPattern=permission-grants`

---

### Checkpoint 8: Minimal FE UI for testing

Add a simple dashboard page so grant CRUD and enforcement can be exercised manually without using GraphQL Playground directly.

**`apps/web/app/dashboard/permissions/page.tsx`:**
- Follow the same server-page pattern as `dashboard/schema/page.tsx`
- Require an authenticated session
- Fetch an access token
- Query `myPermissionGrants` on first load
- Render `PermissionsClient` with `initialGrants` and `accessToken`

**`apps/web/app/dashboard/permissions/PermissionsClient.tsx`:**
- Use a simple local-state client component with inline GraphQL strings
- Show existing grants in a table/list with columns:
  - `clientKey`
  - `target`
  - `action`
  - `effect`
  - `createdAt`
- Include a compact form to:
  - choose `clientKey` from known values (`claude`, `codex`, `fallback`)
  - enter `target`
  - choose `action`
  - choose `effect`
  - submit via `setPermissionGrant`
- Include a delete button per row using `removePermissionGrant`
- On success, update local state or re-fetch query
- Keep styling intentionally simple and utilitarian; this page is primarily for testing

**`apps/web/app/dashboard/page.tsx`:**
- Add a link/button to `/dashboard/permissions`

**Tests/manual verification:**
- Manual: open `/dashboard/permissions`, create a grant, verify it appears in the list
- Manual: remove a grant, verify it disappears
- Manual: create a grant, then test affected MCP behavior in the same user session

**Run:** `pnpm --filter web build` (or at minimum verify the page renders in `pnpm --filter web dev`)

---

### Checkpoint 9: Full integration test suite

Comprehensive E2E scenarios in `test/e2e/permission-grants.e2e-spec.ts`:

1. **Default (no grants):** All tools work as before
2. **Global deny:** `deny * read` -> all read tools return empty for that client
3. **Category deny + slug exception:** `deny food.*` + `allow food.dietary_restrictions` -> specific slug allowed, rest of category denied
4. **Sub-category wildcard:** `deny food.french.*` -> `food.french.wine` denied, `food.dietary_restrictions` allowed
5. **Per-client isolation:** Deny for claude doesn't affect codex
6. **Per-user isolation:** User A's grants don't affect user B
7. **Coarse policy interaction:** Codex with `allow * write` grant still can't write (coarse policy wins)
8. **Allowlist pattern:** `deny * read` + `allow food.* read` -> only food slugs visible
9. **Grant introspection scoping:** Claude's `listPermissionGrants` returns only claude grants, not codex/fallback

Note: Grants are seeded directly via the repository in E2E tests for MCP enforcement scenarios. GraphQL CRUD is tested separately in Checkpoint 7.

**Run:** `cd apps/backend && pnpm test` (full suite, verify no regressions)

---

### Checkpoint 10: Change summary

Write a summary of all changes implemented, covering:

- **New Prisma model:** `PermissionGrant` schema, migration, and what the table stores
- **New module:** `PermissionGrantModule` — repository, service, and their public APIs
- **Authorization changes:** New async target-aware methods on `McpAuthorizationService`, layering order (coarse -> static targetRules -> DB grants), and how DB grants can only narrow
- **Startup validation:** `McpClientRegistry` rejects unsupported static `targetRules` with `matcher.namespace` while bulk filtering is slug-only
- **Tool changes:** Which tools got target-aware enforcement (single-target), which got pre-filtering before AI (smart-search, schema-consolidation), and which got post-filtering (search, list)
- **Workflow changes:** How `PreferenceSearchWorkflow` and `SchemaConsolidationWorkflow` accept `clientKey` and use grant-filtered snapshots
- **New MCP tool:** `listPermissionGrants` — scoped to calling client, read-only
- **GraphQL API:** `myPermissionGrants` query, `setPermissionGrant` and `removePermissionGrant` mutations — full CRUD for web UI
- **Testing UI:** Minimal dashboard page for manually creating/removing grants and verifying behavior
- **Open questions documented:** Why MCP write tools for grant management are deferred, the self-modification problem, and the grant-based slug existence leakage
- **Test coverage:** Summary of new test files and key scenarios covered
- **Core algorithm:** How prefix-chain decomposition and most-specific-wins evaluation works, with examples

Place this summary in `docs/auth-rules/v2/permission-grants-summary.md`.

---

### Checkpoint 11: API-key branch migration reminder

The `gates-workshop-2026` branch uses API keys instead of OAuth but shares the same `clientKey`-based authorization model. The permission grants system introduced here needs to be merged into that branch.

**Action items to plan in a follow-up conversation:**

1. Cherry-pick or merge the `PermissionGrant` migration into the API-key branch
2. The shared authorization layer (`McpAuthorizationService`, `PermissionGrantService`, `PermissionGrantRepository`) should transfer cleanly — it depends on `userId` + `clientKey`, not on OAuth
3. The API-key branch's MCP context construction already populates `context.client` with a `clientKey` — the new `canAccessTarget`/`assertAccessTarget`/`filterByTargetAccess` methods will work as-is
4. The `listPermissionGrants` MCP tool should work unchanged since it only depends on `context.client.key` and `context.user.userId`
5. Test the same E2E scenarios from Checkpoint 9 against the API-key auth flow
6. Update `docs/auth-rules/v1/gates-workshop-2026-handoff.md` to reference the permission grants system and its merge touchpoints

**Do not start this migration now.** Create a separate plan for it after this branch is merged and stable.

---

## Verification

After all checkpoints:
1. `cd apps/backend && pnpm test` — all tests pass, no regressions
2. `cd apps/backend && pnpm test --testPathPattern=permission-grants` — all new E2E tests pass
3. Manual: create/remove grants via `/dashboard/permissions`, then connect via MCP and verify affected tools respect grants and `listPermissionGrants` returns scoped results
4. Manual: optionally verify the same CRUD flows via GraphQL Playground (`myPermissionGrants`, `setPermissionGrant`, `removePermissionGrant`)
5. Summary doc exists at `docs/auth-rules/v2/permission-grants-summary.md`
6. API-key branch migration is noted as a follow-up, not attempted in this branch

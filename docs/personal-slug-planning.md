# Plan: Namespace-based PreferenceDefinition Refactor

## Context

PreferenceDefinition currently uses `slug` as its primary key and Preference references it via a `slug` FK. This makes definitions global-only, preventing users from creating their own preference keys. The refactor introduces UUID-based identity with a `namespace` field (`"GLOBAL"`, `"USER:<userId>"`) to support user-owned definitions while keeping a simple path to future org/workspace support.

**User decisions:** Private-only user definitions, forbid slug collisions with GLOBAL, immutable slugs, no aliases for MVP, OK to nuke all existing data, optionally-authenticated catalog query.

---

## Step 1: Prisma Schema Migration

**File:** [schema.prisma](apps/backend/prisma/schema.prisma)

### PreferenceDefinition — new schema

```prisma
model PreferenceDefinition {
  id          String              @id @default(uuid())
  namespace   String              // "GLOBAL" or "USER:<userId>"
  slug        String
  displayName String?             @map("display_name")
  description String
  valueType   PreferenceValueType @map("value_type")
  scope       PreferenceScope
  options     Json?
  isSensitive Boolean             @default(false) @map("is_sensitive")
  isCore      Boolean             @default(false) @map("is_core")
  archivedAt  DateTime?           @map("archived_at")
  createdAt   DateTime            @default(now()) @map("created_at")
  updatedAt   DateTime            @updatedAt @map("updated_at")

  // Referential integrity: cascade-delete user-owned definitions when user is deleted
  ownerUserId String?             @map("owner_user_id")
  owner       User?               @relation(fields: [ownerUserId], references: [userId], onDelete: Cascade)

  preferences Preference[]

  @@unique([namespace, slug], where: { archivedAt: null }, map: "uniq_active_def_per_namespace_slug")
  @@index([namespace, slug])  // for lookup speed
  @@index([namespace])
  @@index([ownerUserId])
  @@map("preference_definitions")
}
```

Key changes vs current:
- `slug` is no longer `@id`; replaced by `id` (UUID)
- New: `namespace`, `displayName`, `archivedAt`, `ownerUserId` (FK to User)
- `ownerUserId` is NULL for global defs, set for user defs. `onDelete: Cascade` ensures cleanup when a user is deleted.
- Frontend derives system vs user from `ownerUserId != null` (more robust than parsing namespace strings)
- `@@unique([namespace, slug], where: { archivedAt: null })` — **partial unique index in Prisma schema** (requires `previewFeatures = ["partialIndexes"]`, available in Prisma 7.4.2+)
- `@@index` kept for lookup speed

**Archive strategy: partial unique index.** Archiving sets `archivedAt` but does NOT rename the namespace. Uniqueness of active definitions is enforced by Prisma's native partial unique index:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["partialIndexes"]
}

// In PreferenceDefinition model:
  @@unique([namespace, slug], where: { archivedAt: null }, map: "uniq_active_def_per_namespace_slug")
  @@index([namespace, slug])
```

This means:
- Active defs: `[namespace, slug]` is unique (enforced by DB via partial index)
- Archived defs: can have duplicate `[namespace, slug]` (allows unlimited archive/recreate cycles)
- No namespace mutation on archive — identity fields stay stable
- No manual SQL edits to migration files — Prisma manages the index, avoiding drift on future migrations

**Important:** Even with `@@unique(... where ...)`, we still:
- Never use `findUnique` on `(namespace, slug)` without `archivedAt: null` semantics
- Route all slug lookups through `resolveSlugToDefinitionId`
- Use `findFirst` with explicit `archivedAt: null` filters

### Preference — new schema

```prisma
model Preference {
  id           String           @id @default(uuid())
  userId       String           @map("user_id")
  locationId   String?          @map("location_id")
  contextKey   String           @map("context_key")  // "GLOBAL" or "LOCATION:<locationId>"
  definitionId String           @map("definition_id")
  value        Json
  status       PreferenceStatus @default(ACTIVE)
  sourceType   SourceType       @default(USER)
  confidence   Float?
  evidence     Json?
  createdAt    DateTime         @default(now()) @map("created_at")
  updatedAt    DateTime         @updatedAt @map("updated_at")

  user       User                 @relation(fields: [userId], references: [userId], onDelete: Cascade)
  location   Location?            @relation(fields: [locationId], references: [locationId], onDelete: Cascade)
  definition PreferenceDefinition @relation(fields: [definitionId], references: [id])

  @@unique([userId, contextKey, definitionId, status])
  @@index([userId, contextKey])
  @@index([definitionId])
  @@map("user_preferences")
}
```

Key changes vs current:
- `slug` field removed, replaced by `definitionId` (FK to PreferenceDefinition.id)
- **New `contextKey` field** (non-null) — solves the Postgres NULL uniqueness trap. Set to `"GLOBAL"` when `locationId` is null, `"LOCATION:<locationId>"` otherwise. Drives the unique constraint instead of nullable `locationId`.
- `locationId` kept for the relation/query convenience, but uniqueness is on `contextKey`
- `@@unique([userId, contextKey, definitionId, status])` — no NULL members, Postgres enforces correctly

### Migration

Run destructive migration (nuke data): `npx prisma migrate dev --name namespace_refactor`

No manual SQL edits needed — the partial unique index is represented in the Prisma schema via `@@unique(..., where: ...)` and will be included in the generated migration automatically.

Note: `User` model needs a `definitions PreferenceDefinition[]` relation field added. Generator block needs `previewFeatures = ["partialIndexes"]`.

### Implementation rule: explicit `userId` branching

Every repository method that accepts `userId?: string` must use explicit `if (!userId)` branches — never build a single Prisma `OR` clause with a potentially-undefined `userId`. This prevents accidental user-definition leakage to unauthenticated callers.

```typescript
// CORRECT: explicit branches
if (!userId) {
  return prisma.preferenceDefinition.findMany({
    where: { ownerUserId: null, archivedAt: null },
  });
}
return prisma.preferenceDefinition.findMany({
  where: {
    archivedAt: null,
    OR: [{ ownerUserId: null }, { ownerUserId: userId }],
  },
});

// WRONG: undefined in OR clause can match everything
return prisma.preferenceDefinition.findMany({
  where: {
    archivedAt: null,
    OR: [{ ownerUserId: null }, { ownerUserId: userId }], // userId might be undefined!
  },
});
```

Same pattern applies to `resolveSlugToDefinitionId`:
```typescript
if (userId) {
  const userDef = await prisma.preferenceDefinition.findFirst({
    where: { ownerUserId: userId, slug, archivedAt: null },
  });
  if (userDef) return userDef.id;
}
const globalDef = await prisma.preferenceDefinition.findFirst({
  where: { ownerUserId: null, slug, archivedAt: null },
});
```

### Invariants (enforced in service/repository code)

These rules keep data consistent. Not enforced at DB level for MVP, but documented for future hardening:
- If `locationId` is null → `contextKey` must be `"GLOBAL"`
- If `locationId` is set → `contextKey` must be `"LOCATION:<locationId>"`
- If `namespace = "GLOBAL"` → `ownerUserId` must be null
- If `namespace = "USER:<id>"` → `ownerUserId` must equal `<id>`

### Slug collision policy

Collisions are **asymmetric by design:**
- **User → Global: blocked.** Users cannot create a slug that already exists as an active global definition.
- **Global → User: allowed with warning.** If a new global definition is introduced (via seed or future admin tool) and a user already has an active definition with that slug, the global creation succeeds. A warning is logged. The user's definition continues to take precedence for that user via `resolveSlugToDefinitionId` (user-first resolution order).

**MVP limitation:** User-defined slugs are not globally reserved. If we later introduce a system definition with the same slug, the user definition will continue to take precedence for that user until a migration resolves the conflict. This is acceptable because: (a) the number of affected users will be tiny, (b) their data is never lost or corrupted, and (c) the global feature works for everyone else immediately.

---

## Step 2: Seed & Test DB Updates

**Files:**
- [prisma/seed.ts](apps/backend/prisma/seed.ts) — **Idempotent "ensure" pattern** (safe to re-run on every deploy):
  ```typescript
  for (const [slug, def] of Object.entries(PREFERENCE_CATALOG)) {
    const existing = await prisma.preferenceDefinition.findFirst({
      where: { namespace: 'GLOBAL', slug, archivedAt: null },
    });
    if (existing) {
      await prisma.preferenceDefinition.update({
        where: { id: existing.id },
        data: { description, valueType, scope, options, isSensitive, isCore: true },
      });
    } else {
      await prisma.preferenceDefinition.create({
        data: { namespace: 'GLOBAL', slug, ownerUserId: null, isCore: true, ... },
      });
    }
  }
  ```
  This avoids hitting the partial unique index on re-runs. When a global slug collides with existing user slugs, **log a warning with slug + collision count (not user IDs) but do not reject** (see "Slug collision policy").
- [test/setup/test-db.ts](apps/backend/test/setup/test-db.ts) — Tests start with a clean DB (`resetDb()`), so `createMany` is safe here. Set `namespace: 'GLOBAL'`, `ownerUserId: null`

---

## Step 3: PreferenceDefinition Backend Layer

### 3a. Repository
**File:** [preference-definition.repository.ts](apps/backend/src/modules/preferences/preference-definition/preference-definition.repository.ts)

**Drop the in-memory cache entirely.** All lookups become direct DB queries. The definitions table is small (dozens of rows) and Postgres handles this with negligible latency. This avoids stale-cache bugs if Cloud Run scales to multiple instances.

> **TODO:** If definition lookups become a measured bottleneck, add a TTL-based cache (refresh every 30-60s). Do not add in-memory cache preemptively.

Remove `OnModuleInit`, `refreshCache()`, and the `Map<string, ...>` cache.

Replace with direct Prisma queries. **Prefer `ownerUserId`-based filters** over building/parsing namespace strings where possible:

- `isKnownSlug(slug, userId?)` — delegates to `resolveSlugToDefinitionId`, returns `true`/`false` (no throw)
- `getDefinition(slug, userId?)` — delegates to `resolveSlugToDefinitionId(slug, userId)` → `getDefinitionById(id)`. **Single resolution path** ensures deterministic user-first behavior even when collision exists. Returns full row with derived `category`.
- `getDefinitionById(id)` — `findUnique({ where: { id } })`. **Includes archived defs** so enrichment of existing preferences still works.
- `resolveSlugToDefinitionId(slug, userId?)` — **the single source of truth for slug resolution.** Query non-archived defs: first check `ownerUserId = userId`, then `ownerUserId IS NULL`. Returns `id`. Throws if not found.
- `getAllSlugs(userId?)` / `getSlugsByCategory(category, userId?)` / `getAllCategories(userId?)` / `getAll(userId?)` — query non-archived defs where `ownerUserId IS NULL OR ownerUserId = <userId>`. **Deduplicate by slug (user wins):** if a user def and global def share a slug, only the user def appears. This keeps catalog listings, AI prompts, and UI clean.
- `findSimilarSlugs(input, userId?, limit?)` — query all non-archived visible slugs, score in-memory (table is small)
- `create(data)` — accepts `namespace`, `ownerUserId`, `displayName?`; **collision checks scoped to active defs only** (`archivedAt IS NULL`): if user-owned, reject if slug exists in GLOBAL. If GLOBAL, **log a warning with slug + count of colliding users** (not user IDs — avoids PII in logs) but do NOT reject (see "Slug collision policy" below).
- `update(id, data)` — by id, not slug; slug excluded (immutable)
- `archive(id)` — set `archivedAt = now()`. Namespace stays unchanged; partial unique index allows the `[namespace, slug]` slot to be reused by a new active definition.

### 3b. Service
**File:** [preference-definition.service.ts](apps/backend/src/modules/preferences/preference-definition/preference-definition.service.ts)

- `create(input, userId)` — sets `namespace = 'USER:<userId>'`, `ownerUserId = userId`
- `update(id, input, userId)` — by id, not slug; validate ownership (check `ownerUserId === userId` for user defs; GLOBAL defs only updatable by system/admin)
- New: `archiveDefinition(id, userId)` — set `archivedAt`, ownership check

### 3c. Resolver
**File:** [preference-definition.resolver.ts](apps/backend/src/modules/preferences/preference-definition/preference-definition.resolver.ts)

- `preferenceCatalog` query — **uses `OptionalGqlAuthGuard`** (not `GqlAuthGuard`):
  - If authenticated: returns GLOBAL + `USER:<userId>` defs (non-archived)
  - If unauthenticated: returns GLOBAL defs only
  - `userId` derived from auth context only — **never accepted as a query argument** (prevents data leaks)
  - This keeps MCP pre-auth callers working (they can still discover global slugs for prompt building)
- `createPreferenceDefinition` — keeps `GqlAuthGuard`, pass `userId` to service
- `updatePreferenceDefinition` — keeps `GqlAuthGuard`, change arg from `slug` to `id`
- New mutation: `archivePreferenceDefinition(id: ID!)` — keeps `GqlAuthGuard`

### 3d. GraphQL Model
**File:** [preference-definition.model.ts](apps/backend/src/modules/preferences/preference-definition/models/preference-definition.model.ts)

Add fields: `id` (ID), `namespace`, `displayName?`, `ownerUserId?`, `archivedAt?`

No `origin` enum — frontend derives system vs user from `ownerUserId != null`.

### 3e. DTOs
- [create-preference-definition.input.ts](apps/backend/src/modules/preferences/preference-definition/dto/create-preference-definition.input.ts) — add optional `displayName`; namespace/ownerUserId derived server-side
- [update-preference-definition.input.ts](apps/backend/src/modules/preferences/preference-definition/dto/update-preference-definition.input.ts) — add optional `displayName`; no slug field

---

## Step 4: Preference Backend Layer (slug → definitionId)

**Key pattern:** The GraphQL API continues accepting `slug` from clients. The service layer resolves slug → definitionId before any DB operation. Responses include both `slug` (enriched) and `definitionId`.

### 4a. Repository
**File:** [preference.repository.ts](apps/backend/src/modules/preferences/preference/preference.repository.ts)

- **Use `include: { definition: true }` in all preference queries** to avoid N+1. Since we now have a real FK, Prisma can join definitions in a single DB round trip. This replaces the separate `enrichWithCatalog` → `defRepo.getDefinitionById()` pattern.
- `EnrichedPreference` — add `slug: string` as enriched field (mapped from `pref.definition.slug`), keep `category?` (derived from `definition.slug`), `description?` (from `definition.description`)
- `enrichFromInclude(pref)` — maps the included `definition` relation to the enriched fields. No separate DB call needed.
- **`contextKey` derivation** — add a helper used by all upsert methods:
  ```typescript
  private deriveContextKey(locationId?: string | null): string {
    return locationId ? `LOCATION:${locationId}` : 'GLOBAL';
  }
  ```
- All upsert methods: change `slug` param to `definitionId`, add `contextKey` to creates/finds:
  - `upsertActive(userId, definitionId, value, locationId?)` — derives `contextKey`, uses it in findFirst and create
  - `upsertSuggested(userId, definitionId, value, confidence, locationId?, evidence?)` — same
  - `upsertRejected(userId, definitionId, value, locationId?)` — same
  - `hasRejected(userId, definitionId, locationId?)` — same
- `findActiveWithMerge` — merge key changes from `pref.slug` to `pref.definitionId`
- `findById` / `findByStatus` / `findSuggestedUnion` — add `include: { definition: true }`

### 4b. Service
**File:** [preference.service.ts](apps/backend/src/modules/preferences/preference/preference.service.ts)

- New private method `resolveDefinitionId(slug, userId)` — validates slug format, resolves via `defRepo.resolveSlugToDefinitionId(slug, userId)`, throws with "did you mean?" on unknown
- `validateValueForSlug` / `validateScope` — change to take definitionId, lookup via `defRepo.getDefinitionById()`
- `setPreference(userId, input)` — resolve `input.slug` → `definitionId`, validate, pass `definitionId` to repo
- `suggestPreference(userId, input)` — same resolution pattern
- `acceptSuggestion(id, userId)` — use `suggestion.definitionId` directly (already resolved)
- `rejectSuggestion(id, userId)` — use `suggestion.definitionId` directly
- `hasRejected` call — use `definitionId` from resolved suggestion

### 4c. GraphQL Model
**File:** [preference.model.ts](apps/backend/src/modules/preferences/preference/models/preference.model.ts)

- Add `definitionId: string` field
- Keep `slug: string` (now enriched/computed, not stored)

### 4d. DTOs — No changes needed
[set-preference.input.ts](apps/backend/src/modules/preferences/preference/dto/set-preference.input.ts) and [suggest-preference.input.ts](apps/backend/src/modules/preferences/preference/dto/suggest-preference.input.ts) still accept `slug`. Resolution happens server-side.

### 4e. Validation — No changes needed
[preference.validation.ts](apps/backend/src/modules/preferences/preference/preference.validation.ts) — `validateSlugFormat`, `validateValue`, `enforceScope`, `validateConfidence` remain as-is.

---

## Step 5: Document Analysis & MCP Tools

### 5a. PreferenceExtractionService
**File:** [preference-extraction.service.ts](apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.ts)

Pass `userId` through to `defRepo.getAllSlugs(userId)`, `defRepo.getDefinition(slug, userId)`, `defRepo.isKnownSlug(slug, userId)` so user-owned definitions appear in AI prompts.

### 5b. Document Analysis DTOs/Resolver — No changes
`applyPreferenceSuggestions` still accepts slug; resolution in `preferenceService.setPreference()`.

### 5c. MCP Tools
- [preference-list.tool.ts](apps/backend/src/mcp/tools/preference-list.tool.ts) — pass `userId` to `defRepo` methods for namespace-aware listing
- [preference-mutation.tool.ts](apps/backend/src/mcp/tools/preference-mutation.tool.ts) — pass `userId` to `isKnownSlug` validation
- [preference-search.tool.ts](apps/backend/src/mcp/tools/preference-search.tool.ts) — pass `userId` to catalog search methods

---

## Step 6: Tests

### 6a. Integration: PreferenceDefinitionRepository
**File:** [preference-definition.repository.spec.ts](apps/backend/test/integration/preference-definition.repository.spec.ts)

- Remove all cache-related tests (no more in-memory cache)
- Update assertions for new fields (`id`, `namespace`, `ownerUserId`)
- Add tests: namespace-aware lookups, collision prevention (both directions: user→global AND global→user), `archive()` (sets archivedAt, allows re-creation), `resolveSlugToDefinitionId()`
- Add test: `getDefinitionById()` returns archived defs (for enrichment)
- Add test: double archive/recreate cycle (create → archive → recreate → archive → recreate — all succeed)
- `create()` tests: include `namespace` and `ownerUserId` params

### 6b. Integration: PreferenceRepository
**File:** [preference.repository.spec.ts](apps/backend/test/integration/preference.repository.spec.ts)

- Add `beforeEach` helper to resolve slug → definitionId for test fixtures
- Change all `upsertActive(userId, slug, ...)` → `upsertActive(userId, definitionId, ...)`
- Verify `contextKey` is set correctly (`"GLOBAL"` vs `"LOCATION:<id>"`)
- Verify enriched results include `slug`, `definitionId`, `category`, `description` (from included definition)
- Merge key assertions use `definitionId`

### 6c. E2E: Preferences
**File:** [preferences.e2e-spec.ts](apps/backend/test/e2e/preferences.e2e-spec.ts)

- Add `definitionId` to GQL response selections
- Verify `slug` still returned (enriched)
- API inputs still use `slug` — no mutation changes needed

### 6d. E2E: Definition Mutations
**File:** [preference-definition-mutations.e2e-spec.ts](apps/backend/test/e2e/preference-definition-mutations.e2e-spec.ts)

- Response selections: add `id`, `namespace`, `ownerUserId`
- Update mutation: use `id` arg instead of `slug`
- New tests: create user definition, collision prevention, archive, double archive/recreate cycle

### 6e. E2E: Catalog
**File:** [preference-catalog.e2e-spec.ts](apps/backend/test/e2e/preference-catalog.e2e-spec.ts)

- Add `id`, `namespace` to selections
- Verify `namespace = 'GLOBAL'` for seeded defs
- Test: user-created def appears in authenticated catalog query
- Test: archived def does NOT appear in catalog
- **Tripwire test for optional-auth:** create a user definition, query `preferenceCatalog` unauthenticated, assert the user slug does NOT appear in the response (guards against future regressions that could leak user definitions)

### 6f. E2E: Document Analysis
**File:** [document-analysis.e2e-spec.ts](apps/backend/test/e2e/document-analysis.e2e-spec.ts)

- Add `definitionId` to response selections; minimal other changes

### 6g. Unit: PreferenceExtractionService
**File:** [preference-extraction.service.spec.ts](apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.spec.ts)

- Mock `defRepo` methods to accept optional `userId` param
- Mock preferences use `definitionId` instead of `slug`

---

## Step 7: Frontend Updates

- [SchemaClient.tsx](apps/web/app/dashboard/schema/SchemaClient.tsx) — update queries/mutations for new fields, update mutation uses `id` instead of `slug`, add `displayName` to forms, derive system/user badge from `ownerUserId != null`
- [PreferencesClient.tsx](apps/web/app/dashboard/preferences/PreferencesClient.tsx) — add `definitionId` to query selections
- Other FE components: no changes needed (still use `slug` in inputs, resolved server-side)
- Regenerate types: `pnpm --filter web run codegen`

---

## Verification

1. `cd apps/backend && npx prisma migrate dev --name namespace_refactor` — migration succeeds (partial index generated automatically by Prisma)
2. `pnpm --filter backend prisma:seed` — seeds 12 GLOBAL definitions with `ownerUserId = null`
3. `pnpm --filter backend test:integration` — all integration tests pass
4. `pnpm --filter backend test:e2e` — all e2e tests pass
5. Start backend, verify in GraphQL playground:
   - `preferenceCatalog` returns defs with `id`, `namespace`
   - `setPreference(input: { slug: "system.response_tone", value: "casual" })` returns `definitionId` + `slug`
   - `createPreferenceDefinition` for a user def works; collision with global slug rejected
   - Archive a user def, recreate same slug, archive again — all succeed (no collision)
6. `pnpm --filter web run codegen` — types regenerate without errors
7. Frontend: schema page and preferences page load correctly

---

## Design Decisions Log

| Decision | Rationale |
|----------|-----------|
| Partial unique index via Prisma `@@unique(..., where: ...)` | Native Prisma support (7.4.2+ with `partialIndexes` preview). Avoids manual SQL in migrations which would be dropped as drift on future migrations. Prisma manages the index lifecycle |
| Collision checks scoped to `archivedAt IS NULL` | Archived defs should never block new definitions |
| `ownerUserId`-based queries over namespace string parsing | More robust, leverages FK, makes future org namespaces easier |
| `contextKey` instead of nullable `locationId` in unique | Postgres NULL uniqueness trap — `NULL != NULL` allows duplicate rows |
| `ownerUserId` FK on PreferenceDefinition | Referential integrity — cascade-delete user defs when user is deleted |
| No `origin` enum | Redundant; derive from `ownerUserId != null` instead of parsing namespace strings |
| No in-memory cache | Avoids stale-cache bugs on Cloud Run horizontal scaling |
| `include: { definition: true }` in preference queries | Eliminates N+1 DB queries for enrichment; single round trip via Prisma join |
| Asymmetric collision: user→global blocked, global→user warn-only | Prevents deploy blockers; user defs shadow future global defs for affected users only |
| Keep slug in GraphQL inputs | All consumers (FE, MCP, doc analysis) use slugs; resolution happens server-side |
| `getDefinitionById` includes archived defs | Preferences referencing archived definitions still need slug/category for display |
| Idempotent seed (findFirst → update or create) | Avoids partial unique index violations on re-deploy; safe to run repeatedly |
| Explicit `if (!userId)` branching in repo methods | Prevents undefined userId in OR clauses from leaking user defs to unauthenticated callers |
| Log collision counts, not user IDs | Avoids PII in logs while still providing actionable info for future migration decisions |
| All slug lookups route through `resolveSlugToDefinitionId` | Single resolution path prevents ambiguous multi-row results on collision |
| Catalog/listing dedupes by slug (user wins) | Prevents confusing duplicate entries in UI and AI prompts when collision exists |
| Invariants documented, enforced in code | `contextKey`↔`locationId` and `namespace`↔`ownerUserId` consistency; DB constraints deferred to post-MVP |
| `OptionalGqlAuthGuard` on `preferenceCatalog` | One query, one mental model. Unauth callers see GLOBAL only; authed callers see GLOBAL + user defs. MCP pre-auth callers can still discover slugs. userId derived from auth only, never from args |

---

## Execution Order

Schema migration must precede all code changes (Prisma types won't compile otherwise). After that, follow TDD per CLAUDE.md: update tests first per layer, then implementation, then verify.

### Phase A: Foundation
1. Prisma schema migration (Step 1) — full DB reset OK
2. Test DB utilities (Step 2: test-db.ts)
3. Production seed (Step 2: seed.ts)

### Phase B: Backend (test-first per layer, bottom-up)
4. PreferenceDefinition integration tests (Step 6a) — **TESTS FIRST**
5. PreferenceDefinition repository + model + DTOs + service + resolver (Steps 3a–3e) → run `test:integration`
6. PreferenceDefinition E2E tests (Steps 6d, 6e) → run `test:e2e`
7. Preference integration tests (Step 6b) — **TESTS FIRST**
8. Preference repository + model + service (Steps 4a–4c) → run `test:integration`
9. Preference E2E tests (Steps 6c, 6f) → run `test:e2e`

### Phase C: Consumers
10. PreferenceExtractionService unit tests (Step 6g) + implementation (Step 5a) → run `test:unit`
11. MCP tools (Step 5c) → run `test:e2e -- --grep mcp`
12. Frontend (Step 7) + `pnpm --filter web run codegen`

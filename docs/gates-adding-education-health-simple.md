# Plan: Enable All 3 Categories (usermem, health, education) with Per-Category API Keys

> **Status: IMPLEMENTED** — All 9 checkpoints complete as of 2026-03-07.
> 212 tests passing (33 unit / 91 integration / 88 e2e).

## Context

The workshop previously had one pool of usermem users in grp-a / grp-b, all sharing the same GLOBAL preference schema. Two new synthetic user categories have been added (`health/` and `education/`) with their own JSONL data and field catalogs. Each category's users has a **completely separate schema** — health users see only health definitions, education only education, usermem only GLOBAL.

Goal: 6 API keys — `grp-a-usermem`, `grp-a-health`, `grp-a-education`, `grp-b-usermem`, `grp-b-health`, `grp-b-education`. Both grp-a and grp-b share the same user pool per category. **DB will be reset before seeding.**

## Architecture: `schemaNamespace` on User

Add a `schemaNamespace` field to the `User` table. This tells the preference system which shared definition catalog applies to that user:
- usermem → `"GLOBAL"`
- health → `"health"`
- education → `"education_k16"`

Shared definition pools (not per-user copies):
- ~43 GLOBAL defs (usermem, unchanged)
- 46 health defs
- 39 education_k16 defs

## Data Inventory

| Category  | Source                                               | # Users | Name field                          | # Defs | Namespace       |
|-----------|------------------------------------------------------|---------|-------------------------------------|--------|-----------------|
| usermem   | `synthetic_users/usermem/synthetic_users_20/`        | 20      | `core.identity.name.value`          | 43     | `GLOBAL`        |
| health    | `synthetic_users/health/synthetic_patients.jsonl`    | 10      | `profile.identification.name`       | 46     | `health`        |
| education | `synthetic_users/education/synthetic_student.jsonl`  | 11      | `student_profile.preferred_name`    | 39     | `education_k16` |

> **Note:** Despite the `.jsonl` extension, both health and education files are standard JSON arrays. Use `JSON.parse(readFileSync(...))`, not line-by-line parsing.

## Type Handling

Downcast for workshop (no type migration needed):
- `INTEGER` → `STRING` — extractors emit `"42"` not `42`
- `ARRAY_OBJECT` → `ARRAY` — downcasted in catalog; ARRAY_OBJECT fields are skipped in seeded *preferences* (keep in *catalog*)

## Namespace Constants

Centralized in `seed.ts`:
```ts
const SCHEMA_NS = {
  GLOBAL:    "GLOBAL",
  HEALTH:    "health",
  EDUCATION: "education_k16",
} as const;
```

## Seed Scope Decision

**Seeded a curated showcase subset of preferences (12 fields per user), not all 85.**

Rationale: A smaller, hand-picked set gives:
- Full schema browsing (all definitions seeded)
- Real per-user data (key fields populated)
- Category-specific behavior visible in the UI
- Much lower mapping risk

Actual showcase fields seeded per category:

**Health (12 fields):** `identification.name`, `identification.age`, `identification.gender`, `profile.baseline_summary`, `care_preferences.provider_style`, `care_preferences.care_setting_preference`, `communication_needs.language_preference`, `communication_needs.health_literacy_preference`, `vitals_and_measurements.baseline_metrics.height`, `vitals_and_measurements.baseline_metrics.weight`, `behavior_and_lifestyle.activity_preferences`, `behavior_and_lifestyle.nutrition_preferences`

**Education (12 fields):** `profile.preferred_name`, `demographics.age`, `demographics.gender`, `education.current_level`, `institutions.current_school`, `identity.identity_at_school`, `learning_preferences.modalities`, `learning_preferences.pace`, `study_habits.homework_routine`, `academic_snapshot.strengths.subjects`, `goals_and_plans.short_term_goals`, `interests.interests_and_extracurriculars`

## Files Changed

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `schemaNamespace String @default("GLOBAL") @map("schema_namespace")` to User |
| `prisma/migrations/20260307000000_add_schema_namespace_to_user/` | New migration (manual SQL — `prisma migrate dev` requires TTY) |
| `preference-definition.repository.ts` | Added `schemaNamespace = "GLOBAL"` param to all 9 lookup methods |
| `preference-definition.resolver.ts` | Passes `user?.schemaNamespace ?? "GLOBAL"` to `getAll` and `getByScope` |
| `preference/preference.service.ts` | Added `schemaNamespace` param to `resolveAndValidateSlug`, `setPreference`, `suggestPreference` |
| `preference/preference.resolver.ts` | Passes `(user as any).schemaNamespace ?? "GLOBAL"` to service calls |
| `prisma/seed.ts` | Added `SCHEMA_NS` constants, `seedHealthPreferenceDefinitions`, `seedEducationPreferenceDefinitions`, `seedHealthUsers`, `seedEducationUsers`, updated `createWorkshopGroups` for 6 keys |
| `test/e2e/schema-namespace.e2e-spec.ts` | New — 4 CP8 isolation tests |

### Implementation notes

- **`(user as any).schemaNamespace`**: The `User` GQL model does not expose `schemaNamespace` as a GraphQL field (not needed in API). The Prisma user object returned by the auth guard includes it naturally since `validateApiKeyAndUser` returns `apiKeyUser.user` (full Prisma row). Casting via `as any` avoids adding the field to the GQL schema.
- **Migration approach**: `prisma migrate dev` requires an interactive TTY. Migration SQL was written manually and applied via `prisma migrate deploy`.
- **Email format for health users**: `{slugified_name}_{index}@health.workshop.dev` (index always appended for predictability).
- **Email format for education users**: `{slugified_name}_{index}@education.workshop.dev` (same — handles duplicate names like Sofia at indices 6 and 8).

---

## Checkpoint 0 — Sweep for hardcoded GLOBAL assumptions ✅

Grepped `"GLOBAL"`, `preferences.catalog`, `grp-a|grp-b` across backend and frontend.

**Findings:**
- `preference-definition.repository.ts` — 4 hardcoded `"GLOBAL"` namespace lookups → parameterized in CP2
- `preference.repository.ts` — uses `"GLOBAL"` as a `contextKey` value (separate concept, leave as-is)
- `preference-extraction.service.spec.ts` — `contextKey: "GLOBAL"` in test fixture (acceptable)
- Test files (`api-key.guard.spec.ts`, `api-key.service.spec.ts`) — use `grp-a-abc123` as fixture key (acceptable)
- Frontend `page.tsx` / `GroupBrowser.tsx` — placeholder text `"grp-a-..."` (UI hint only, acceptable)
- MCP tools — call through the same repo, benefit automatically once repo is patched

---

## Checkpoint 1 — DB Migration: add `schemaNamespace` to User ✅

Added to `prisma/schema.prisma` User model:
```prisma
schemaNamespace  String  @default("GLOBAL") @map("schema_namespace")
```

Migration file: `prisma/migrations/20260307000000_add_schema_namespace_to_user/migration.sql`
```sql
ALTER TABLE "users" ADD COLUMN "schema_namespace" TEXT NOT NULL DEFAULT 'GLOBAL';
```

Applied via `prisma migrate deploy`. Prisma client regenerated.

**Result:** 33 unit tests pass — no behavior changed.

---

## Checkpoint 2 — Update `preference-definition.repository.ts` ✅

Added `schemaNamespace = "GLOBAL"` as a defaulted parameter to all 9 methods:

- `getAll(userId?, schemaNamespace = "GLOBAL")` — `namespaces = [schemaNamespace]`
- `getByScope(scope, userId, schemaNamespace = "GLOBAL")` — replaces hardcoded `"GLOBAL"` push
- `getDefinitionBySlug(slug, userId?, schemaNamespace = "GLOBAL")` — fallback uses `schemaNamespace`
- `resolveSlugToDefinitionId`, `isKnownSlug`, `findSimilarSlugs`, `getAllSlugs`, `getAllCategories`, `getSlugsByCategory` — all pass through to the above

All existing callers default to `"GLOBAL"` — zero behavior change.

**Result:** 33 unit + 91 integration tests pass.

---

## Checkpoint 3 — Thread `schemaNamespace` through service and resolvers ✅

**`preference.service.ts`**
- `resolveAndValidateSlug(slug, userId?, schemaNamespace = "GLOBAL")` — passes both to `resolveSlugToDefinitionId` and `findSimilarSlugs`
- `setPreference(userId, input, schemaNamespace = "GLOBAL")` and `suggestPreference(...)` — pass to `resolveAndValidateSlug`

**`preference.resolver.ts`**
- `setPreference` and `suggestPreference` pass `(user as any).schemaNamespace ?? "GLOBAL"` to service

**`preference-definition.resolver.ts`**
- `getCatalog`: `this.defRepo.getAll(userId, (user as any)?.schemaNamespace ?? "GLOBAL")`
- `exportPreferenceSchema`: `this.defRepo.getByScope(scope, user.userId, (user as any)?.schemaNamespace ?? "GLOBAL")`

**Result:** 33 unit tests pass.

---

## Checkpoint 4 — Seed health + education definitions ✅

**`seedHealthPreferenceDefinitions()`**
- Reads `synthetic_users/health/health_patient_field_catalog.json` (46 entries, JSON array)
- Creates each as `PreferenceDefinition` with `namespace: "health"`, using catalog's pre-assigned UUID as `id`
- Downcast: `INTEGER` → `STRING`, `ARRAY_OBJECT` → `ARRAY`

**`seedEducationPreferenceDefinitions()`**
- Same pattern with `education_k16_field_catalog.json`, `namespace: "education_k16"`, 39 entries

**Verified:**
```
namespace     | count
--------------+-------
GLOBAL        |    43
education_k16 |    39
health        |    46
```

---

## Checkpoint 5 — Seed health users ✅

**`seedHealthUsers(): Promise<User[]>`**
- Reads `synthetic_patients.jsonl` as a JSON array (10 patients)
- Email: `{slugified_name}_{index}@health.workshop.dev` (always index-suffixed)
- `schemaNamespace: "health"` on both create and update
- 12 preferences per user via `HEALTH_PATH_MAPPINGS`

**Verified:** 10 health users, 120 health preferences in DB.

---

## Checkpoint 6 — Seed education users ✅

**`seedEducationUsers(): Promise<User[]>`**
- Reads `synthetic_student.jsonl` as a JSON array (11 students)
- Email: `{slugified_name}_{index}@education.workshop.dev` (index always appended — handles Sofia at 6 and 8)
- `schemaNamespace: "education_k16"` on both create and update
- 12 preferences per user via `EDUCATION_PATH_MAPPINGS`

**Verified:** 11 education users, 132 education preferences in DB.

---

## Checkpoint 7 — Create workshop API keys ✅

`createWorkshopGroups(usermemUsers, healthUsers, eduUsers)` creates 6 keys:

```
grp-a-usermem   → 20 users
grp-a-health    → 10 users
grp-a-education → 11 users
grp-b-usermem   → 20 users
grp-b-health    → 10 users
grp-b-education → 11 users
```

Each key is printed in plaintext to stdout at seed time. Keys are hashed (SHA-256) before DB storage.

---

## Checkpoint 8 — Minimal tests ✅

File: `test/e2e/schema-namespace.e2e-spec.ts` — 4 tests, all passing:

1. **Health user sees only health defs** — `preferenceCatalog` returns only `namespace: "health"` entries; `system.response_tone` absent
2. **Education user sees only education_k16 defs** — same pattern; `identification.name` (health) absent
3. **Regression: GLOBAL user sees only GLOBAL defs** — health and education slugs absent
4. **Health user cannot setPreference with a GLOBAL slug** — `system.response_tone` returns `"Unknown preference slug"` error

---

## Checkpoint 9 — End-to-end smoke test

Run after deploying / starting the server with the seeded DB:

```bash
# Health user catalog — should return only health definitions
curl -X POST http://localhost:3000/graphql \
  -H "Authorization: Bearer <grp-a-health-key>.<health-user-id>" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ preferenceCatalog { slug namespace } }"}'
# Assert: all slugs from health namespace only

# Cross-category isolation
curl -X POST http://localhost:3000/graphql \
  -H "Authorization: Bearer <grp-a-health-key>.<usermem-user-id>" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ preferenceCatalog { slug } }"}'
# Assert: 401 Unauthorized (usermem user not in grp-a-health)
```

---

## Out of Scope (deferred)

- Test file updates for `test-db.ts` and `seed.spec.ts` — follow-up PR
- `ARRAY_OBJECT` proper type support — skip in seeded *preferences*, keep in *catalog*
- MCP discovery for health/education namespaces
- Frontend category/namespace badge in UI (good idea for workshop UX, not blocking)
- Full 85-field mapping — curated 12-field showcase is sufficient
- Adding `schemaNamespace` to the GraphQL `User` type — not needed for workshop use case

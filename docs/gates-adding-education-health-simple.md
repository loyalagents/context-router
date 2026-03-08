# Plan: Enable All 3 Categories (usermem, health, education) with Per-Category API Keys

## Context

The workshop previously had one pool of usermem users in grp-a / grp-b, all sharing the same GLOBAL preference schema. Two new synthetic user categories have been added (`health/` and `education/`) with their own JSONL data and field catalogs. Each category's users has a **completely separate schema** — health users see only health definitions, education only education, usermem only GLOBAL.

Goal: 6 API keys — `grp-a-usermem`, `grp-a-health`, `grp-a-education`, `grp-b-usermem`, `grp-b-health`, `grp-b-education`. Both grp-a and grp-b share the same user pool per category. **DB will be reset before seeding.**

## Architecture: `schemaNamespace` on User

Add a `schemaNamespace` field to the `User` table. This tells the preference system which shared definition catalog applies to that user:
- usermem → `"GLOBAL"`
- health → `"health"`
- education → `"education_k16"`

Shared definition pools (not per-user copies):
- ~46 GLOBAL defs (usermem, unchanged)
- 46 health defs
- 39 education_k16 defs

## Data Inventory

| Category  | Source                                               | # Users | Name field                          | # Defs | Namespace       |
|-----------|------------------------------------------------------|---------|-------------------------------------|--------|-----------------|
| usermem   | `synthetic_users/usermem/synthetic_users_20/`        | 20      | `core.identity.name.value`          | ~46    | `GLOBAL`        |
| health    | `synthetic_users/health/synthetic_patients.jsonl`    | 10      | `profile.identification.name`       | 46     | `health`        |
| education | `synthetic_users/education/synthetic_student.jsonl`  | 11      | `student_profile.preferred_name`    | 39     | `education_k16` |

> **Note:** Despite the `.jsonl` extension, both health and education files are standard JSON arrays. Use `JSON.parse(readFileSync(...))`, not line-by-line parsing.

## Type Handling

Downcast for workshop (no type migration needed):
- `INTEGER` → `STRING` — extractors must emit `"42"` not `42`
- `ARRAY_OBJECT` → `ARRAY` — if the UI expects arrays of strings, stringify or skip these fields in seeded *preferences* (keep them in the *catalog*). Test in UI before committing to full mapping.

## Namespace Constants

Centralize in `seed.ts` and reference in service/repo:
```ts
const SCHEMA_NS = {
  GLOBAL:    "GLOBAL",
  HEALTH:    "health",
  EDUCATION: "education_k16",
} as const;
```

## Seed Scope Decision

**Seed a curated showcase subset of preferences (~10–15 fields per user), not all 85.**

Rationale: `HEALTH_PATH_MAPPINGS` and `EDUCATION_PATH_MAPPINGS` for every field are the highest-risk part of the plan. A smaller, hand-picked set gives:
- Full schema browsing (all definitions seeded)
- Real per-user data (key fields populated)
- Category-specific behavior visible in the UI
- Much lower mapping risk

Suggested showcase fields per category:

**Health (~12 fields):** `identification.name`, `identification.age`, `identification.gender`, `profile.baseline_summary`, `care_preferences.provider_style`, `care_preferences.care_setting_preference`, `communication_needs.language_preference`, `medical_history.conditions.active`, `medications.current`, `vitals_and_measurements.baseline_metrics.height`, `vitals_and_measurements.baseline_metrics.weight`, `behavior_and_lifestyle.activity_preferences`

**Education (~12 fields):** `profile.preferred_name`, `demographics.age`, `demographics.gender`, `education.current_level`, `institutions.current_school`, `identity.identity_at_school`, `learning_preferences.modalities`, `learning_preferences.pace`, `study_habits.homework_routine`, `academic_snapshot.strengths.subjects`, `goals_and_plans.short_term_goals`, `interests_and_extracurriculars`

## Files Changed

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `schemaNamespace String @default("GLOBAL")` to User |
| `prisma/migrations/` | New migration |
| `preference-definition.repository.ts` | Add `schemaNamespace = "GLOBAL"` param to all lookup methods |
| `preference-definition.resolver.ts` | Pass `(userId, schemaNamespace)` — both — to repo calls |
| `preference/preference.service.ts` | Add `schemaNamespace` param to `resolveAndValidateSlug`, `setPreference`, `suggestPreference` |
| `preference/preference.resolver.ts` | Pass `user.schemaNamespace` to service calls |
| `prisma/seed.ts` | Health/education defs + users + 6 API keys |

---

## Checkpoint 0 — Sweep for hardcoded GLOBAL assumptions

Before writing any new code, grep the codebase for places that will break or behave unexpectedly:

```bash
grep -rn '"GLOBAL"' apps/backend/src/
grep -rn 'preferences\.catalog' apps/backend/src/
grep -rn 'grp-a\|grp-b' apps/backend/src/ apps/web/
```

Specifically inspect:
- `apps/backend/src/config/preferences.catalog.ts`
- Any document analysis / extraction services
- MCP tools and schema resources
- Frontend auth/workshop selection logic

Document any found assumptions and decide: update now or explicitly accept the limitation.

---

## Checkpoint 1 — DB Migration: add `schemaNamespace` to User

Add to `prisma/schema.prisma` User model:
```prisma
schemaNamespace  String  @default("GLOBAL") @map("schema_namespace")
```

```bash
pnpm --filter backend prisma migrate dev --name add_schema_namespace_to_user
```

**Verify:**
```bash
pnpm --filter backend test:unit
# All existing unit tests pass — no behavior changed yet
```

---

## Checkpoint 2 — Update `preference-definition.repository.ts`

Add `schemaNamespace = "GLOBAL"` as a **second** defaulted parameter to every method that currently hardcodes `"GLOBAL"`. Pass both `userId` and `schemaNamespace` at every call site.

> **Call site bug to avoid:** Never pass `schemaNamespace` into the `userId` slot. The signature is always `(userId?, schemaNamespace?)` — both must be passed explicitly at callers.

**`getAll(userId?, schemaNamespace = "GLOBAL")`**
```ts
const namespaces = [schemaNamespace];
if (userId) namespaces.push(this.userNamespace(userId));
```

**`getDefinitionBySlug(slug, userId?, schemaNamespace = "GLOBAL")`**
- `USER:<userId>` check stays first (priority for personal overrides)
- Fallback changes from hardcoded `"GLOBAL"` to `schemaNamespace`

**`resolveSlugToDefinitionId`, `isKnownSlug`, `findSimilarSlugs`, `getAllSlugs`, `getAllCategories`, `getSlugsByCategory`**
- All delegate internally to `getAll()` or `getDefinitionBySlug()`
- Add `schemaNamespace = "GLOBAL"` param and pass through

**`getByScope(scope, userId, schemaNamespace = "GLOBAL")`**
- Replace hardcoded `"GLOBAL"` push with `schemaNamespace`

All existing callers that don't pass `schemaNamespace` keep identical behavior (default = `"GLOBAL"`).

**Verify:**
```bash
pnpm --filter backend test:unit
pnpm --filter backend test:integration
# All pass — default "GLOBAL" means zero behavior change for existing callers
```

---

## Checkpoint 3 — Thread `schemaNamespace` through service and resolvers

**`preference.service.ts`**

`resolveAndValidateSlug(slug, userId?, schemaNamespace = "GLOBAL")`:
- Pass both `userId` and `schemaNamespace` to `defRepo.resolveSlugToDefinitionId` and `defRepo.findSimilarSlugs`

`setPreference(userId, input, schemaNamespace = "GLOBAL")` and `suggestPreference(...)`:
- Pass `schemaNamespace` to `resolveAndValidateSlug`

**`preference.resolver.ts`** (the preference write resolver):
- Pass `user.schemaNamespace` to `preferenceService.setPreference` and `suggestPreference`

**`preference-definition.resolver.ts`**:
- `getCatalog`: `this.defRepo.getAll(user?.userId, user?.schemaNamespace ?? "GLOBAL")`
- `exportPreferenceSchema`: `this.defRepo.getByScope(scope, user.userId, user.schemaNamespace)`

**Verify:**
```bash
pnpm --filter backend test:unit
pnpm --filter backend test:e2e
# All pass — GLOBAL users still hit GLOBAL, nothing regresses
```

---

## Checkpoint 4 — Seed health + education definitions

Add to `seed.ts`:

**`seedHealthPreferenceDefinitions()`**
- `JSON.parse(readFileSync('synthetic_users/health/health_patient_field_catalog.json'))` — JSON array, 46 entries
- Upsert each as `PreferenceDefinition` with `namespace: SCHEMA_NS.HEALTH`, using catalog's pre-assigned UUID as `id`
- Downcast: `INTEGER` → `STRING`, `ARRAY_OBJECT` → `ARRAY`

**`seedEducationPreferenceDefinitions()`**
- Same pattern, `education_k16_field_catalog.json`, `namespace: SCHEMA_NS.EDUCATION`, 39 entries

Update `main()`:
```ts
await seedPreferenceDefinitions();            // GLOBAL (existing, unchanged)
await seedHealthPreferenceDefinitions();
await seedEducationPreferenceDefinitions();
```

**Verify:**
```sql
SELECT namespace, COUNT(*) FROM preference_definitions GROUP BY namespace;
-- GLOBAL: ~46, health: 46, education_k16: 39
```

---

## Checkpoint 5 — Seed health users

**`loadHealthPatients()`** — `JSON.parse(readFileSync(...))` returns array of 10 patients

**`seedHealthUsers(): Promise<User[]>`**
1. Build `slug → definitionId` map from `health` namespace definitions (same `defIdBySlug` pattern as existing code)
2. For each patient:
   - Email: `slugifyName(profile.identification.name) + "@health.workshop.dev"`
     - `slugifyName`: lowercase, replace spaces with `_`, strip non-alphanumeric, append `_${index}` if seen before
   - firstName/lastName: split `identification.name` on first space
   - Upsert `User`:
     ```ts
     upsert({ where: { email }, create: { ...fields, schemaNamespace: SCHEMA_NS.HEALTH }, update: { ...fields, schemaNamespace: SCHEMA_NS.HEALTH } })
     ```
   - Upsert showcase preferences via `HEALTH_PATH_MAPPINGS` (~12 explicit extractors)

**`HEALTH_PATH_MAPPINGS`** (~12 entries, same pattern as existing `PREFERENCE_MAPPINGS`):
```ts
{ slug: 'identification.name',   extract: (p) => p.profile.identification.name,   confidence: () => 1.0 },
{ slug: 'identification.age',    extract: (p) => String(p.profile.identification.age), confidence: () => 1.0 },
{ slug: 'profile.baseline_summary', extract: (p) => p.profile.baseline_summary, confidence: () => 0.9 },
// ... ~9 more
```

**Verify:**
```sql
SELECT COUNT(*) FROM users WHERE schema_namespace = 'health'; -- Expected: 10
SELECT COUNT(*) FROM preferences p
JOIN preference_definitions pd ON p.definition_id = pd.id
WHERE pd.namespace = 'health'; -- Expected: ~120 (10 users × 12 fields)
```

---

## Checkpoint 6 — Seed education users

**`loadEducationStudents()`** — `JSON.parse(readFileSync(...))`, 11 students

**`seedEducationUsers(): Promise<User[]>`**
- Name: `student_profile.preferred_name`
- Email: `{slugified_name}@education.workshop.dev`
- **Deterministic collision fix:** always use `{slugified_name}_{index}` — derived from row index in the JSON array, not a runtime Set. Sofia at index 6 → `sofia_6@...`, Sofia at index 8 → `sofia_8@...`.
- Upsert `User` with `schemaNamespace: SCHEMA_NS.EDUCATION` on both create and update
- `EDUCATION_PATH_MAPPINGS` (~12 entries):
  ```ts
  { slug: 'profile.preferred_name', extract: (s) => s.student_profile.preferred_name, ... },
  { slug: 'demographics.age',       extract: (s) => String(s.student_profile.age), ... },
  { slug: 'education.current_level',extract: (s) => s.student_profile.current_level, ... },
  // ...
  ```

**Verify:**
```sql
SELECT COUNT(*) FROM users WHERE schema_namespace = 'education_k16'; -- Expected: 11
```

---

## Checkpoint 7 — Create workshop API keys

Fresh creation (DB is reset, no idempotency needed):
```ts
async function createWorkshopGroups(
  usermemUsers: User[], healthUsers: User[], eduUsers: User[]
) {
  const CATEGORIES = [
    { key: 'usermem',   users: usermemUsers },
    { key: 'health',    users: healthUsers  },
    { key: 'education', users: eduUsers     },
  ];
  for (const grp of ['a', 'b']) {
    for (const cat of CATEGORIES) {
      const groupName = `grp-${grp}-${cat.key}`;
      const apiKey = generateApiKey(`grp-${grp}-${cat.key}`);
      const record = await prisma.apiKey.create({
        data: { keyHash: hashKey(apiKey), groupName }
      });
      for (const user of cat.users) {
        await prisma.apiKeyUser.create({ data: { apiKeyId: record.id, userId: user.userId } });
      }
      // print plaintext key to stdout clearly
    }
  }
}
```

Update `main()`:
```ts
const usermemUsers = await seedSyntheticUsers();
const healthUsers  = await seedHealthUsers();
const eduUsers     = await seedEducationUsers();
await createWorkshopGroups(usermemUsers, healthUsers, eduUsers);
```

**Verify:**
```sql
SELECT ak.group_name, COUNT(aku.user_id) AS user_count
FROM api_keys ak JOIN api_key_users aku ON ak.id = aku.api_key_id
GROUP BY ak.group_name ORDER BY ak.group_name;
-- grp-a-education: 11, grp-a-health: 10, grp-a-usermem: 20
-- grp-b-education: 11, grp-b-health: 10, grp-b-usermem: 20
```

---

## Checkpoint 8 — Minimal tests (3 required)

Add to `test/e2e/` or `test/integration/`:

1. **Health user sees only health defs** — query `preferenceCatalog` as a health user; assert all returned slugs are from `health` namespace (none from GLOBAL or education_k16)
2. **Education user sees only education defs** — same pattern for education_k16
3. **Health key cannot access usermem user** — assert 401 when health API key + usermem userId
4. **Regression: usermem user still sees GLOBAL** — assert existing GLOBAL behavior unchanged

---

## Checkpoint 9 — End-to-end smoke test

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
  -d '{"query":"{ user(id: \"<usermem-user-id>\") { userId } }"}'
# Assert: 401 Unauthorized
```

---

## Out of Scope (deferred)

- Test file updates for `test-db.ts` and `seed.spec.ts` — follow-up PR
- `ARRAY_OBJECT` proper type support — skip in seeded *preferences*, keep in *catalog*
- MCP discovery for health/education namespaces
- Frontend category/namespace badge in UI (good idea for workshop UX, not blocking)
- Full 85-field mapping — curated 12-field showcase is sufficient

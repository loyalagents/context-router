# Plan: Move Preference Catalog from Code to Database

## Context

The preference system currently defines all valid slugs in a hardcoded TypeScript object (`PREFERENCE_CATALOG` in `preferences.catalog.ts`). Adding a new preference type requires a code change and redeploy. We want to move these definitions to a database table so that:
- New preference types can be registered at runtime (future extensibility)
- GraphQL consumers can discover available preferences via a `preferenceCatalog` query
- An `is_core` boolean distinguishes built-in preferences from future custom ones
- Category is derived from the slug prefix (`slug.split('.')[0]`) — no category column
- The DB enforces valid slugs via a foreign key from `user_preferences.slug` to `preference_definitions.slug`

## Design Decisions

- **FK constraint on slug**: `user_preferences.slug` references `preference_definitions.slug`. Prevents unknown slugs from any code path. Migration uses a 3-step approach: create table → seed data → add FK (preserves existing valid data).
- **Enums for valueType and scope**: Stored as Prisma enums (`STRING | BOOLEAN | ENUM | ARRAY` and `GLOBAL | LOCATION`) instead of freeform strings to catch typos at the DB level. Exposed to GraphQL via `registerEnumType` so consumers get type-safe values through introspection.
- **Validation in a separate file**: Pure validation functions (`validateSlugFormat`, `validateValue`, `enforceScope`, `validateConfidence`) live in their own file, not in the repository. Repository does data access only.
- **No soft delete / isActive**: Not needed yet. When a deletion flow exists, we'll know the right shape for it. Adding a column + default is trivial later.
- **No category column**: Derived from `slug.split('.')[0]` in code. Avoids sync risk. Tradeoff: renaming a category (e.g., "health" → "wellness") requires rewriting slug PKs and cascading FK updates. Acceptable since top-level domains are stable.
- **Source of truth**: Code (`preferences.catalog.ts`) is the source of truth for core definitions. `prisma db seed` upserts core definitions on deploy, meaning manual DB edits to core definitions get overwritten. Runtime-added definitions (non-core) are not in the seed file and survive deploys.
- **Slug count**: There are 12 slugs in the current catalog.
- **Existing unique constraints are sufficient**: The current schema already has a partial unique index for global preferences (`WHERE location_id IS NULL`) alongside the standard unique constraint, which correctly handles Postgres NULL semantics.

## Repo Structure: Before & After

```
apps/backend/
  prisma/
    schema.prisma                              # + PreferenceDefinition model, FK on Preference
    seed.ts                                    # + seed preference definitions
    migrations/
      YYYYMMDDHHMMSS_add_preference_definitions/  # NEW
  src/
    config/
      preferences.catalog.ts                   # KEPT (seed data source only)
    modules/preferences/
      preference-definition/                   # NEW module
        preference-definition.module.ts
        preference-definition.repository.ts
        preference-definition.resolver.ts
        models/
          preference-definition.model.ts
      preference/
        preference.module.ts                   # MODIFIED (import PreferenceDefinitionModule)
        preference.repository.ts               # MODIFIED (inject defRepo)
        preference.service.ts                  # MODIFIED (inject defRepo + validation import)
        preference.validation.ts               # NEW (pure validation functions moved here)
      document-analysis/
        document-analysis.module.ts            # MODIFIED (import PreferenceDefinitionModule)
        preference-extraction.service.ts       # MODIFIED (inject defRepo + validation import)
      preferences.module.ts                    # MODIFIED (import PreferenceDefinitionModule)
    mcp/
      mcp.module.ts                            # unchanged (already imports PreferencesModule)
      tools/
        preference-list.tool.ts                # MODIFIED (inject defRepo)
        preference-mutation.tool.ts            # MODIFIED (inject defRepo + validation import)
        preference-search.tool.ts              # MODIFIED (inject defRepo)
  test/
    setup/
      test-db.ts                               # MODIFIED (add seedDefinitions helper)
      jest.after-env.ts                        # MODIFIED (call seedDefinitions)
    integration/
      preference-definition.repository.spec.ts # NEW
      preference.repository.spec.ts            # MODIFIED (construct with defRepo)
```

## Implementation Steps

### Step 1: Prisma model + migration

Add enums and the `PreferenceDefinition` model to `apps/backend/prisma/schema.prisma`. Add FK relation from `Preference.slug` to `PreferenceDefinition.slug`:

```prisma
enum PreferenceValueType {
  STRING
  BOOLEAN
  ENUM
  ARRAY
}

enum PreferenceScope {
  GLOBAL
  LOCATION
}

model PreferenceDefinition {
  slug        String              @id
  description String
  valueType   PreferenceValueType @map("value_type")
  scope       PreferenceScope
  options     Json?
  isSensitive Boolean             @default(false) @map("is_sensitive")
  isCore      Boolean             @default(false) @map("is_core")
  createdAt   DateTime            @default(now()) @map("created_at")
  updatedAt   DateTime            @updatedAt @map("updated_at")

  preferences Preference[]

  @@map("preference_definitions")
}
```

Update the existing `Preference` model to add the relation:

```prisma
model Preference {
  // ... existing fields unchanged ...
  slug        String
  definition  PreferenceDefinition @relation(fields: [slug], references: [slug])
  // ... rest unchanged ...
}
```

The migration should follow a 3-step approach to preserve existing valid data:
1. Create the `preference_definitions` table
2. Seed the 12 core definitions into the table
3. Add the FK constraint from `user_preferences.slug` to `preference_definitions.slug`

This ensures existing preferences with valid slugs survive the migration untouched. If any rows have unknown slugs, they can be cleaned up between steps 2 and 3.

Run: `cd apps/backend && npx prisma migrate dev --name add_preference_definitions`

### Step 2: Update seed file

Modify `apps/backend/prisma/seed.ts` to seed all 12 current catalog entries with `isCore: true`, using `PREFERENCE_CATALOG` from `preferences.catalog.ts` as the data source. Map the string values (`'string'`, `'global'`) to the new enum values (`STRING`, `GLOBAL`).

### Step 3: Update test infrastructure

**`test/setup/test-db.ts`**: Add a `seedPreferenceDefinitions()` function that inserts all catalog entries via `prisma.preferenceDefinition.upsert()`. Because of the FK, definitions must be seeded before any preference test data.

**`test/setup/jest.after-env.ts`**: Call `seedPreferenceDefinitions()` after `resetDb()` in the global `beforeEach`.

### Step 4: Create preference.validation.ts

**New file:** `src/modules/preferences/preference/preference.validation.ts`

Move the pure validation functions from `preferences.catalog.ts` into this file:
- `validateSlugFormat(slug)` — regex check
- `validateValue(def, value)` — type checking against definition
- `enforceScope(def, locationId)` — scope enforcement
- `validateConfidence(confidence)` — range check

These functions don't depend on DB state — they take a definition object and validate against it. Update the type signatures to accept the new enum types.

### Step 5: Create PreferenceDefinitionRepository

**New file:** `src/modules/preferences/preference-definition/preference-definition.repository.ts`

- Loads all definitions into an in-memory `Map<string, PreferenceDefinitionData>` on module init via `OnModuleInit`
- Provides query methods only: `isKnownSlug()`, `getDefinition()`, `getAllSlugs()`, `getSlugsByCategory()`, `getAllCategories()`, `findSimilarSlugs()`, `getAll()`
- Derives `category` from `slug.split('.')[0]` at load time
- Provides `refreshCache()` for future runtime updates
- Does NOT contain validation logic (that lives in `preference.validation.ts`)

### Step 6: Create PreferenceDefinition GraphQL model + resolver

**New file:** `src/modules/preferences/preference-definition/models/preference-definition.model.ts`
- Fields: slug, description, valueType, scope, options, isSensitive, isCore, category
- Register `PreferenceValueType` and `PreferenceScope` enums with `registerEnumType` so GraphQL introspection exposes the exact allowed values (not generic strings)

**New file:** `src/modules/preferences/preference-definition/preference-definition.resolver.ts`
- Query: `preferenceCatalog(category?: String): [PreferenceDefinition]`
- No auth guard (catalog is public metadata, matching MCP's listPreferenceSlugs)

### Step 7: Create PreferenceDefinitionModule

**New file:** `src/modules/preferences/preference-definition/preference-definition.module.ts`
- Imports: PrismaModule
- Providers: PreferenceDefinitionRepository, PreferenceDefinitionResolver
- Exports: PreferenceDefinitionRepository

### Step 8: Update module imports

- `preference.module.ts` — add `PreferenceDefinitionModule` to imports
- `preferences.module.ts` — add `PreferenceDefinitionModule` to imports and exports
- `document-analysis.module.ts` — add `PreferenceDefinitionModule` to imports

`mcp.module.ts` already imports `PreferencesModule`, which will export `PreferenceDefinitionModule`, so no change needed there.

### Step 9: Update consumers

All 6 files that currently import from `@config/preferences.catalog` switch to:
- Injecting `PreferenceDefinitionRepository` for lookups
- Importing from `preference.validation.ts` for validation functions

| File | Changes |
|------|---------|
| `preference.service.ts` | Inject defRepo for lookups, import validation functions from `preference.validation.ts` |
| `preference.repository.ts` | Inject defRepo, replace `getDefinition()` in `enrichWithCatalog()` |
| `preference-list.tool.ts` | Inject defRepo, replace all catalog imports |
| `preference-mutation.tool.ts` | Inject defRepo for lookups, import validation from `preference.validation.ts` |
| `preference-search.tool.ts` | Inject defRepo, replace all catalog imports |
| `preference-extraction.service.ts` | Inject defRepo, replace `PREFERENCE_CATALOG`, `getAllSlugs`, `getDefinition`, `isKnownSlug` |

### Step 10: Update tests

**`test/integration/preference.repository.spec.ts`**: Update `PreferenceRepository` construction to pass `defRepo` as second argument. Create `PreferenceDefinitionRepository` in `beforeAll` and call `refreshCache()`.

**New: `test/integration/preference-definition.repository.spec.ts`**: Test cache loading, `isKnownSlug`, `getDefinition`, `getAllSlugs`, `getSlugsByCategory`, `getAllCategories`, `findSimilarSlugs`, `isCore` flag, category derivation.

**`document-analysis/preference-extraction.service.spec.ts`**: Add mock `PreferenceDefinitionRepository` to test providers.

### Step 11: Clean up preferences.catalog.ts

Keep the file as **seed data source only**:
1. `PREFERENCE_CATALOG` object — used by `prisma/seed.ts` and `test/setup/test-db.ts`
2. `PreferenceDefinition` interface — used for typing the catalog object

Remove or mark as `@deprecated` all query and validation functions (they now live in the repository and `preference.validation.ts` respectively).

## Key Files

| File | Role |
|------|------|
| `apps/backend/prisma/schema.prisma` | Add PreferenceDefinition model + FK + enums |
| `apps/backend/src/config/preferences.catalog.ts` | Retained as seed data source only |
| `apps/backend/src/modules/preferences/preference/preference.validation.ts` | NEW: pure validation functions |
| `apps/backend/src/modules/preferences/preference/preference.service.ts` | Heaviest consumer (7 imports to replace) |
| `apps/backend/src/modules/preferences/preference/preference.repository.ts` | enrichWithCatalog uses getDefinition |
| `apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.ts` | Uses catalog for AI prompt building |
| `apps/backend/src/mcp/tools/preference-list.tool.ts` | Primary catalog discovery tool |
| `apps/backend/test/setup/test-db.ts` | Must seed definitions after TRUNCATE (before any preference data due to FK) |

## Verification

1. **Run integration tests**: `cd apps/backend && npx jest test/integration/preference-definition.repository.spec.ts`
2. **Run preference integration tests**: `cd apps/backend && npx jest test/integration/preference.repository.spec.ts`
3. **Run E2E tests**: `cd apps/backend && npx jest test/e2e/preferences.e2e-spec.ts`
4. **Run all tests**: `cd apps/backend && npx jest`
5. **Manual: test GraphQL catalog query**:
   ```graphql
   query { preferenceCatalog { slug description valueType scope isCore category } }
   query { preferenceCatalog(category: "food") { slug description } }
   ```
6. **Verify seed**: `cd apps/backend && npx prisma db seed` — confirm 12 definitions created
7. **Verify FK enforcement**: Try inserting a preference with an unknown slug directly in DB — should fail

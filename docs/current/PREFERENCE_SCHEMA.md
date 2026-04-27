# Preference Schema

- Status: current
- Read when: changing preference definitions, schema export, MCP schema tools, or document-analysis prompt inputs
- Source of truth: `apps/backend/prisma/schema.prisma`, `apps/backend/src/modules/preferences/preference-definition/**`, `apps/backend/src/modules/preferences/preference/**`, `apps/backend/test/e2e/preference-catalog.e2e-spec.ts`, `apps/backend/test/e2e/preference-definition-mutations.e2e-spec.ts`
- Last reviewed: 2026-04-22

## Definitions Model

Preference definitions live in the database, not only in static code. Core definitions are still seeded from `src/config/preferences.catalog.ts`, but runtime behavior is driven by the `preference_definitions` table and the repository and service layer around it.

Important fields:

- `namespace`: `GLOBAL` or `USER:<userId>`
- `slug`: canonical identifier
- `displayName`
- `description`
- `valueType`
- `scope`
- `options`
- `isSensitive`
- `isCore`
- `ownerUserId`
- `archivedAt`

Category is derived from the slug prefix rather than stored separately.

## Current Behavior

- `preferenceCatalog` returns global definitions plus the authenticated user's active definitions.
- `exportPreferenceSchema` exports global, personal, or combined schema views.
- GraphQL supports create, update, and archive operations for user-owned definitions.
- MCP supports creating, updating, and archiving user-owned definitions via `mutatePreferences`.
- User-owned definitions cannot reuse a live global slug or the same user's live slug.
- Archiving a user-owned definition frees that slug for future reuse by the same user.

## Consumers

The schema layer feeds multiple systems:

- preference validation and enrichment
- GraphQL catalog queries
- MCP tools such as `listPreferenceSlugs` and `mutatePreferences`
- `PreferenceSchemaSnapshotService` for prompt-building and filtering
- workflow inputs for `smartSearchPreferences` and `consolidateSchema`

`PreferenceSchemaSnapshotService` can produce grant-filtered snapshots, so prompt construction respects permission grants before AI sees candidate slugs.

## Preferences and Suggestions

The definitions layer is separate from concrete user preference rows:

- definitions describe what can exist
- preference rows store active or suggested values for a user
- document analysis generates suggestions, not direct active writes

## Known Constraints

- Grants are currently slug-based, so namespace is not part of grant matching.
- Core definitions still originate from the seed catalog, so long-lived built-in schema changes still flow through code and migrations.

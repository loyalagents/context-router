# Preference Schema

- Status: current
- Read when: changing preference definitions, schema export, MCP schema tools, or document-analysis prompt inputs
- Source of truth: `apps/backend/prisma/schema.prisma`,
  `apps/backend/src/config/preferences.catalog.json`,
  `apps/backend/src/modules/preferences/preference-definition/**`,
  `apps/backend/src/modules/preferences/preference/**`,
  `apps/backend/src/modules/auth/auth.service.ts`,
  `apps/backend/test/e2e/preference-catalog.e2e-spec.ts`, and
  `apps/backend/test/e2e/profile-preferences.e2e-spec.ts`
- Last reviewed: 2026-09-14

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

`PreferenceSchemaSnapshotService` accepts a caller-supplied slug filter and can
produce grant-filtered snapshots. MCP workflows supply the client-grant filter
before AI sees candidate slugs; this is caller-dependent, and first-party
GraphQL smart search currently supplies a pass-through filter.

## Preferences and Suggestions

The definitions layer is separate from concrete user preference rows:

- definitions describe what can exist
- preference rows store active or suggested values for a user
- document analysis generates suggestions, not direct active writes

## Profile Memory

Editable profile data uses seven global core preference definitions:

- `profile.full_name`
- `profile.first_name`
- `profile.last_name`
- `profile.email`, marked sensitive
- `profile.badge_name`
- `profile.company`
- `profile.title`

Account identity remains on `User` as `userId`, login email, and timestamps.
`profile.email` is editable contact and form-fill memory and can differ from the
account email used for login.

The profile page reads and writes these values through the ordinary active-
preference APIs. It requires full name and contact email in its UI, but the
backend schema does not guarantee that either preference row exists. Clearing
an optional profile field deletes its preference row.

There is no profile-specific MCP API. Generic MCP preference tools expose these
slugs, and the ordinary static policy and database grant layers can allow or
deny them, including by exact slug. Reset operations treat `profile.*` rows as
ordinary preferences while preserving `User` and `ExternalIdentity`.

Schema consolidation rejects any proposed group that contains a `profile.*`
slug, protecting the built-in profile definitions from merge/delete advice.
Auth sync makes a best-effort seed of full name, first name, last name, and
contact email for a newly created user when those values and definitions are
available. Those rows use imported provenance with `auth_sync` evidence. This
direct seed has no domain audit event, and failure does not block login.

## Known Constraints

- Grants are currently slug-based, so namespace is not part of grant matching.
- Core definitions still originate from the seed catalog, so long-lived built-in schema changes still flow through code and migrations.

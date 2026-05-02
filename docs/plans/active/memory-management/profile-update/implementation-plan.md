# Profile Slugs As First-Class Memory

## Summary

Implement the full unification: account identity remains on `User`; user-editable profile data becomes normal `profile.*` memory. No new MCP profile resource/tool. Existing MCP preference tools become the profile surface. This intentionally breaks old profile GraphQL/web APIs while migrating existing name/email values into preference rows.

## Key Changes

- Add core GLOBAL profile definitions:
  - `profile.full_name`, `profile.first_name`, `profile.last_name`, `profile.email`, `profile.badge_name`, `profile.company`, `profile.title`
  - all `STRING`, `GLOBAL`, `isCore: true`
  - only `profile.email` is `isSensitive: true`
  - extend catalog/seed and `listPreferenceSlugs` output to include `displayName`.
- Add one migration unit that:
  - inserts matching profile definitions for existing deployments
  - backfills ACTIVE profile rows from current users
  - drops `users.first_name` and `users.last_name`
  - verifies transaction behavior with Prisma migrate/deploy; only add explicit SQL transaction wrapping if compatible.
- Backfill semantics:
  - `context_key = 'GLOBAL'`, `location_id = NULL`, `status = 'ACTIVE'`
  - `source_type = 'IMPORTED'`, `confidence = NULL`
  - `evidence = { "source": "profile_column_migration" }`
  - create `profile.full_name` from trimmed first + last when non-empty
  - create `profile.first_name`, `profile.last_name`, and `profile.email` only when non-empty.
- Collapse `User` to account identity:
  - keep `userId`, account `email`, timestamps, and relations
  - remove `firstName` / `lastName` from Prisma, GraphQL `User`, MCP context, tests, and local model types
  - remove GraphQL `updateUser` and web `/api/profile/update`.
- Treat `profile.email` as editable contact/form-fill memory that may differ from account email.
- Make `profile.full_name` explicit memory:
  - profile UI has its own Full Name field
  - auth seeding/backfill may initialize it
  - no hidden synchronization between name fields.
- Update `/dashboard/profile` to use preference APIs:
  - fields: full name, first name, last name, contact email, badge name, company, title
  - full name and contact email required; the rest optional
  - missing profile rows render as blank editable fields
  - save through `setPreference`
  - clearing optional fields deletes existing rows.
- MCP behavior:
  - `profile.*` is discovered/read/written through existing slug tools
  - grants can control `profile.*` or exact slugs
  - add coverage that `searchPreferences({ query: "profile" })` returns profile rows.
- Reset behavior:
  - all reset modes delete `profile.*` rows because they are normal preferences
  - `User` and `ExternalIdentity` survive full reset.
- Schema consolidation:
  - ensure `consolidateSchema` does not recommend merging, archiving, or replacing core `profile.*` definitions.
- Demo fixtures:
  - remove `examples/memory-demo/users/*/profile.json` from the demo contract
  - move profile data into each user's `simple/seed-preferences.json` as `profile.*` rows
  - change form manifests from `source: "profile"` / `profilePath` to `source: "mcp-memory"` / `memorySlugs`
  - update scenario prompts, expected outputs, templates, README, schemas, and verifier so demos no longer require or read `profile.json`.

## Checkpoints

1. Planning docs:
   - create requested docs tree
   - write this plan to `profile-update/implementation-plan.md`
   - create `memory-management/TODO.md`.
2. Backend tests first:
   - cover catalog metadata, migration/backfill, removed `User` fields, profile preference CRUD, MCP profile search, grants, reset, and schema consolidation behavior.
3. Backend implementation:
   - update Prisma schema/migration, generated client, catalog, user/auth types, GraphQL schema, MCP context/tools, and tests.
4. Web implementation:
   - replace old profile route/form flow with preference-backed profile reads/writes
   - update dashboard and reset copy.
5. Demo fixture cleanup:
   - remove `profile.json` contract
   - update fixtures/templates/schemas/verifier/docs
   - run `pnpm demo:memory:verify`.
6. Closure docs:
   - write implementation summary with shipped behavior and commands run
   - update TODO with remaining follow-ups.

## Test Plan

- Backend:
  - profile definitions seed with exact metadata and `displayName`
  - migration backfills profile rows using `contextKey = 'GLOBAL'`
  - `User` GraphQL no longer exposes `firstName` / `lastName`
  - `updateUser` no longer exists
  - `setPreference`, `searchPreferences`, `smartSearchPreferences`, MCP reads, and MCP writes work for `profile.*`
  - `searchPreferences({ query: "profile" })` returns seeded profile preferences
  - grants can deny `profile.email` while allowing other profile slugs
  - reset deletes profile preference rows
  - auth sync seeds profile preferences for new users without blocking login
  - `consolidateSchema` protects core `profile.*` definitions.
- Web:
  - profile page loads existing `profile.*` values
  - empty profile memory shows blank editable fields
  - save creates/updates required and optional rows
  - clearing optional fields deletes those rows
  - dashboard separates account email from contact/profile memory.
- Demo:
  - verifier passes without `profile.json`
  - field manifests use `profile.*` memory slugs for former profile fields
  - expected filled forms still match existing user values.
- Verification commands:
  - `pnpm --filter backend prisma:generate`
  - targeted backend Jest suites for user, catalog, preferences, MCP, reset, auth sync, schema consolidation
  - `pnpm --filter backend build`
  - `pnpm --filter web build`
  - `pnpm demo:memory:verify`

## Assumptions

- Breaking API compatibility is acceptable.
- Catalog is authoritative going forward; migration duplicates a matching snapshot for existing deployments, and tests verify alignment.
- Full name is explicit profile memory, not hidden derived state.
- Only contact email is marked sensitive in v1.
- No new MCP profile resource/tool is added; `profile.*` slugs are the public MCP surface.
- Demo scenarios should exercise MCP profile memory, not local profile JSON.

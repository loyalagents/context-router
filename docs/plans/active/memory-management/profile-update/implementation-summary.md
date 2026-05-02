# Profile Slugs As First-Class Memory - Implementation Summary

## Shipped Behavior

- Account identity now stays on `User` as `userId`, account `email`, and timestamps.
- User-editable profile data now lives in core `profile.*` preferences:
  - `profile.full_name`
  - `profile.first_name`
  - `profile.last_name`
  - `profile.email`
  - `profile.badge_name`
  - `profile.company`
  - `profile.title`
- `profile.email` is editable contact/form-fill memory and can differ from account email.
- `profile.full_name` is explicit memory; it is initialized by migration/auth seeding when available but is not hidden derived state.
- MCP profile access uses existing preference tools only. No profile-specific MCP resource or tool was added.
- `listPreferenceSlugs` now includes `displayName`.
- Grants apply to `profile.*` and exact profile slugs through the normal permission system.
- Reset modes delete `profile.*` rows as normal preferences while preserving `User` and `ExternalIdentity`.
- Schema consolidation filters out protected `profile.*` definitions.

## Backend Changes

- Added migration `20260502120000_profile_slugs_memory` to insert profile definitions, backfill active global profile preference rows from existing users, and drop `users.first_name` / `users.last_name`.
- Added follow-up migration `20260502130000_collapse_users_account_identity` to reconcile legacy user-table columns from older migration paths with the collapsed account-identity model.
- Removed profile names from Prisma `User`, GraphQL `User`, MCP context, local model types, seeds, and tests.
- Removed the legacy GraphQL `updateUser` mutation.
- Updated auth sync to seed initial `profile.full_name`, `profile.first_name`, `profile.last_name`, and `profile.email` preferences for newly created users without blocking login if seeding fails.
- Added/updated tests for catalog metadata, migration SQL semantics, removed GraphQL fields, MCP profile search/write, grants, reset, auth seeding, and schema consolidation.

## Web Changes

- Removed `apps/web/app/api/profile/update`.
- Reworked `/dashboard/profile` to read active `profile.*` preferences and save through `setPreference`.
- Required fields: full name and contact email.
- Optional fields: first name, last name, badge name, company, title.
- Clearing optional fields deletes the existing preference row.
- Dashboard now separates account email from contact/profile memory.
- Reset copy now describes profile fields as memory that reset operations can clear.

## Demo Changes

- Removed `examples/memory-demo/users/*/profile.json` and the user template `profile.json`.
- Moved profile fixture data into each user's `simple/seed-preferences.json` as `profile.*` rows.
- Replaced form manifest `source: "profile"` / `profilePath` with `source: "mcp-memory"` / `memorySlugs`.
- Updated scenario prompts, expected final preferences, templates, README, schemas, and verifier so demos no longer require or read `profile.json`.

## Verification

- `pnpm install --frozen-lockfile`
- `pnpm --filter backend prisma:generate`
- `pnpm --filter backend test:db:up`
- `pnpm --filter backend test:db:migrate`
- `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --runInBand`
- `pnpm --filter backend build`
- `pnpm --filter web build`
- `pnpm demo:memory:verify`

Notes:

- Prisma migrate deploy applied the profile migration successfully in the test database without explicit SQL transaction wrapping.
- After merging `origin/main`, targeted profile/search/user-identity tests were rerun along with backend build, web build, and the memory demo verifier.
- `pnpm --filter web build` passes; the post-merge run only emitted stale browser-data warnings.

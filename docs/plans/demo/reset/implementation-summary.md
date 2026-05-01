# Demo Memory Reset Implementation Summary

- Status: implemented
- Date: 2026-05-01

## What Changed

- Added a current-user-only GraphQL reset mutation:
  - `resetMyMemory(mode: ResetMemoryMode!): ResetMyMemoryPayload!`
  - Modes: `MEMORY_ONLY`, `DEMO_DATA`, `FULL_USER_DATA`
  - Payload returns delete counts for preferences, definitions, locations, audit events, MCP access events, and permission grants.
- Added a dedicated backend reset module under `apps/backend/src/modules/reset/`.
  - The reset service uses one Prisma transaction.
  - It deletes preference rows before user-owned definitions to respect the restrictive preference-definition FK.
  - It rejects advanced resets if a user-owned definition is still referenced by another user's preference.
  - `DEMO_DATA` and `FULL_USER_DATA` require `ENABLE_DEMO_RESET=true`.
- Added a Preferences-page reset panel.
  - The default UI shows "Reset Preferences".
  - The demo/full reset buttons only render when the web server has `ENABLE_DEMO_RESET=true`.
  - Successful reset shows returned counts briefly, then reloads the page.
- Added `ENABLE_DEMO_RESET=false` to backend and web example env files.
- Updated the generated backend GraphQL schema.

## Important Tradeoffs

- `DEMO_DATA` and `FULL_USER_DATA` intentionally delete the user's preference audit history and MCP access logs. This is acceptable for demo/testing cleanup, but it removes investigation history for that user.
- `FULL_USER_DATA` preserves `User` and `ExternalIdentity` rows so the active Auth0 login remains usable.
- No reset-specific audit event type was added in this version.

## Verification

- `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/reset.e2e-spec.ts`
- `pnpm --filter backend build`
- `pnpm --filter web build`

The web build passed with existing Auth0 environment warnings and the existing Auth0 Edge-runtime warning.

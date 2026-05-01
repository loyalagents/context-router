# Demo Memory Reset Plan

## Summary

Implement a current-user-only reset feature with a Preferences-page UI and three reset modes.

Modes:

- `MEMORY_ONLY`: delete all current user's preference rows across `ACTIVE`, `SUGGESTED`, and `REJECTED`.
- `DEMO_DATA`: delete current user's preferences, locations, user-owned preference definitions, preference audit rows, and MCP access logs. Preserve profile, Auth0 identity, and permission grants.
- `FULL_USER_DATA`: delete everything from `DEMO_DATA` plus current user's permission grants. Preserve `User` and `ExternalIdentity` rows so the active session keeps working.

## Key Changes

- Add a dedicated backend reset module under `apps/backend/src/modules/reset/`.
  - Import `PrismaModule` and use `PrismaService` directly because reset is cross-cutting.
  - Add `ResetResolver` guarded by `GqlAuthGuard`.
  - Add `UserDataResetService` to perform the transaction.
- Add GraphQL API:
  - `resetMyMemory(mode: ResetMemoryMode!): ResetMyMemoryPayload!`
  - `ResetMemoryMode = MEMORY_ONLY | DEMO_DATA | FULL_USER_DATA`
  - Payload fields: `mode`, `preferencesDeleted`, `preferenceDefinitionsDeleted`, `locationsDeleted`, `preferenceAuditEventsDeleted`, `mcpAccessEventsDeleted`, `permissionGrantsDeleted`.
  - Resolver must never accept a `userId`; it always uses `@CurrentUser()`.
- Gate `DEMO_DATA` and `FULL_USER_DATA` with backend `ENABLE_DEMO_RESET=true`.
  - Check with `ConfigService.get()` at execution time.
  - Document that changing `.env` still requires restarting the running process.
  - Add the flag to `apps/backend/.env.example` and `apps/web/.env.example`, defaulted to false/commented.
- Implement deletion order inside one Prisma transaction:
  - Delete `Preference` rows for the current user first.
  - Delete `PreferenceAuditEvent` rows for the current user.
  - Delete `McpAccessEvent` rows for the current user.
  - For `DEMO_DATA` and `FULL_USER_DATA`, preflight user-owned definitions with `namespace = USER:<userId>`.
  - If any user-owned definition is still referenced by another user's preference row after current-user preferences are deleted, throw a clear error and roll back.
  - Delete current user's user-owned `PreferenceDefinition` rows.
  - Delete current user's `Location` rows.
  - For `FULL_USER_DATA`, delete current user's `PermissionGrant` rows.
- Add UI on `/dashboard/preferences`.
  - Create a `MemoryResetPanel` component.
  - User-facing labels: "Reset Preferences", "Reset Demo Data", and "Full User Data Reset".
  - Show only "Reset Preferences" by default.
  - Show advanced demo/full options only when the web server sees `ENABLE_DEMO_RESET=true`.
  - Require native confirmation before submitting.
  - On success, show returned counts briefly and call `window.location.reload()`.

## Implementation Checkpoints

1. Docs checkpoint:
   - Create `docs/plans/demo/reset/`.
   - Add `implementation-plan.md`.
2. Backend test-first checkpoint:
   - Add reset e2e coverage before implementation.
   - Cover all modes, env gating, delete counts, and second-user isolation.
3. Backend implementation checkpoint:
   - Add reset module, enum, payload model, resolver, and service.
   - Register the module in `AppModule`.
   - Run targeted e2e tests and update `apps/backend/src/schema.gql`.
4. Web checkpoint:
   - Add `MemoryResetPanel` to `PreferencesClient`.
   - Pass `allowDemoReset` from the server page using `process.env.ENABLE_DEMO_RESET === 'true'`.
   - Keep the mutation call as raw `fetch`, matching existing preference components.
5. Closure docs checkpoint:
   - Add `implementation-summary.md` with behavior, changed files, and tests run.
   - Add `docs/plans/demo/TODO.md` for remaining follow-ups.

## Test Plan

- Backend e2e:
  - `MEMORY_ONLY` deletes only current user's preference rows.
  - `DEMO_DATA` deletes preferences, locations, user-owned definitions, audit rows, and MCP logs, while preserving grants/profile/login.
  - `FULL_USER_DATA` also deletes permission grants while preserving profile/login.
  - Advanced modes fail unless `ENABLE_DEMO_RESET=true`.
  - Another user's preferences, definitions, locations, grants, audit rows, and MCP logs remain unchanged.
  - Cross-user references to a current user's definition cause a clear rollback error.
- Web:
  - Build/typecheck the web app.
  - Verify the Preferences page shows only "Reset Preferences" by default.
  - With `ENABLE_DEMO_RESET=true`, verify all three reset controls appear and successful reset refreshes the page.

## Assumptions

- The reset UI belongs on the Preferences page.
- "Full user data" means all app-owned child data, not deleting `User` or `ExternalIdentity`.
- No database migration is needed.
- `DEMO_DATA` and `FULL_USER_DATA` intentionally destroy audit/MCP history for the user; this is acceptable for demo/testing and must be called out in the implementation summary.
- No reset-specific audit event type is added in v1.

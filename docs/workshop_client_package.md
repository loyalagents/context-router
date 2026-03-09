# Workshop Client Package V1

## Summary
- Build `@loyalagents/context-router-workshop-client` in `packages/workshop-client` and distribute it as a `.tgz` for the workshop.
- Keep v1 small: `users()`, `withUser()`, `catalog()`, `me()`, `activePreferences()`, `setPreference()`, and `analyzeDocument()`.
- Keep out of scope: location-scoped APIs, suggestion review/apply, delete/clear APIs, and npm publishing.
- Quick implementation context lives in [docs/package/workshop_client_context.md](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/docs/package/workshop_client_context.md).
- Canonical smoke/test commands live in [docs/package/smoke_test.md](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/docs/package/smoke_test.md).
- Locked decisions:
  - `catalog()` fetches live data on every call; no cache and no refresh API.
  - `catalog()` uses `exportPreferenceSchema(scope: ALL)` and filters client-side.
  - smoke tests run against a prestarted backend, while backend correctness stays covered by e2e tests.

## Key Behavior
- `createWorkshopClient({ baseUrl, apiKey, graphqlUrl?, uploadUrl?, fetch? })` returns a `WorkshopBaseClient`.
- `WorkshopBaseClient` exposes `users()` and `withUser(userId)`. It does not expose `catalog()`.
- `WorkshopUserClient` exposes `catalog()`, `me()`, `activePreferences()`, `setPreference()`, and `analyzeDocument()`.
- `users()` wraps `groupUsers(apiKey: String!)` and sends the API key only as a GraphQL variable.
- User-scoped methods send `Authorization: Bearer <apiKey>` and `X-User-Id: <userId>`.
- `catalog()` calls `exportPreferenceSchema(scope: ALL)` on every call, then keeps only active `GLOBAL` definitions visible to that selected user.
- `WorkshopCatalogEntry` includes `slug`, `displayName?`, `description`, `valueType`, `options?`, and `origin: "system" | "personal"`.
- `catalog()` must hide raw namespace fields from the public package API.
- `setPreference()` validates against the same live workshop-visible catalog before sending the mutation. Unknown slugs, wrong types, invalid enum values, and non-global/location-scoped defs throw `WorkshopClientError` with `kind: "config"`.
- `setPreference()` must not require the caller to have already called `catalog()`.
- `analyzeDocument()` keeps the `Blob`-first API and posts multipart data to `/api/preferences/analysis`.
- README examples and smoke scripts must choose a writable slug from the runtime catalog, not hardcode `system.response_tone`, so the flow works for non-`GLOBAL` schemas too.

## Checkpoints
- Checkpoint 0: refresh `docs/workshop_client_package.md`, add a `Workshop Client Package` section to `docs/personal-slug-planning.md`, add `packages/*` to workspace config, run `pnpm install`, run `test/e2e/export-schema-auth.e2e-spec.ts`, and log results in `docs/personal-slug-planning.md`.
- Checkpoint 1: scaffold the package, implement URL normalization, shared HTTP/error layer, `users()`, `withUser()`, and `me()`, then run package unit tests, `build:workshop-client`, and an auth smoke against a prestarted backend; record commands and results in `docs/personal-slug-planning.md`.
- Checkpoint 2: implement `catalog()`, live catalog filtering/mapping, validation helpers, `activePreferences()`, and `setPreference()`, then run package tests plus backend regressions `test/e2e/schema-namespace.e2e-spec.ts` and `test/e2e/preference-definition-mutations.e2e-spec.ts`; update `docs/personal-slug-planning.md`.
- Checkpoint 3: implement the backend document-analysis visibility fix, add package `analyzeDocument()`, pack to `dist/workshop-client/`, run tarball consumer smoke plus updated document-analysis regressions, then update `docs/personal-slug-planning.md`.

## Implementation Checklist
- [ ] Replace the old bundled-catalog design in `docs/workshop_client_package.md` with the live selected-user catalog design.
- [ ] Update `pnpm-workspace.yaml` and root `package.json` workspaces to include `packages/*`.
- [ ] Scaffold `packages/workshop-client` with `package.json`, `tsconfig.json`, `README.md`, `src/`, and `test/`.
- [ ] Configure `tsup`, `vitest`, dual package exports, Node 18+ engines, and root scripts for build/test/smoke/pack.
- [ ] Implement `WorkshopClientError`, URL normalization, request helpers, and GraphQL/REST transport.
- [ ] Implement `users()`, `withUser()`, and `me()`.
- [ ] Implement live `catalog()` using `exportPreferenceSchema(scope: ALL)` and map to workshop-facing entries.
- [ ] Implement validation helpers so `setPreference()` can validate from a fresh live catalog each call.
- [ ] Implement `activePreferences()` and `setPreference()`.
- [ ] Thread `schemaNamespace` through document-analysis code so upload analysis respects namespace and personal-definition visibility.
- [ ] Implement `analyzeDocument()`.
- [ ] Add package tests, backend regressions, prestarted-backend smoke, and tarball consumer smoke.
- [ ] Write the tarball to `dist/workshop-client/`.
- [ ] Finalize README examples for plain TypeScript, Next.js, and both `File` and generic `Blob` upload flows.
- [ ] Log every checkpoint’s commands and outcomes in `docs/personal-slug-planning.md`.

## Test Expectations
- Package coverage must include URL normalization, override precedence, request shapes, auth headers, live catalog mapping, filtering out location-scoped defs, personal-definition visibility, validation failures, multipart upload behavior, and tarball install/import smoke.
- Backend coverage must include `test/e2e/export-schema-auth.e2e-spec.ts`, `test/e2e/schema-namespace.e2e-spec.ts`, `test/e2e/preference-definition-mutations.e2e-spec.ts`, and updated document-analysis tests proving namespace and personal defs are honored.
- Smoke script inputs should be explicit env vars for backend URL and API key, and the smoke flow should pick a valid writable slug from the returned catalog deterministically.

## Assumptions
- `WorkshopUser` stays aligned with the current GraphQL `User` shape and does not expose `schemaNamespace`.
- The package stays global-only in public behavior even though its catalog source includes both system and personal definitions.
- The current worktree still needs dependency installation before tests are reliable, so `pnpm install` is part of the implementation work, not optional.

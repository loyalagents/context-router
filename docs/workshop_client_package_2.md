# Workshop Client Package Refresh And Implementation Plan

## Summary
- The three cited commits (`ddd89bd679640b9303fe21e6daea2755ce09e3c8`, `bcf2d8c088a71c7a30198a3eda65b93032ea2321`, `587ced19ee579bacb05db59c27a80d38998301c9`) are MCP-only and do not directly change the workshop client scope.
- The existing plan still needs a real update because current `HEAD` has schema-namespace-aware preference definitions and user-owned definitions. A bundled synchronous global catalog is no longer correct.
- v1 should stay workshop-focused: no location-scoped flows, no suggestion review/apply, no delete API, but it should show self-added definitions visible to the selected user.

## Key Changes
- Update `docs/workshop_client_package.md` first so it matches current backend behavior:
  - remove the bundled/generated global catalog design
  - make `catalog()` user-scoped and async
  - state that `catalog()` includes both system definitions for the selected user’s schema namespace and that user’s personal definitions
  - note that `analyzeDocument()` needs a backend fix so schema namespace and personal defs are respected there too
- Create `packages/workshop-client` as `@loyalagents/context-router-workshop-client`, and update both `pnpm-workspace.yaml` and root `package.json` workspaces to include `packages/*`.
- Add package-local tooling with `tsup` and `vitest`, plus root scripts:
  - `build:workshop-client`
  - `test:workshop-client`
  - `smoke:workshop-client`
  - `pack:workshop-client`
- Public API:
  - `createWorkshopClient({ baseUrl, apiKey, graphqlUrl?, uploadUrl?, fetch? })`
  - `WorkshopBaseClient.users(): Promise<WorkshopUser[]>`
  - `WorkshopBaseClient.withUser(userId: string): WorkshopUserClient`
  - `WorkshopUserClient.catalog(): Promise<WorkshopCatalogEntry[]>`
  - `WorkshopUserClient.me(): Promise<WorkshopUser>`
  - `WorkshopUserClient.activePreferences(): Promise<WorkshopPreference[]>`
  - `WorkshopUserClient.setPreference({ slug, value }): Promise<WorkshopPreference>`
  - `WorkshopUserClient.analyzeDocument({ file, filename? }): Promise<WorkshopDocumentAnalysisResult>`
- Transport behavior:
  - `users()` uses `groupUsers(apiKey: String!)` with the API key as a GraphQL variable and no auth header
  - user-scoped calls send `Authorization: Bearer <apiKey>` and `X-User-Id: <userId>`
  - `catalog()` fetches live data from `exportPreferenceSchema(scope: ALL)` for the selected user; do not bundle or cache a checked-in catalog artifact
  - `setPreference()` validates against that live visible catalog so personal defs are allowed
  - `activePreferences()` stays global-only by omitting `locationId`
  - `analyzeDocument()` keeps using `POST /api/preferences/analysis`
- Backend fix required for correctness:
  - thread `schemaNamespace` from authenticated user context into document-analysis services
  - make prompt-building and suggestion validation use `defRepo.getAll(userId, schemaNamespace)` / `isKnownSlug(..., schemaNamespace)` so non-`GLOBAL` users and personal defs work during upload analysis
  - no GraphQL schema change is required

## Checkpoints
- Checkpoint 1: plan/doc refresh, workspace scaffolding, auth transport
  - rewrite `docs/workshop_client_package.md`
  - scaffold package, shared HTTP layer, URL normalization, `WorkshopClientError`, `users()`, `withUser()`, `me()`
  - run `pnpm install` once after manifest changes so the new package tooling and existing backend test deps resolve
  - tests: package unit tests for URL/auth/error handling; backend auth-contract regression for `exportPreferenceSchema`
  - update `docs/personal-slug-planning.md` with a dated checkpoint entry, commands run, and results
- Checkpoint 2: live catalog and preference flows
  - implement `catalog()`, catalog type mapping, `activePreferences()`, `setPreference()`, live validation, README happy-path update
  - tests: package unit tests for namespaced catalog mapping, personal defs visibility, validation failures, and preference mutations; backend regressions for schema-namespace visibility and personal-definition catalog/export behavior
  - run package `test`, `build`, and smoke flow
  - update `docs/personal-slug-planning.md`
- Checkpoint 3: document analysis correctness and distribution
  - implement backend document-analysis namespace fix, package `analyzeDocument()`, tarball packing, and fresh-consumer smoke test from the produced `.tgz`
  - tests: backend document-analysis regression for non-`GLOBAL` users and personal defs; package multipart/error tests; tarball consumer smoke; package `test`, `build`, `smoke`, and `pack`
  - write tarball to a stable repo path such as `dist/workshop-client/`
  - update `docs/personal-slug-planning.md`

## Test Plan
- Package tests should cover:
  - URL normalization and override precedence
  - `groupUsers` request shape
  - user-scoped auth headers
  - live `catalog()` mapping from `exportPreferenceSchema(scope: ALL)`
  - visibility of self-added definitions
  - `setPreference()` validation for unknown slug and wrong value type
  - multipart upload construction and `Blob`/`filename` handling
  - tarball install/import smoke from a temporary consumer
- Backend regressions to run during implementation:
  - `test/e2e/export-schema-auth.e2e-spec.ts`
  - `test/e2e/schema-namespace.e2e-spec.ts`
  - `test/e2e/preference-definition-mutations.e2e-spec.ts`
  - document-analysis coverage updated to assert schemaNamespace and personal defs are honored

## Assumptions
- The package must expose self-added definitions visible to the selected user.
- v1 remains global-only for preference reads/writes; location-scoped APIs stay out of scope.
- Suggestion review/apply and deletion remain out of scope.
- The current worktree is not fully bootstrapped for tests yet; `ts-jest` was unresolved locally, so dependency installation is a required first implementation step before checkpoint test runs.

# Workshop Client Package Context

This file is the quick handoff context for `@loyalagents/context-router-workshop-client`.

## Goal

Add a small workshop-focused TypeScript package that wraps the existing Context Router GraphQL and document-upload APIs so workshop consumers do not need Apollo setup, handwritten GraphQL, or custom auth-header logic.

The package is intentionally narrower than the backend:
- selected-user oriented
- global-scope only in its public behavior
- tarball distribution for the workshop
- hides raw schema-namespace mechanics from the public API

## Core Decisions

- Package name: `@loyalagents/context-router-workshop-client`
- Package location: `packages/workshop-client`
- Distribution model: local `.tgz`, not npm publishing
- `catalog()` is live and async on every call
- `catalog()` uses `exportPreferenceSchema(scope: ALL)` and filters client-side to active `GLOBAL` definitions
- `catalog()` includes both:
  - system definitions visible to the selected user’s schema namespace
  - that user’s personal definitions
- The public package does not expose raw namespace fields

## What Has Been Implemented

### Package Surface

- `createWorkshopClient({ baseUrl, apiKey, graphqlUrl?, uploadUrl?, fetch? })`
- Base client:
  - `users()`
  - `withUser(userId)`
- User client:
  - `catalog()`
  - `me()`
  - `activePreferences()`
  - `setPreference({ slug, value })`
  - `analyzeDocument({ file, filename? })`

### Package Behavior

- `users()` calls `groupUsers(apiKey: String!)` and sends the API key as a GraphQL variable
- user-scoped calls send:
  - `Authorization: Bearer <apiKey>`
  - `X-User-Id: <userId>`
- `catalog()` maps visible definitions to workshop-facing entries:
  - `slug`
  - `displayName?`
  - `description`
  - `valueType`
  - `options?`
  - `origin: "system" | "personal"`
- `setPreference()` validates against a fresh live catalog on each call
- upload transport posts multipart form data to `/api/preferences/analysis`
- smoke flows choose a writable slug from the runtime catalog deterministically

### Backend Alignment Added For This Package

Document analysis now respects the selected user’s schema visibility:
- `schemaNamespace` is threaded from request auth context into document-analysis services
- prompt construction uses visible schema definitions for that selected user
- known-slug validation during upload analysis also uses the selected user’s schema namespace and personal definitions

## What Is Explicitly Not Implemented

- location-scoped workshop client methods
- suggestion review/apply APIs in the package
- delete/clear APIs in the package
- npm publishing
- catalog caching or refresh APIs
- exposing `namespace` or `ownerUserId` on the public `WorkshopCatalogEntry`

## Verification That Exists

- package unit tests and typecheck
- package build and tarball pack
- live smoke against a prestarted backend
- tarball consumer smoke from a temp project
- backend unit regression for namespaced/personal document extraction
- backend e2e regression for `/api/preferences/analysis`

Canonical commands live in [smoke_test.md](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/docs/package/smoke_test.md).

## Important Files

- Package entry and client logic:
  - [client.ts](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/packages/workshop-client/src/client.ts)
  - [catalog.ts](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/packages/workshop-client/src/catalog.ts)
  - [http.ts](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/packages/workshop-client/src/http.ts)
- Package docs:
  - [README.md](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/packages/workshop-client/README.md)
  - [smoke_test.md](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/docs/package/smoke_test.md)
- Backend namespace/document-analysis path:
  - [document-analysis.controller.ts](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/apps/backend/src/modules/preferences/document-analysis/document-analysis.controller.ts)
  - [document-analysis.service.ts](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/apps/backend/src/modules/preferences/document-analysis/document-analysis.service.ts)
  - [preference-extraction.service.ts](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.ts)
- Regression coverage:
  - [preference-extraction.service.spec.ts](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.spec.ts)
  - [document-analysis.e2e-spec.ts](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/apps/backend/test/e2e/document-analysis.e2e-spec.ts)
- Historical implementation log:
  - [personal-slug-planning.md](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/docs/personal-slug-planning.md)

## Current Status

- Implemented and verified
- Tarball consumer smoke passes
- Historical checkpoint log is in `docs/personal-slug-planning.md`

## Operational Note

If live smoke fails with `Invalid API key`, rerun the export-auth e2e contract listed in [smoke_test.md](/Users/lucasnovak/.codex/worktrees/4a7a/context-router/docs/package/smoke_test.md) to recreate the expected test API key fixture.

# Workshop Client Package — Merged V1 Plan

## Decision Summary
- Build an in-repo package at `packages/workshop-client` published only as a workshop tarball for now: `@loyalagents/context-router-workshop-client`.
- Keep the public surface intentionally small and workshop-oriented:
  - select a user for an API key
  - fetch the selected user’s visible global catalog
  - read active preferences
  - set a preference
  - analyze a document
- Keep these out of scope for v1:
  - location-scoped APIs
  - suggestion review/apply APIs
  - deletion / clear APIs
  - npm publishing
- Preserve the good parts of the earlier plan:
  - base-client -> user-client split
  - zero runtime dependencies
  - `Blob`-first upload API
  - explicit URL normalization and wrapped error model
  - early auth smoke test
  - tarball-consumer smoke test
- Adopt the critical correction from the refresh plan:
  - do **not** bundle a fixed checked-in catalog
  - `catalog()` must be live, async, and user-scoped so it reflects schema namespace and personal definitions

## Why This Is The Right Merge
The first plan had the better workshop ergonomics: a tiny client, a clear `createWorkshopClient() -> withUser()` flow, zero runtime dependencies, strong URL/auth handling, and a realistic tarball distribution story.

The second plan fixes the biggest correctness issue in the first plan: current backend behavior is no longer compatible with a bundled synchronous global catalog because preference definitions are namespace-aware and can also be user-owned. The merged plan keeps the workshop-friendly API shape but makes catalog discovery live and selected-user-specific.

## Final V1 Product Definition
### Package goals
The package should let a workshop participant do this without writing GraphQL, setting custom headers, or learning backend internals:

```ts
const base = createWorkshopClient({ baseUrl, apiKey });
const users = await base.users();
const client = base.withUser(users[0].userId);

const catalog = await client.catalog();
await client.me();
await client.activePreferences();
await client.setPreference({ slug: catalog[0].slug, value: /* valid value */ });
await client.analyzeDocument({ file, filename });
```

### Non-goals
- No `locationId` in the public API.
- No `locations()` method.
- No `suggestedPreferences()`, `acceptSuggestedPreference()`, or `rejectSuggestedPreference()`.
- No `deletePreference(id)`.
- No `clearPreference({ slug })` in v1. If workshop testing proves this is necessary, add it later as a slug-based method rather than exposing row IDs.

## Public API
### Factory
```ts
createWorkshopClient(config: {
  baseUrl: string;
  apiKey: string;
  graphqlUrl?: string;
  uploadUrl?: string;
  fetch?: typeof globalThis.fetch;
}): WorkshopBaseClient
```

### Exported client types
- `WorkshopBaseClient`
- `WorkshopUserClient`

### Exported supporting types
- `WorkshopUser`
- `WorkshopPreference`
- `WorkshopCatalogEntry`
- `WorkshopDocumentAnalysisResult`
- `WorkshopClientError`

### `WorkshopBaseClient`
```ts
users(): Promise<WorkshopUser[]>
withUser(userId: string): WorkshopUserClient
```

### `WorkshopUserClient`
```ts
catalog(): Promise<readonly WorkshopCatalogEntry[]>
me(): Promise<WorkshopUser>
activePreferences(): Promise<WorkshopPreference[]>
setPreference(input: { slug: string; value: unknown }): Promise<WorkshopPreference>
analyzeDocument(input: { file: Blob; filename?: string }): Promise<WorkshopDocumentAnalysisResult>
```

### Behavioral rules
- `createWorkshopClient()` always returns a base client.
- User-scoped methods are only available after `withUser(userId)`.
- `catalog()` is **not** available on the base client, because the visible catalog depends on the selected user.
- Public upload type is `Blob`; browser `File` objects work at runtime because they are `Blob`s.
- If `file` has a `.name`, use it. Otherwise require `filename`.
- `activePreferences()` and `setPreference()` are intentionally global-only wrappers in v1.

## Discoverability And Catalog Strategy
### Chosen approach
Use a **live selected-user catalog**, not a bundled generated catalog.

### Requirements
- The catalog must include definitions visible to the selected user:
  - system definitions for that user’s schema namespace
  - that user’s personal definitions
- The catalog returned by the workshop client must include only entries the v1 client can actually use:
  - active definitions only
  - global-scope definitions only
  - no archived definitions
  - no location-scoped definitions surfaced to workshop consumers

### Query source
- Preferred: call the narrowest backend schema export that already preserves correct selected-user visibility for namespace + personal definitions.
- Safe fallback: call `exportPreferenceSchema(scope: ALL)` and filter client-side to the global subset that v1 supports.

### `WorkshopCatalogEntry`
The public type should stay simple and AI-friendly. Include only fields that help a consumer choose a valid slug and value:
- `slug`
- `displayName?`
- `description`
- `valueType`
- `options?`
- `origin: "system" | "personal"`
- optional example value for README generation only; do not make examples a runtime requirement

Do **not** expose raw namespace mechanics as part of the workshop-facing API unless needed for debugging.

### Validation behavior
`setPreference()` should perform lightweight client-side validation against the currently visible catalog before sending the mutation:
- unknown slug -> client error
- wrong primitive type -> client error
- enum value not in `options` -> client error
- location-scoped or otherwise unsupported definition -> client error

Keep this validation intentionally shallow. The backend remains the source of truth.

## Transport, URL, And Error Rules
### URL normalization
- `https://api.example.com` -> GraphQL `https://api.example.com/graphql`, upload `https://api.example.com/api/preferences/analysis`
- `https://api.example.com/graphql` -> GraphQL stays there, upload becomes `https://api.example.com/api/preferences/analysis`
- Preserve path prefixes: `https://host/prefix` -> `/prefix/graphql` and `/prefix/api/preferences/analysis`
- `graphqlUrl` and `uploadUrl` override derived URLs when provided

### Auth and request behavior
- `users()` is the wrapper name for the backend `groupUsers(apiKey: String!)` contract.
- `users()` sends the API key as a GraphQL variable and intentionally does **not** attach `Authorization`.
- User-scoped methods send:
  - `Authorization: Bearer <apiKey>`
  - `X-User-Id: <userId>`
- GraphQL methods POST JSON to the GraphQL endpoint.
- `analyzeDocument()` POSTs multipart form data to `/api/preferences/analysis` with the same user-scoped auth headers.

### Error model
Wrap all public failures in `WorkshopClientError`.

Public fields:
- `kind: "config" | "network" | "http" | "graphql"`
- `message`
- `operation`
- `statusCode?`
- `raw?`

Behavior:
- invalid config or missing filename for generic `Blob` -> `kind: "config"`
- native fetch failure -> `kind: "network"`
- non-2xx HTTP -> `kind: "http"`
- GraphQL errors in a 200 response -> `kind: "graphql"`

## Package Structure And Tooling
### Workspace/package setup
- Update `pnpm-workspace.yaml` to include `packages/*`.
- Update the root workspace config in `package.json` if needed to include `packages/*`.
- Create `packages/workshop-client` with:
  - `package.json`
  - `tsconfig.json`
  - `README.md`
  - `src/`
  - `test/`
- Add `engines.node` for Node 18+.

### Tooling
- Build: `tsup`
- Tests: `vitest`
- Runtime dependency goal: zero runtime dependencies
- Use native `fetch`, `URL`, `Headers`, `Blob`, and `FormData`

### Root scripts
- `build:workshop-client`
- `test:workshop-client`
- `smoke:workshop-client`
- `pack:workshop-client`

### Internal file layout
- `src/client.ts` — factory, base client, user client
- `src/http.ts` — URL normalization, requests, headers, error wrapping
- `src/operations.ts` — GraphQL documents and response parsing
- `src/catalog.ts` — live catalog mapping and validation helpers
- `src/types.ts` — exported DTOs and `WorkshopClientError`

## Backend Alignment Required
### Already assumed by the client wrapper
- selected-user auth context controls visibility
- schema export is capable of returning namespace-aware and personal definitions for the selected user

### Explicit backend fix required before calling the client “done”
`analyzeDocument()` needs backend alignment so it uses the same definition visibility rules as `catalog()` and `setPreference()`.

Required change:
- thread `schemaNamespace` from authenticated user context into document-analysis services
- make prompt-building and known-slug validation use the same effective definition visibility as the selected user
- include personal definitions where appropriate
- no GraphQL schema change required

### Release gate
Do not call `analyzeDocument()` fully supported for namespaced/non-`GLOBAL` users until the backend regression for schema namespace + personal definitions passes.

## Checkpoints
### Checkpoint 0 — doc refresh and bootstrap
- Replace the old bundled-catalog design in `docs/workshop_client_package.md` with this merged plan.
- Run `pnpm install` after manifest/workspace changes so package tooling and existing backend test dependencies resolve.
- Add a `Workshop Client Package` section to `docs/personal-slug-planning.md` for dated checkpoint logs.

Success criteria:
- workspaces resolve
- package tooling installs cleanly
- implementation doc matches current backend reality

### Checkpoint 1 — package scaffold, request core, and auth smoke
Implement:
- workspace/package scaffold
- URL normalization
- shared HTTP layer
- `WorkshopClientError`
- `users()`
- `withUser()`
- `me()`

Tests:
- URL normalization from origin, `/graphql`, and path-prefix inputs
- override precedence for `graphqlUrl` and `uploadUrl`
- `users()` request shape and no-auth-header behavior
- `withUser()` returns a user-scoped client type
- `me()` request shape and auth headers
- representative config / network / HTTP / GraphQL error wrapping

Smoke check early:
- start a local backend with workshop auth data
- run `users()`
- select a user
- run `withUser()`
- run `me()`

Record:
- commands run
- pass/fail result
- any auth-contract surprises

### Checkpoint 2 — live catalog and core preference flow
Implement:
- `catalog()`
- catalog mapping from live schema export
- filtering to active global-only workshop-visible definitions
- client-side validation helpers
- `activePreferences()`
- `setPreference()`
- README happy-path docs updated to show `users() -> withUser() -> catalog()`

Tests:
- live catalog mapping
- exclusion of location-scoped definitions from workshop catalog output
- visibility of self-added/personal definitions for the selected user
- namespace-aware visibility behavior
- `activePreferences()` request/response handling
- `setPreference()` success path
- unknown slug validation
- wrong value type / bad enum option validation
- one type-level usage example importing the package and following the happy path

Backend regressions:
- `exportPreferenceSchema` auth/visibility contract
- schema-namespace visibility
- personal-definition visibility in schema export

Run:
- `pnpm --filter @loyalagents/context-router-workshop-client test`
- `pnpm --filter @loyalagents/context-router-workshop-client build`
- `pnpm --filter @loyalagents/context-router-workshop-client smoke`

### Checkpoint 3 — document analysis, tarball, and consumer smoke
Implement:
- backend document-analysis namespace/personal-definition fix
- package `analyzeDocument()`
- pack script and tarball generation
- fresh-consumer install smoke from the produced `.tgz`
- ensure the smoke consumer follows the README happy path exactly

Tests:
- multipart upload construction
- `Blob` + `filename` handling
- upload error handling
- document-analysis regression for namespaced/non-`GLOBAL` users
- document-analysis regression for personal definitions
- tarball install/import smoke from a temporary consumer app
- smoke consumer executes the same example shown in the README

Run:
- `pnpm --filter @loyalagents/context-router-workshop-client test`
- `pnpm --filter @loyalagents/context-router-workshop-client build`
- `pnpm --filter @loyalagents/context-router-workshop-client smoke`
- `pnpm --filter @loyalagents/context-router-workshop-client pack`

Output:
- write tarball to a stable repo path such as `dist/workshop-client/`

## Test Plan
### Package tests
Cover:
- URL normalization and override precedence
- `users()` / backend `groupUsers` request shape
- user-scoped auth headers
- live catalog mapping
- filtering of unsupported location-scoped definitions
- visibility of personal definitions
- validation for unknown slug, wrong value type, and invalid enum option
- multipart upload behavior
- `Blob`/`filename` handling
- tarball install/import smoke

### Backend regressions
Run or add coverage for:
- `test/e2e/export-schema-auth.e2e-spec.ts`
- `test/e2e/schema-namespace.e2e-spec.ts`
- `test/e2e/preference-definition-mutations.e2e-spec.ts`
- document-analysis coverage asserting schema namespace and personal definitions are honored

## Documentation Requirements
The package README should include:
- install from `.tgz`
- the exact happy path for workshop users
- a plain TypeScript example
- a Next.js example
- explanation that the workshop client is global-only in v1
- explanation that `catalog()` is selected-user-specific and async
- guidance that consumers should call `await client.catalog()` before choosing slugs
- upload usage examples for browser `File` and generic `Blob`
- note that no Apollo or custom header logic is needed

## Implementation Progress Template
- Status: not started
- Tracking checklist:
  - [ ] Add `packages/*` workspace support and scaffold `packages/workshop-client`
  - [ ] Implement config parsing, URL normalization, and `WorkshopClientError`
  - [ ] Implement `users()`, `withUser()`, and `me()`
  - [ ] Run early auth smoke check and log it in `docs/personal-slug-planning.md`
  - [ ] Implement live `catalog()` and validation helpers
  - [ ] Implement `activePreferences()` and `setPreference()`
  - [ ] Implement backend document-analysis namespace/personal-definition fix
  - [ ] Implement `analyzeDocument()`
  - [ ] Add unit tests, smoke script, tarball packaging, and fresh-consumer smoke test
  - [ ] Finalize README and pack output path
  - [ ] Record every checkpoint in `docs/personal-slug-planning.md`

## Post-Workshop Follow-Up
Explicitly defer these until after the workshop unless testing forces a change:
- location-scoped preference APIs
- slug-based clear/remove method
- suggestion review/apply methods
- npm publishing
- deeper package-management cleanup beyond this demo branch

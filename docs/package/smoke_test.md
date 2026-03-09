# Workshop Client Smoke Test

Use this file as the canonical checklist for verifying `@loyalagents/context-router-workshop-client`.

## Quick Package Checks

From the repo root:

```bash
pnpm test:workshop-client
pnpm build:workshop-client
pnpm pack:workshop-client
```

What this covers:
- package unit tests and typecheck
- built ESM/CJS outputs
- generated tarball in `dist/workshop-client/`

## Start A Local Backend

Run this in a separate terminal:

```bash
env NODE_ENV=test PORT=3010 DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test CORS_ORIGIN=http://localhost:3001 GCP_PROJECT_ID=test-project VERTEX_REGION=us-central1 VERTEX_MODEL_ID=gemini-2.5-flash-lite pnpm --filter backend start
```

## Seed The Smoke API Key Fixture

The smoke scripts expect the test API key `grp-a-export-auth`. If other e2e tests have reset the DB, reseed it with:

```bash
pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/export-schema-auth.e2e-spec.ts
```

## Live Smoke

This runs the built package against the local backend and exercises:
- `users()`
- `withUser()`
- `me()`
- `catalog()`
- `activePreferences()`
- `setPreference()`

```bash
env WORKSHOP_CLIENT_SMOKE_BASE_URL=http://localhost:3010 WORKSHOP_CLIENT_SMOKE_API_KEY=grp-a-export-auth pnpm smoke:workshop-client
```

## Tarball Consumer Smoke

This installs the generated `.tgz` for the current package version into a temporary project and runs the same flow from outside the monorepo package source:

```bash
env WORKSHOP_CLIENT_SMOKE_BASE_URL=http://localhost:3010 WORKSHOP_CLIENT_SMOKE_API_KEY=grp-a-export-auth pnpm smoke:workshop-client:consumer
```

## Upload Analysis Regressions

Run these when you want to verify the backend document-analysis namespace fix as well:

```bash
pnpm --filter backend exec jest --selectProjects unit --runInBand src/modules/preferences/document-analysis/preference-extraction.service.spec.ts
pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/document-analysis.e2e-spec.ts
```

## Expected Outputs

- `pnpm pack:workshop-client` should write a tarball under `dist/workshop-client/`
- `pnpm smoke:workshop-client` should print a JSON summary with `userCount`, `selectedUserId`, `catalogCount`, and `setPreferenceSlug`
- `pnpm smoke:workshop-client:consumer` should print a JSON summary with `installedUserCount`, `chosenSlug`, and `tarballPath`

## Common Failure

If the live smoke fails with `Invalid API key`, rerun:

```bash
pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/export-schema-auth.e2e-spec.ts
```

That recreates the expected test API key fixture.

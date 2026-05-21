# Eval Runner Implementation Summary

- Status: complete
- Date: 2026-05-20

## What Changed

- Added `pnpm eval:run` as a local deterministic scenario runner for
  `examples/eval/`.
- Added runner modules under `examples/eval/scripts/eval-runner/` for CLI
  parsing, fixture loading, scenario validation gating, deterministic action
  planning, backend child-process orchestration, snapshot normalization, and
  compare/update behavior.
- Changed `pnpm eval:test` to use recursive `node --test examples/eval/scripts`
  discovery so nested runner tests are included.
- Added `apps/backend/test/eval-runner/harness.ts`, a standalone backend
  test-app harness that boots outside Jest, resets and seeds the isolated test
  DB, creates a test user, hydrates active preferences, calls
  `/api/form-fill/pdf`, decodes the returned PDF, and writes a deterministic
  JSON result file.
- Widened backend test-app mock option types so the harness can pass plain
  mocks without introducing Jest globals into the standalone process.
- Added `examples/eval/schemas/filled-form-snapshot.schema.json` and wired it
  into fixture validation.
- Updated `elena-marquez-i9-template-smoke` to declare `filled-form` as its
  expected snapshot and committed the first
  `expected/filled-form.json` snapshot.
- Updated scaffold ownership so existing scenario directories are
  runner-owned and cannot be overwritten by `eval:scaffold`, even with
  `--force`.
- Updated `examples/eval/README.md` with the runner workflow, snapshot update
  workflow, and backend test DB prerequisites.

## Test Hardening

- Added pure runner tests for backend child-process command construction,
  temp-result handling, non-zero child failures, missing output JSON, and
  backend `response.status: "failed"` diagnostics.
- Added snapshot update-scope coverage proving `--update-snapshots` writes only
  declared snapshots and preserves unrelated files under `expected/`.
- Added validator coverage proving filled-form snapshots reject nondeterministic
  runtime and transport fields such as `fillId`, `filledPdfBase64`, and HTTP
  status.
- Added `apps/backend/test/e2e/eval-runner-harness.e2e-spec.ts`, which spawns
  the standalone harness process, verifies it writes a valid output JSON, and
  asserts deterministic seed and eval-only preferences persisted in the test
  DB with user-owned `GLOBAL` eval definitions.

## Runner Behavior

- Normal runs invoke full scenario validation before the backend harness starts.
- Update runs validate the scenario, user, corpus, form, field map, and seed
  integrity, but skip expected snapshot existence and schema checks so snapshots
  can be created or replaced deliberately.
- The runner does not call a real LLM, Auth0, a deployed backend, browser/UI
  automation, or document-analysis ingestion.
- The backend harness uses the real backend form-fill API path through
  `createTestApp()`, the existing test auth guard override pattern, the backend
  test DB, real PDF extraction and filling, real active-preference lookup, and
  deterministic structured-AI actions.
- Parent and child communicate through temp JSON input and output files rather
  than stdout parsing. Harness failures surface stderr/stdout tails and include
  a targeted hint when the local test DB appears unavailable.
- Snapshot updates are explicit:

  ```bash
  pnpm eval:run --scenario elena-marquez-i9-template-smoke --update-snapshots
  ```

  Normal mode compares canonical two-space JSON with trailing newlines and
  fails with a compact diff when snapshots are stale.

## Hydration And Actions

- Hydration is deterministic and service-based. It reads `profile.yaml` and
  `seed-preferences.generated.json`, then writes backend-visible active
  preferences directly through backend preference services.
- Seed preference slugs take precedence when a field-map fact is covered by
  `seedPreferences[]`.
- Non-null field-map facts not covered by seed preferences get eval-only,
  user-owned preference definitions using derived `eval.*` slugs and
  `GLOBAL` scope.
- Null facts are omitted from hydration and produce explicit `SKIP` actions.
- Arrays render with `", "` in profile order. ISO dates matching
  `YYYY-MM-DD` render as `MM/DD/YYYY`.
- For the I-9 SSN field, the runner renders Elena's SSN as digits only because
  the generated PDF field metadata constrains that field to nine characters.
- Deterministic AI returns exactly `{ fillActions: [...] }`. Filled actions use
  non-empty source slugs and confidence `0.99`.

## Snapshot Contract

- The first snapshot type is `filled-form`.
- Snapshot top-level fields are:
  `schemaVersion`, `snapshotType`, `scenarioId`, `userId`, `corpusId`,
  `formId`, `response`, `summary`, and `fields`.
- The snapshot omits nondeterministic `fillId` and raw `filledPdfBase64`.
- Fields are sorted by generated field index and include generated field
  metadata, field-map expectations, expected rendered values, decoded actual
  PDF values, source slugs, confidence, skip reasons, and classifications.
- V1 classifications are `correct`, `skipped-correctly`, `missing`,
  `hallucinated`, `incorrect`, and `unsupported`.
- Elena's initial I-9 template-smoke snapshot has 48 total fields, 12 filled
  fields, 36 skipped fields, and response status `partial`.

## Verification

Ran:

```bash
pnpm eval:test
pnpm eval:validate --scenario elena-marquez-i9-template-smoke
pnpm eval:validate
pnpm --filter backend test:db:up
pnpm --filter backend test:db:migrate
pnpm eval:run --scenario elena-marquez-i9-template-smoke --update-snapshots
pnpm eval:run --scenario elena-marquez-i9-template-smoke
pnpm --filter backend test:e2e:tests-only --testPathPattern=form-fill.e2e-spec.ts
pnpm --filter backend test:e2e:tests-only --testPathPattern=eval-runner-harness.e2e-spec.ts
```

Results:

- Eval script tests passed, including nested runner tests.
- Focused scenario validation and full fixture validation passed.
- The backend test DB started and migrations applied.
- Snapshot update mode generated the committed Elena filled-form snapshot.
- Normal runner mode matched the committed snapshot.
- The existing backend form-fill e2e spec passed against the shared test-app
  setup touched by the runner harness.
- The new standalone backend harness e2e smoke passed and verified deterministic
  hydration state in the DB.

## Deferred

- No real LLM evaluation.
- No browser or UI automation.
- No document-analysis ingestion.
- No multi-scenario matrix, archetype system, or snapshot preservation logic in
  scaffold.
- No production backend behavior or database migrations.

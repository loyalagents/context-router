# Batch 4 Implementation Plan: Eval Runner

## Summary

Build `pnpm eval:run` as local eval infrastructure for `examples/eval/`. The runner validates a scenario, runs a backend test-app harness against the isolated backend test DB, hydrates deterministic active preferences from `profile.yaml`, injects deterministic form-fill AI behavior, calls `POST /api/form-fill/pdf`, and compares or updates `expected/filled-form.json`.

V1 is a deterministic backend-pipeline smoke test, not model-reasoning evaluation. It exercises real PDF extraction, active-memory lookup, prompt construction, action validation, PDF filling, and snapshot normalization without real Auth0, a real LLM, browser automation, deployed services, or document-analysis ingestion.

## Context

Relevant fixture/script files:

- `examples/eval/scripts/validate.mjs`
- `examples/eval/scripts/scaffold.mjs`
- `examples/eval/scripts/shared.mjs`
- `examples/eval/schemas/scenario.schema.json`
- `examples/eval/forms/i-9/field-map.json`
- `examples/eval/forms/i-9/form.pdf`
- `examples/eval/users/elena-marquez/profile.yaml`
- `examples/eval/users/elena-marquez/seed-preferences.generated.json`
- `examples/eval/scenarios/elena-marquez-i9-template-smoke/scenario.json`

Relevant backend files:

- `apps/backend/test/setup/env.ts`
- `apps/backend/test/setup/test-app.ts`
- `apps/backend/test/setup/test-db.ts`
- `apps/backend/test/e2e/form-fill.e2e-spec.ts`
- `apps/backend/src/modules/preferences/form-fill/form-fill.service.ts`
- `apps/backend/src/modules/preferences/form-fill/form-fill.controller.ts`
- `apps/backend/src/modules/preferences/preference/preference.service.ts`
- `apps/backend/src/modules/preferences/preference-definition/preference-definition.service.ts`
- `apps/backend/src/modules/preferences/preference/preference.validation.ts`

## Key Changes

- Add root scripts:
  - `"eval:run": "node examples/eval/scripts/run.mjs"`
  - Change `"eval:test"` to `"node --test examples/eval/scripts"` so nested runner tests are discovered.
- CLI:
  - `pnpm eval:run --scenario <scenarioId>`
  - `pnpm eval:run --scenario <scenarioId> --update-snapshots`
  - Exit codes: `0` pass, `1` validation/run/snapshot failure, `2` usage error.
- Add runner modules under `examples/eval/scripts/eval-runner/` for args, fixture loading, validation gating, action planning, snapshot normalization/diffing, and child-process orchestration.
- Add backend harness entry at `apps/backend/test/eval-runner/harness.ts`.
  - Root `run.mjs` spawns it with `cwd: apps/backend`.
  - Command: `node -r tsconfig-paths/register -r ts-node/register test/eval-runner/harness.ts`.
  - Parent and child communicate through a temp JSON result file, not raw stdout.
- Add `examples/eval/schemas/filled-form-snapshot.schema.json`.
- Update `validate.mjs`:
  - Add `filledFormSnapshot` to `SCHEMA_FILES`.
  - Compile it through existing `createContext` schema loading.
  - In `validateScenario`, schema-validate `expected/filled-form.json` after `readJsonFile`.
  - Add an internal option to skip expected snapshot existence/schema checks for update mode.
- Update `elena-marquez-i9-template-smoke/scenario.json`:
  - `expectedSnapshots: ["filled-form"]`
- Add `examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json`.

## Validation And Ownership

- Normal `eval:run` invokes full scenario validation before the backend harness starts.
- `--update-snapshots` validates scenario, user, corpus, form, field map, and seed integrity, but skips expected snapshot existence/schema checks because those files may be created or replaced.
- The field map is the oracle of record for V1 classifications. Editing `field-map.json` intentionally changes runner behavior and should be followed by `pnpm eval:run --scenario ... --update-snapshots`.
- After Batch 4, scaffold may initialize scenarios but must not overwrite existing scenario folders.
  - Change `eval:scaffold --scenario <id>` so existing `scenarios/<id>/` is refused even with `--force`.
  - Keep `--force` for regenerating corpora.
  - Snapshot updates belong to `eval:run --update-snapshots`, not scaffold.

## Backend Harness

- The harness imports `apps/backend/test/setup/env.ts` first, before any backend module that may read env at module load time.
- It intentionally does not import `jest.after-env.ts`.
- It calls `resetDb()` and `seedPreferenceDefinitions()` itself.
- It creates a fresh test user, calls `setTestUser(testUser)`, and closes the Nest app and Prisma connection after the run.
- Reuse `createTestApp()` and the existing guard override pattern.
- Pass all three mocks explicitly as plain objects:
  - `mockVertexAi`
  - `mockStructuredAi`
  - `mockAuth0`
- If `test-app.ts` needs edits, prefer type widening only so plain mocks fit `CreateTestAppOptions`; do not rewrite Jest mock factories unless required.
- If runtime behavior in `test-app.ts` changes, run broader backend integration/e2e verification.
- Show a clear error when the test DB on `localhost:5433` is down or unmigrated.

## Hydration And Actions

- Hydrate from `profile.yaml` and `seed-preferences.generated.json`; do not ingest corpus documents.
- `start/prompt.md` and corpus documents are validated fixture context only in V1; deterministic AI means they are not consumed by the backend call.
- Use direct backend services for hydration, not GraphQL.
- Use one deterministic `MutationContext`:
  - `actorType: AuditActorType.SYSTEM`
  - `origin: AuditOrigin.SYSTEM`
  - `sourceType: SourceType.SYSTEM`
  - fixed correlation id derived from scenario id.
- Resolve each field-map fact to a source slug:
  - If `seedPreferences[].factKey` matches, use that seed slug.
  - Otherwise derive `eval.<snake_case_fact_path>`.
- Create user-owned eval-only definitions and active preferences only for non-null field-map facts not covered by seed preferences.
- Eval-only definitions use `scope: GLOBAL` so `getActivePreferences(userId)` returns them without a location.
- Value type inference:
  - arrays -> `ARRAY`
  - booleans -> `BOOLEAN`
  - all other non-null scalar values -> `STRING`
- Null facts are not hydrated.
- Validate ISO date rendering inputs at action-generation time: values matching `YYYY-MM-DD` render as `MM/DD/YYYY`. The profile schema does not currently type individual date facts, so this check belongs in the runner.
- For Elena + I-9 template-smoke, assert the initial eval-only fact set includes:
  - `identity.middleInitial`
  - `identity.otherLastNames`
  - `identity.dateOfBirth`
  - `identity.ssn`
  - `address.current.street`
  - `address.current.unit`
  - `address.current.city`
  - `address.current.state`
  - `address.current.postalCode`
- Deterministic AI mock returns exactly:
  - `{ fillActions: [...] }`
- Every filled action has non-empty `sourceSlugs` and confidence `0.99`.
- Action rules:
  - `action.fieldName` is the PDF field name.
  - Text fields use `SET_TEXT`.
  - Dropdown/radio/option-list fields use `SELECT_OPTION` only when the rendered value exists in `field.options[].value`; otherwise emit `SKIP`.
  - Checkbox fields use `CHECK`/`UNCHECK` only for boolean facts; otherwise emit `SKIP`.
  - Arrays render with `", "` preserving profile order.
  - Emit explicit `SKIP` actions for every skipped field, including field-map `mode: "skip"` fields and null fact fields, with deterministic `skipReason`.

## API Call And Snapshot Shape

- The harness calls:
  - `POST /api/form-fill/pdf`
  - expected HTTP status: `201`
  - multipart field: `file`
  - path: `examples/eval/forms/<formId>/form.pdf`
  - filename: `form.pdf`
  - content type: `application/pdf`
- I-9 is expected to return form-fill `status: "partial"`, not `"success"`.
- Do not include transport HTTP status in the snapshot.
- Join fixture metadata by index:
  - `field-map.fieldIndex` ↔ `fields.generated.json.index`
  - assert `pdfFieldName` matches.
- Join runtime backend summaries by PDF field name.
- Snapshot top-level fields:
  - `schemaVersion`
  - `snapshotType: "filled-form"`
  - `scenarioId`
  - `userId`
  - `corpusId`
  - `formId`
  - `response`
  - `summary`
  - `fields`
- Omit nondeterministic `fillId` and raw `filledPdfBase64`.
- Include deterministic response metadata:
  - `status`
  - `originalFilename`
  - `outputFilename`
  - `outputMimeType`
  - total/filled/skipped counts
  - warnings
- `fields[]` is sorted by `fieldIndex` and includes:
  - generated field metadata
  - field-map expectation
  - rendered expected value when applicable
  - actual filled value decoded from returned PDF when present
  - source slugs
  - confidence
  - skip reason
  - classification
- V1 classifications:
  - `correct`
  - `skipped-correctly`
  - `missing`
  - `hallucinated`
  - `incorrect`
  - `unsupported`
- First Elena snapshot expected counts:
  - `totalFields: 48`
  - `filledCount: 12`
  - `skippedCount: 36`
  - `status: "partial"`
  - filled actions: 11 `SET_TEXT`, 1 `SELECT_OPTION`
- The `State` dropdown should select `"CA"`.
- I-9 checkboxes are all skip fields in V1, so checkbox fill behavior is implemented but not covered by the first scenario.
- Normal mode compares canonical two-space/trailing-newline JSON and fails with a compact diff.
- `--update-snapshots` writes only declared snapshots and prints updated paths.

## Tests And Verification

Add eval script tests for:

- Recursive `eval:test` discovery by placing runner tests under `examples/eval/scripts/eval-runner/`.
- CLI parsing and usage errors.
- Scenario validation gating in normal and update modes.
- Backend child-process command construction and temp-result handling.
- Eval slug derivation and backend slug validation.
- Seed-preference slug precedence over derived `eval.*` slugs.
- Value type inference.
- Null fact omission.
- Date and array rendering.
- Dropdown option mismatch fallback to explicit `SKIP`.
- Explicit skip action generation and skip reason preservation.
- Deterministic action return shape `{ fillActions: [...] }`.
- Snapshot normalization, classification, canonical JSON, stale compare failure, and update writes.
- Validator integration for `filled-form-snapshot.schema.json`.
- Scaffold refusing to overwrite an existing scenario even with `--force`.

Add backend harness smoke coverage for:

- standalone non-Jest process boots `createTestApp()` with plain mocks.
- reset/seed/create-user lifecycle works.
- `/api/form-fill/pdf` is called once and closes cleanly.

Verification commands:

```bash
pnpm eval:test
pnpm eval:validate --scenario elena-marquez-i9-template-smoke
pnpm --filter backend test:db:up
pnpm --filter backend test:db:migrate
pnpm eval:run --scenario elena-marquez-i9-template-smoke --update-snapshots
pnpm eval:run --scenario elena-marquez-i9-template-smoke
pnpm eval:validate
```

If `apps/backend/test/setup/test-app.ts` runtime behavior changes, also run:

```bash
pnpm --filter backend test:integration
pnpm --filter backend test:e2e:tests-only
```

## Checkpoints

1. Runner skeleton:
   - Add CLI, recursive `eval:test`, pure fixture loading, validation gate, root script, and pure tests.
   - End with `pnpm eval:test` and focused scenario validation.

2. Backend execution spike:
   - Add backend-owned harness entry.
   - Prove a standalone non-Jest child process can boot `createTestApp()` with plain mocks, call `/api/form-fill/pdf` once, write a temp result JSON file, and close cleanly.
   - End with the smoke path passing against the test DB.

3. Hydration and action generation:
   - Add deterministic service-based hydration and action planning.
   - Assert Elena’s concrete eval-only facts and expected first-snapshot counts.
   - End with `pnpm eval:run --scenario elena-marquez-i9-template-smoke --update-snapshots` reaching the API.

4. Snapshot V1 and validator integration:
   - Add filled-form snapshot schema, normalization, compare/update behavior, decoded-PDF field values, scenario `expectedSnapshots`, and Elena’s first snapshot.
   - End with update mode followed by normal mode passing.

5. Scaffold ownership cleanup:
   - Prevent scaffold from overwriting existing scenarios.
   - Update tests and docs for scaffold-vs-runner ownership.
   - End with `pnpm eval:test`.

6. Docs and closeout:
   - Update `examples/eval/README.md`.
   - Add `eval-runner/implementation-summary.md`.
   - Update `orchestration-plan.md` Batch 4 status and current implemented state.
   - End with the full verification command set.

## Risks And Rollback Notes

- Cross-workspace execution is the main technical risk. Prove it before building hydration or snapshots.
- `test-app.ts` is shared backend test infrastructure. Keep edits type-only if possible; broaden backend tests if runtime behavior changes.
- Snapshot updates can mask real behavior changes. Require explicit `--update-snapshots` and normal-mode compare in verification.
- Scaffold no longer overwrites existing scenarios. If that blocks a fixture workflow, create a deliberate new scaffold command later rather than reintroducing implicit overwrite behavior.
- Rollback is straightforward for Batch 4: remove `eval:run`, runner files, backend harness files, snapshot schema, the Elena expected snapshot, and the scenario `expectedSnapshots` entry. No production backend behavior or migrations should be changed.

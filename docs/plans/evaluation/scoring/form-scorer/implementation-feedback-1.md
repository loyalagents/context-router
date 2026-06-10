# Form Scorer Plan Feedback 1

Feedback on `implementation-plan.md` for `eval:fill-form`, grounded in the
current eval-runner, scorer, and backend form-fill code. This builds on
`implementation-feedback-a.md`; where the two disagree, this file reflects the
current repo state (some of feedback-a's assumptions are now stale).

## Verdict

Implement it. The core thesis is correct and the repo confirms it: the only
missing piece is a live backend-memory runner that produces the existing
`filled-form.json` artifact, and every reuse the plan assumes actually works.
I verified the three load-bearing claims:

- `POST /api/form-fill/pdf` exists, is `JwtAuthGuard`-protected, and fills from
  the authenticated user's active preferences
  (`apps/backend/src/modules/preferences/form-fill/form-fill.controller.ts:17-67`).
- The backend response already carries everything the snapshot needs:
  `summary.filledFields[].sourceSlugs/confidence`,
  `summary.skippedFields[].reason/sourceSlugs/confidence`,
  `totalFields/filledCount/skippedCount/warnings`, and `filledPdfBase64`
  (`form-fill.types.ts:70-102`).
- `buildFilledFormSnapshot` derives `expected`/`classification`/
  `plannedActionCounts` purely from the fixture + deterministic `runPlan`, and
  only pulls `actual` from `harnessResult` (`eval-runner/snapshots.mjs:11-67`).
  So reusing `buildRunPlan` for expected truth and feeding real backend output
  as `actual` is exactly the supported shape.

The changes below are the gaps the plan does not yet address. They are ordered
by how likely they are to block or rework the implementation.

## Must-fix gaps

### 1. `pdf-lib` is not a root dependency — but there is an established pattern

The plan says "inspect filled PDF fields with `pdf-lib`" as if it were
importable from the eval scripts. It is not: `require.resolve('pdf-lib')` from
the repo root fails. `pdf-lib` lives only in `apps/backend/node_modules`, and
the eval scripts run with cwd at the repo root (`node examples/eval/scripts/...`).

The repo already solved this. `generate-field-manifests.mjs:14-29` loads it via:

```js
const backendRequire = createRequire(
  path.join(repoRoot, 'apps/backend/package.json'),
);
const { PDFCheckBox, PDFDocument, PDFDropdown, /* ... */ } =
  backendRequire('pdf-lib');
```

The plan should explicitly:

- Reuse this `backendRequire`/`createRequire` pattern (ideally hoist it into
  `examples/eval/scripts/shared.mjs` so `fill-form.mjs` and
  `generate-field-manifests.mjs` share one definition).
- Port the field-reading logic from the backend harness rather than reinvent
  it. `harness.ts:170-192` (`readFilledPdfFields`) already maps each pdf-lib
  field type to the exact `{ value | checked | selected }` shape that
  `buildFilledFormSnapshot` expects in `harnessResult.filledPdfFields`. Move
  that into a shared eval-runner helper (e.g. `eval-runner/pdf.mjs`) and have
  both the TS harness and the new CLI use the same contract.

This corrects feedback-a §6, which worried about "its own small helper" and
"avoid reaching into the backend test harness." The right move is a shared
helper, not a one-off, and the pattern is already proven in the codebase.

### 2. The Alex scenario needs more committed files than the plan lists

`loadScenarioFixture` (`eval-runner/fixtures.mjs:6-44`) hard-requires all of:
`scenarios/<id>/scenario.json`, `scenarios/<id>/start/prompt.md`,
`users/<userId>/profile.yaml`, `users/<userId>/seed-preferences.generated.json`,
`users/<userId>/corpora/<corpusId>/manifest.json`,
`forms/<formId>/field-map.json`, and `forms/<formId>/fields.generated.json`. If
`start/prompt.md` is missing the loader throws before any backend call.

Current state (updating feedback-a §2, which is now partly stale):

- `users/alex-i9-test/{profile.yaml, seed-preferences.generated.json}` — exist.
- `users/alex-i9-test/corpora/realistic/{manifest.json, documents/, validation-report.json}`
  — **exist now** (feedback-a's claim that the realistic corpus is missing is
  out of date).
- `forms/i-9/{field-map.json, fields.generated.json, form.pdf}` — exist.
- `scenarios/alex-i9-realistic/` — **does not exist**.

So the only new fixture files the PR must add for `--scenario alex-i9-realistic`
are `scenario.json` and `start/prompt.md`. The plan should name these as
explicit deliverables (or change the live-smoke example to an existing scenario
like `elena-marquez-i9-template-smoke`).

### 3. Decide `expectedSnapshots` for the live scenario

`run.mjs` validates with `runValidation({ skipExpectedSnapshots: updateSnapshots })`
and `compareOrUpdateSnapshots` errors if a declared snapshot has no
`expected/filled-form.json` (`snapshots.mjs:79-115`). Both existing scenarios
declare `"expectedSnapshots": ["filled-form"]` and ship a golden
`expected/filled-form.json`.

`eval:fill-form` is a live path writing to an explicit `--out`; it should not
require a committed golden. The plan should:

- Reuse `runValidation(..., skipExpectedSnapshots: true)` for the pre-flight
  validation (mirror `run.mjs`), and never call `compareOrUpdateSnapshots`.
- State that `alex-i9-realistic/scenario.json` declares `"expectedSnapshots": []`
  (no golden file), so plain `eval:validate` stays green.

### 4. Handle all five response statuses, not three

The plan only mentions `success`/`partial`/`failed`. The status enum is five-wide:
`success | partial | no_fillable_fields | unsupported_format | failed`
(`form-fill.types.ts:3-8`), and the snapshot schema mirrors it
(`schemas/filled-form-snapshot.schema.json:46-55`).

Two concrete consequences:

- `buildFilledFormSnapshot` reads `response.summary.totalFields/filledCount/
  skippedCount` unconditionally (`snapshots.mjs:46-49`). For
  `no_fillable_fields`/`unsupported_format`/`failed`, `filledPdfBase64` is
  `null` and the summary may be sparse, so snapshotting will produce garbage or
  throw.
- The snapshot schema pins `response.outputMimeType` to the const
  `application/pdf`. A non-fill response that returns a different mime type
  would fail schema validation anyway.

Recommendation (agreeing with feedback-a's add-ons): treat `failed`,
`no_fillable_fields`, and `unsupported_format` as hard CLI failures with clear
messages; only `success` and `partial` proceed to snapshot, and only when
`filledPdfBase64` is non-null. Add a test per terminal status.

Note: the existing harness already throws on `status: 'failed'`
(`eval-runner/backend.mjs:76-87`). The new CLI is a separate path (it will not
call `runBackendHarness`), so it must replicate that guard itself — reuse the
same wording for consistency.

## Should-fix

### 5. Specify the multipart upload precisely

The endpoint uses `FileInterceptor('file', ...)` (`form-fill.controller.ts:27`),
so the multipart field name must be exactly `file`, with
`contentType: application/pdf` (must be in `allowedMimeTypes`,
`form-fill.config.ts`). From Node this is `FormData` + a `Blob`/`File` built
from `fixture.formPdfPath`. This is easy to get subtly wrong (wrong field name,
missing content-type) and worth pinning in the plan and a test.

### 6. Auth and client injection should mirror the exporter

The plan's `EVAL_AUTH_TOKEN` / `--auth-token` fallback matches the exporter
exactly (`exporter/client.mjs:14-27` uses `authorization: Bearer ${authToken}`).
For testability, structure the new module like the exporter: accept an
injectable `fetchImpl = globalThis.fetch` (and ideally an injectable PDF reader)
so CLI/unit tests don't need a live backend. The exporter's `fetchImpl`
parameter is the precedent to copy.

### 7. Backend-user identity: side artifact only, not the snapshot

feedback-a §5 is correct and the schema enforces it: the snapshot has
`additionalProperties: false` and no backend-user field
(`schemas/filled-form-snapshot.schema.json:6-17`), and
`buildFilledFormSnapshot` hardcodes fixture identity (`snapshots.mjs:41-44`).
So a `backendUserId` belongs only in an optional `--response-out` side artifact,
never in `filled-form.json`. Reuse the ingestor/exporter's existing "record the
authenticated backend user separately" approach rather than inventing a new
`me` call.

### 8. Test fixture for PDF reading is the real test-infra cost

Unit-testing the snapshot path requires a real filled fillable PDF to exercise
`pdf-lib` (the field-reading helper from §1). Options, in order of preference:
reuse a committed fillable form (`forms/i-9/form.pdf` or
`forms/rental-app-fillable/form.pdf`) and fill it in-test with pdf-lib to
produce a base64 fixture, or commit a tiny base64 fillable PDF fixture. The
plan's test list ("writes schema-valid filled-form.json", "missing
`filledPdfBase64` fails") should call out which fixture provides the bytes —
this is the part most likely to stall the test work.

## Agreements with feedback-a worth keeping

- `--filled-pdf-out` and `--response-out` are good additions; the snapshot must
  not contain `filledPdfBase64`.
- Document `eval:run` (deterministic test-DB harness that `resetDb()`s, hydrates
  fixture truth, and mocks the structured-AI fill via
  `generateStructured: () => ({ fillActions })`, `harness.ts:48-110`) vs
  `eval:fill-form` (live backend + real model). Their `actual` values come from
  fundamentally different sources, so divergent scores are expected, not a bug.
- Source-slug flow is diagnostic-only but worth a test:
  `summary.filledFields[].sourceSlugs` → `actual.sourceSlugs`
  (`snapshots.mjs:170`) → preserved by `eval:score --mode form`.

## Minor

- Token redaction is largely free here: the backend response never echoes the
  token, so `filled-form.json` and `--response-out` can't leak it via the body.
  Focus redaction on (a) never logging the `Authorization` header on HTTP error,
  and (b) not serializing request headers into `--response-out`. One small test
  covers it.
- `score.mjs --mode form` requires `--scenario` + `--filled-form` + `--out`
  (`score.mjs:132-135,155`). The `--form-score-report` convenience should shell
  out to / import that same entry so there's one canonical scorer, as the plan
  intends.
- orchestration.md currently frames Phase 4 as open-schema ingestion. Slot the
  "Form Fill From Backend Memory" phase as its own numbered phase (or a clearly
  labeled sub-phase) rather than renumbering open-schema, which is a distinct
  concern.

## Suggested checkpoint ordering

Per CLAUDE.md (backend plans should have test checkpoints):

1. Shared `pdf.mjs` helper + `backendRequire` hoist; unit test field-type
   mapping against a committed fillable form. **Checkpoint:** `node --test`.
2. `eval-runner/fill-form` module with injectable `fetchImpl`/pdf reader; arg
   parsing, env fallback, validation pre-flight. **Checkpoint:** CLI/unit tests.
3. Snapshot construction from a fake backend response (success + partial);
   terminal-status failures. **Checkpoint:** schema-valid `filled-form.json`.
4. Add `alex-i9-realistic` scenario (`scenario.json` + `start/prompt.md`,
   `expectedSnapshots: []`). **Checkpoint:** `pnpm eval:validate`.
5. Wire `package.json` `eval:fill-form`, optional `--form-score-report`/
   `--filled-pdf-out`/`--response-out`. **Checkpoint:** `pnpm eval:verify`.
6. Optional live smoke against a running backend.
</content>
</invoke>

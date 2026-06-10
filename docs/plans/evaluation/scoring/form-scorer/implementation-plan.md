# Backend-Memory Form Evaluation Runner Plan

## Summary

Implement `pnpm eval:fill-form`: a live backend-memory form-fill runner that
calls the real backend form-fill endpoint, writes a standard `filled-form.json`,
and optionally writes the filled PDF, redacted backend response, and form score
report.

This stays focused on the missing form runner, not a one-command E2E wrapper.
The intended chain remains:

```text
eval:ingest-documents
  -> eval:export-stored-preferences / eval:score --mode database
  -> eval:fill-form
  -> eval:score --mode form
  -> eval:score --mode combined
```

Use this correctly spelled plan path:

```text
docs/plans/evaluation/scoring/form-scorer/implementation-plan.md
```

Do not create the misspelled `implmentation-plan.md`. At the end, write
`implementation-summary.md` and update scoring `orchestration.md` and `TODO.md`.

## Key Changes

- Add CLI:
  ```bash
  pnpm eval:fill-form \
    --scenario <scenarioId> \
    --out <filled-form.json> \
    [--backend-url <url>] \
    [--auth-token <token>] \
    [--filled-pdf-out <filled.pdf>] \
    [--response-out <form-fill-response.json>] \
    [--form-score-report <file>]
  ```

- Defaults:
  - `--backend-url` -> `EVAL_BACKEND_URL` -> `http://localhost:3000`
  - `--auth-token` -> `EVAL_AUTH_TOKEN`, required
  - `--form-score-report` calls the existing form scorer after writing
    `filled-form.json`.

- Runtime behavior:
  - Load and validate the scenario fixture with expected snapshots skipped.
  - Build the existing deterministic `runPlan` only for expected values and
    snapshot classification.
  - Do not seed, reset, hydrate, or mutate backend memory.
  - POST the scenario form PDF to `/api/form-fill/pdf` using multipart field
    name `file`, content type `application/pdf`, and bearer auth.
  - Treat only `success` and `partial` responses with non-null
    `filledPdfBase64` as scorable.
  - Fail clearly on `failed`, `no_fillable_fields`, `unsupported_format`, HTTP
    errors, malformed JSON, invalid PDFs, or missing required response fields.
  - Decode the filled PDF, read filled fields, and feed
    `{ response, filledPdfFields }` into existing `buildFilledFormSnapshot()`
    logic.
  - Write `filled-form.json` without `filledPdfBase64`; write the decoded PDF
    only when `--filled-pdf-out` is passed.
  - Write `--response-out` as a redacted side artifact, replacing/removing
    `filledPdfBase64` and never serializing request headers or auth tokens.

- Shared implementation:
  - Add a shared eval PDF helper for reading filled PDF fields in the shape
    expected by snapshots.
  - Load `pdf-lib` using the existing backend `createRequire` pattern because
    it is not a root dependency.
  - Structure the runner with injectable `fetchImpl` and PDF reader for tests.

- Fixture/doc updates:
  - Add `examples/eval/scenarios/alex-i9-realistic/scenario.json` and
    `start/prompt.md`.
  - Set Alex realistic scenario `expectedSnapshots: []`; live fill output goes
    to explicit `--out`, not a committed golden snapshot.
  - Document the distinction:
    - `eval:run`: deterministic fixture/test-DB harness.
    - `eval:fill-form`: live backend-memory product-path runner.

## Test Plan

- Add CLI/unit tests for:
  - `--help`, missing args, env fallback, CLI override.
  - scenario validation happens before backend call.
  - multipart request uses field name `file`, PDF content type, and bearer auth.
  - `success` and `partial` write schema-valid `filled-form.json`.
  - terminal statuses fail clearly.
  - `success`/`partial` with missing `filledPdfBase64` fails.
  - malformed JSON, HTTP non-2xx, invalid filled PDF, and token leakage
    protections.
  - `--filled-pdf-out` writes a PDF and base64 is not written to
    `filled-form.json`.
  - `--response-out` writes a redacted response artifact.
  - optional `--form-score-report` reuses the canonical form scorer.

- Add snapshot/scoring tests for:
  - backend `summary.filledFields[].sourceSlugs` flowing into
    `actual.sourceSlugs`.
  - form scorer preserving source-slug agreement diagnostics.
  - profile-null skipped fields remaining abstention tests.
  - Alex realistic scenario fixture validating with no expected golden snapshot.

- Run:
  ```bash
  node --test examples/eval/scripts/fill-form.test.mjs examples/eval/scripts/scoring/form.test.mjs examples/eval/scripts/score.test.mjs
  pnpm eval:test
  pnpm eval:validate
  pnpm eval:verify
  ```

- Optional live smoke:
  ```bash
  export EVAL_BACKEND_URL=http://localhost:3000
  export EVAL_AUTH_TOKEN=<token>

  pnpm eval:fill-form \
    --scenario alex-i9-realistic \
    --out /private/tmp/alex-filled-form.json \
    --filled-pdf-out /private/tmp/alex-filled.pdf \
    --response-out /private/tmp/alex-form-fill-response.json \
    --form-score-report /private/tmp/alex-form-score-report.json
  ```

## Assumptions

- This PR implements the form runner only, not the full one-command E2E
  orchestrator.
- Backend memory is prepared before this command, usually by
  `eval:ingest-documents`, manual upload, or MCP/agent interaction.
- The existing `/api/form-fill/pdf` endpoint is the right product path.
- `filled-form.json` keeps fixture identity from the scenario; backend user
  identity is not added to the snapshot.
- No new backend endpoint is needed.
- `eval:score --mode form` remains the canonical scorer; `--form-score-report`
  is only a convenience.

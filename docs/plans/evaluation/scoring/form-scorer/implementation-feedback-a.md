# Form Scorer Plan Feedback A

## Overall

I agree with the direction. The missing piece is not another pure scorer; it is a live backend-memory form-fill runner that produces the existing `filled-form.json` artifact so the current form scorer can be reused.

The proposed chain is the right shape:

```text
eval:ingest-documents
  -> eval:export-stored-preferences / eval:score --mode database
  -> eval:fill-form
  -> eval:score --mode form
  -> eval:score --mode combined
```

This keeps the scoring boundary clean and avoids turning the ingestor into a large all-in-one orchestrator.

## Changes I Agree With

- Use the existing backend endpoint `POST /api/form-fill/pdf`.
  - This is the real product path.
  - It reads the authenticated backend user's active preferences, which is exactly what we want after `eval:ingest-documents`.

- Write a normal `filled-form.json` snapshot.
  - This lets `pnpm eval:score --mode form` remain the canonical scoring path.
  - It also keeps combined scoring unchanged.

- Do not seed, reset, hydrate, or mutate backend memory inside `eval:fill-form`.
  - The runner should assume memory was prepared by ingestion, manual upload, MCP, or another flow.
  - This keeps the form runner reusable across known-schema, open-schema, manual, and agent runs.

- Reuse the existing deterministic `runPlan`.
  - The existing `buildRunPlan()` already knows how to derive expected field values, source slugs, skip expectations, and snapshot classifications from the scenario fixture.
  - The new runner should not duplicate that expected-value logic.

- Fail on `status: failed`, HTTP failures, malformed JSON, invalid filled PDF, and missing `filledPdfBase64` for `success` / `partial`.
  - `partial` should still be scorable.
  - `failed` should not be silently converted into a form score.

## Changes I Would Make To The Plan

### 1. Fix the path typo

The plan says:

```text
docs/plans/evaluation/scoring/form-scorer/implmentation-plan.md
```

That should be:

```text
docs/plans/evaluation/scoring/form-scorer/implementation-plan.md
```

The file already exists at the correct spelling, so the implementation plan should not create a second misspelled path.

### 2. Add an Alex realistic scenario

The optional live smoke uses:

```bash
pnpm eval:fill-form --scenario alex-i9-realistic ...
```

But there is no committed `examples/eval/scenarios/alex-i9-realistic/` right now. The repo currently has Elena and Samir template-smoke scenarios only.

This PR should either:

- add `examples/eval/scenarios/alex-i9-realistic/`, or
- change the live smoke to use an existing scenario.

For the ingestion-to-form use case, I think adding an Alex realistic scenario is the better choice. It should point at:

```json
{
  "userId": "alex-i9-test",
  "corpusId": "realistic",
  "formId": "i-9"
}
```

It does not need to commit a golden expected `filled-form.json` if the goal is live backend scoring to an explicit `--out` path. The scenario just gives the runner a stable fixture identity and expected form-field truth.

### 3. Add an option to write the filled PDF

The plan writes `filled-form.json`, but the user-facing question is also "can we see it fill out the form?"

The CLI should support something like:

```bash
--filled-pdf-out <file>
```

or:

```bash
--artifacts-root <dir>
```

The snapshot should not include `filledPdfBase64`, but the runner should be able to decode it and write a PDF for visual inspection.

Recommended interface:

```bash
pnpm eval:fill-form \
  --scenario <scenarioId> \
  --out <filled-form.json> \
  [--filled-pdf-out <filled.pdf>] \
  [--response-out <form-fill-response.json>] \
  [--form-score-report <file>]
```

`--response-out` is useful because the backend response summary often explains why fields were skipped.

### 4. Be explicit that this is live-backend scoring, not the existing eval harness

The existing `pnpm eval:run --scenario ...` uses the backend test harness. It resets a test DB, hydrates preferences from fixture truth, and mocks the model fill actions.

The new `eval:fill-form` should be documented as different:

```text
eval:run       -> deterministic fixture/harness form-fill test
eval:fill-form -> live backend-memory form-fill snapshot runner
```

This distinction will prevent confusion when scores differ.

### 5. Add validation for backend user identity as diagnostics, not fixture identity

The plan correctly says the filled-form snapshot should keep fixture identity:

```text
scenario.userId, corpusId, formId
```

However, the authenticated backend user may differ from the eval fixture user, like the exporter/ingestor path. The runner should call `me` or otherwise record a `backendUserId` in a side artifact if it writes `--response-out`.

I would not put backend user identity into `filled-form.json` unless we intentionally change the snapshot schema. Keep it out of the canonical form scorer artifact.

### 6. Reuse snapshot construction, but expect a small adapter

`buildFilledFormSnapshot()` currently expects a `harnessResult` shaped like:

```js
{
  response,
  filledPdfFields
}
```

That is good. The new runner can build the same shape after:

1. calling `/api/form-fill/pdf`,
2. decoding `filledPdfBase64`,
3. reading filled PDF fields with `pdf-lib`.

The PDF field-reading helper currently lives inside the backend TS harness. The new JS CLI will probably need its own small helper or a shared eval-runner helper. I would avoid reaching into the backend test harness from the new script.

### 7. Add source-slug tests, but be careful what they prove

I agree with the test:

```text
backend source slugs flow into actual.sourceSlugs
```

This is important because source-slug agreement is only diagnostic, but it is useful for explaining whether the form fill used expected memory.

The test should assert both:

- `response.summary.filledFields[].sourceSlugs` reaches `filled-form.json`.
- `pnpm eval:score --mode form` preserves source-slug agreement diagnostics.

## Possible Follow-Up, Not Required In This PR

Do not build the one-command E2E wrapper yet. The manual chain is still useful because it lets us inspect each stage:

```text
ingestion-run.json
stored-preferences.json
database-score-report.json
form-fill-response.json
filled-form.json
form-fill-score-report.json
combined-score-report.json
```

A later wrapper can stitch those together once the artifacts stabilize.

## Recommended Updated CLI

I would slightly expand the proposed CLI:

```bash
pnpm eval:fill-form \
  --scenario <scenarioId> \
  --out <filled-form.json> \
  [--backend-url <url>] \
  [--auth-token <token>] \
  [--filled-pdf-out <file>] \
  [--response-out <file>] \
  [--form-score-report <file>]
```

The minimum implementation can still require only `--scenario`, `--out`, and auth.

## Recommended Test Additions

In addition to the plan's tests, I would add:

- `partial` backend response with a valid `filledPdfBase64` writes and scores a snapshot.
- `success` / `partial` response with `filledPdfBase64: null` fails.
- `no_fillable_fields` and `unsupported_format` are treated as failures for this eval runner unless we explicitly want to score those states.
- `--filled-pdf-out` writes a PDF and does not write base64 into `filled-form.json`.
- `--response-out` writes a redacted raw response artifact.
- an Alex realistic scenario validates and can be used by the fill-form CLI.

## Bottom Line

I would implement this PR. The only structural changes I would make before implementation are:

1. Add/plan the Alex realistic scenario explicitly.
2. Add `--filled-pdf-out` and probably `--response-out`.
3. Fix the implementation-plan path typo.
4. Document clearly that `eval:fill-form` is live-backend memory evaluation, while `eval:run` is the deterministic fixture harness.


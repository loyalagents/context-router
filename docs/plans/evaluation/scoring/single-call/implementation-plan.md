# Known-Schema Single-Call Evaluation Runner Implementation Plan

- Status: implementation plan
- Last updated: 2026-06-10

## Goal

Implement a single known-schema evaluation wrapper that runs the existing live
backend evaluation chain without hiding the intermediate artifacts:

```text
validate documents
  -> ingest documents
  -> export stored preferences
  -> score database
  -> fill form
  -> score form
  -> score combined
```

The wrapper should make the common live evaluation path easier to run while
preserving the separate stage artifacts needed to diagnose failures.

## Non-Goals

- Do not generate corpus documents.
- Do not implement open-schema slug discovery.
- Do not add backend endpoints.
- Do not replace the existing scorer, ingestor, exporter, or form runner.
- Do not treat low score values as wrapper failures.

## CLI Contract

Add:

```bash
pnpm eval:e2e-known-schema \
  --user <userId> \
  --corpus <corpusId> \
  --scenario <scenarioId> \
  --artifacts-root <dir> \
  [--documents-root <dir>] \
  [--backend-url <url>] \
  [--graphql-url <url>] \
  [--auth-token <token>] \
  [--reset-memory] \
  [--seed-preferences <file>] \
  [--skip-ensure-definitions] \
  [--no-auto-apply] \
  [--location-id <locationId>] \
  [--run-id <id>]
```

Defaults:

- `--documents-root` defaults to
  `examples/eval/users/<userId>/corpora/<corpusId>`.
- `--backend-url` falls back to `EVAL_BACKEND_URL`, then
  `http://localhost:3000`.
- `--graphql-url` falls back to `EVAL_GRAPHQL_URL`, then
  `http://localhost:3000/graphql`.
- `--auth-token` falls back to `EVAL_AUTH_TOKEN` and is required.
- `--run-id` is generated when omitted.

## Artifact Contract

Write these files under `--artifacts-root`:

- `validation-report.json`
- `ingestion-run.json`
- `stored-preferences.json`
- `database-score-report.json`
- `filled-form.json`
- `filled-form.pdf`
- `form-fill-response.json`
- `form-score-report.json`
- `combined-score-report.json`
- `evaluation-run.json`

Add `examples/eval/schemas/evaluation-run.schema.json`.

`evaluation-run.json` records the wrapper run id, fixture ids, sanitized URLs,
stage statuses, stage timings, stage outputs, artifact paths, final status, and
failure stage. It must be written after each stage attempt so failed runs still
leave a usable index artifact. Auth tokens must never be serialized.

## Implementation Steps

1. Add explicit validation-report support to database scoring.
   - Add optional `validationReportPath` to `scoreDatabase()` and
     `scoreDatabaseToFile()`.
   - Add `--validation-report <file>` to `pnpm eval:score --mode database`.
   - Keep the committed corpus `validation-report.json` as the default for
     direct scorer use.

2. Add the wrapper CLI.
   - Add `examples/eval/scripts/e2e-known-schema.mjs`.
   - Call the existing `run*` functions directly.
   - Do not use `ingest-documents --export-stored-preferences`.
   - Do not use `ingest-documents --database-score-report`.
   - Do not use `fill-form --form-score-report`.
   - Stop at the first nonzero stage exit code and mark later stages skipped.

3. Add package script.
   - Add `eval:e2e-known-schema` to the root `package.json`.

4. Add tests.
   - Cover wrapper argument parsing, defaults, env fallback, stage order,
     partial run artifacts, skipped stages, token redaction, and pass-through
     options.
   - Cover `--validation-report` database scoring behavior.

5. Close docs.
   - Write `implementation-summary.md`.
   - Update `docs/plans/evaluation/scoring/TODO.md`.
   - Update `docs/plans/evaluation/scoring/orchestration.md`.

## Verification

Run:

```bash
node --test examples/eval/scripts/e2e-known-schema.test.mjs examples/eval/scripts/score.test.mjs examples/eval/scripts/scoring/database.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Optional live smoke:

```bash
export EVAL_BACKEND_URL=http://localhost:3000
export EVAL_GRAPHQL_URL=http://localhost:3000/graphql
export EVAL_AUTH_TOKEN=<token>

pnpm eval:e2e-known-schema \
  --user alex-i9-test \
  --corpus realistic \
  --scenario alex-i9-realistic \
  --documents-root examples/eval/users/alex-i9-test/corpora/realistic \
  --artifacts-root /private/tmp/alex-known-schema-e2e \
  --reset-memory
```

## Rollback Notes

The wrapper is additive. If it causes issues, remove the package script,
`e2e-known-schema.mjs`, `evaluation-run.schema.json`, and wrapper tests. The
database scorer can continue using the committed validation report when
`--validation-report` is omitted.

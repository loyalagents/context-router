# PR 3 Observability And Run Comparison Summary

- Status: implemented
- Last updated: 2026-06-15

## What Changed

- Added manual model/config metadata to `evaluation-run.json`.
  - `eval:e2e-known-schema` now accepts `--model-label <label>`.
  - `EVAL_MODEL_LABEL` is used as an env fallback.
  - CLI labels take precedence over env labels.
  - Omitted labels are recorded as `{ "label": null, "source": "unspecified" }`.
- Updated `evaluation-run.schema.json` for the nested model object.
- Persisted terminal `eval:fill-form` response artifacts.
  - Terminal statuses still exit nonzero.
  - `filled-form.json` and filled PDFs are not written for terminal statuses.
  - Redacted `form-fill-response.json` is written before rejection when
    `--response-out` is provided.
- Improved known-schema E2E failure output.
  - Failed runs now print the artifacts root.
  - Fill-form failures also print the response artifact path.
- Added `pnpm eval:compare-runs`.
  - Supports one baseline and one or more comparison runs.
  - Reads required score artifacts and optional ingestion/storage context.
  - Prints database/form score deltas, changed wrong/missing facts, changed
    structural overfills, combined attribution deltas, ingestion counters, and
    stored preference counts.
  - Normalizes older evaluation-run artifacts that do not have model metadata.
  - Fails clearly on required identity mismatches.

## Docs

- Updated `examples/eval/README.md` with:
  - terminal response artifact behavior,
  - `--model-label` / `EVAL_MODEL_LABEL`,
  - live known-schema E2E command example,
  - `eval:compare-runs` usage.
- Updated `examples/eval/PLAYBOOK.md` with the live E2E comparison workflow.

## Verification

Passed:

```bash
node --test examples/eval/scripts/e2e-known-schema.test.mjs examples/eval/scripts/fill-form.test.mjs examples/eval/scripts/compare-runs.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

`pnpm eval:validate` and `pnpm eval:verify` still report the pre-existing Alex
realistic corpus warnings, but no validation errors.

## Follow-Up

- Capture and commit a representative successful live E2E artifact bundle only
  after a manual run with a live backend and valid auth token.
- Backend model introspection remains separate later work.
- If comparison output proves useful, promote overwrite provenance into
  `database-score-report.json` in a later scorer-contract PR.

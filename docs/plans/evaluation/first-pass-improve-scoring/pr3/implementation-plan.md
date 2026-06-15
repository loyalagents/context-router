# PR 3 Observability And Run Comparison Plan

- Status: implementation plan
- Last updated: 2026-06-15

## Goal

Make live known-schema E2E runs easier to label, debug, and compare without
changing backend product behavior or scorer report semantics.

This PR is eval-tooling only. It does not change
`database-score-report.json` semantics and does not commit live E2E artifacts.

## Checkpoint 1: Tests First

- Add known-schema E2E tests for `--model-label`, `EVAL_MODEL_LABEL`, CLI-over-
  env precedence, and schema-valid `evaluation-run.json` model metadata.
- Add form-fill tests proving terminal backend statuses write a redacted
  `form-fill-response.json` when `--response-out` is provided, while preserving
  nonzero exit and avoiding filled-form / filled-PDF artifacts.
- Add compare-runs tests for CLI validation, multi-run comparison output,
  missing optional context tolerance, old evaluation-run model normalization,
  and identity mismatch failures.

Run:

```bash
node --test examples/eval/scripts/e2e-known-schema.test.mjs examples/eval/scripts/fill-form.test.mjs examples/eval/scripts/compare-runs.test.mjs
```

Expect failures before implementation.

## Checkpoint 2: Model Metadata

- Add `--model-label <label>` to `eval:e2e-known-schema`.
- Add `EVAL_MODEL_LABEL` env fallback.
- Prefer CLI over env.
- Record model metadata in `evaluation-run.json`:

```json
{
  "model": {
    "label": "gemini-2.5-pro",
    "source": "manual"
  }
}
```

- If omitted, record:

```json
{
  "model": {
    "label": null,
    "source": "unspecified"
  }
}
```

- Update `evaluation-run.schema.json`.

## Checkpoint 3: Terminal Form-Fill Response Persistence

- Refactor `eval:fill-form` so it writes the redacted response artifact after
  receiving a backend JSON response and before terminal-status rejection.
- For `failed`, `no_fillable_fields`, and `unsupported_format`:
  - write `form-fill-response.json` when requested,
  - exit nonzero,
  - do not write `filled-form.json`,
  - do not write `filled-form.pdf`,
  - do not run form scoring.
- Make `eval:e2e-known-schema` failure output include the artifact root and the
  form-fill response artifact path when the fill-form stage fails.

## Checkpoint 4: Compare Runs Command

- Add:

```bash
pnpm eval:compare-runs --baseline <dir> --run <dir> [--run <dir>...]
```

- Compare each `--run` independently against `--baseline`.
- Require each run directory to contain:
  - `evaluation-run.json`
  - `database-score-report.json`
  - `form-score-report.json`
  - `combined-score-report.json`
- Use optional context from:
  - `ingestion-run.json`
  - `stored-preferences.json`
- Print compact stdout-only comparison output with:
  - run identity, status, and model label/source,
  - database score deltas,
  - form score deltas,
  - changed database wrong/missing fact keys,
  - changed form wrong/missing fields,
  - changed structural overfills,
  - combined stage-attribution deltas,
  - ingestion overwrite/blocking counters when available,
  - stored preference counts when available.
- Normalize older evaluation-run artifacts with no `model` field to
  `{ "label": null, "source": "unspecified" }` for comparison only.
- Fail clearly when baseline and run report identities differ.

## Checkpoint 5: Docs And Verification

- Add the `eval:compare-runs` package script.
- Update eval user docs with model-label and compare-runs examples.
- Run focused tests, then:

```bash
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

- Write `implementation-summary.md`.
- Update `docs/plans/evaluation/first-pass-improve-scoring/orchestration.md`
  and `docs/plans/evaluation/first-pass-improve-scoring/TODO.md`.

## Acceptance Criteria

- `evaluation-run.json` records explicit or unspecified model metadata.
- Terminal form-fill backend responses are persisted before failure exit.
- A reviewer can compare one or more E2E run directories with one command.
- Missing optional provenance/context artifacts do not fail comparison.
- Required identity mismatches fail clearly.
- The eval test and validation gates pass.

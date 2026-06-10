# Backend-Memory Form Evaluation Runner Summary

## Summary

Implemented `pnpm eval:fill-form`, a live backend-memory form-fill runner. The
command calls the existing `/api/form-fill/pdf` product endpoint, converts the
returned filled PDF into the existing `filled-form.json` snapshot shape, and can
optionally write the filled PDF, a redacted backend response artifact, and a
form score report.

This keeps form evaluation as an artifact boundary:

```text
prepared backend memory -> eval:fill-form -> filled-form.json -> eval:score --mode form
```

## Changed Behavior

- Added `examples/eval/scripts/fill-form.mjs` and package script
  `eval:fill-form`.
- Added `examples/eval/scripts/eval-runner/pdf.mjs`, which loads `pdf-lib` from
  the backend dependency tree and reads PDF fields in the snapshot-compatible
  shape.
- Added `examples/eval/scripts/fill-form.test.mjs` covering CLI parsing,
  multipart upload shape, status handling, redaction, side artifacts, scoring,
  source-slug propagation, and PDF field reading.
- Added `examples/eval/scenarios/alex-i9-realistic/` with
  `expectedSnapshots: []` for live output-only form-fill evaluation.
- Updated eval docs to distinguish deterministic `eval:run` from live
  backend-memory `eval:fill-form`.

## Command Interface

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

Defaults:

- `--backend-url` -> `EVAL_BACKEND_URL` -> `http://localhost:3000`
- `--auth-token` -> `EVAL_AUTH_TOKEN`, required

The runner does not seed, reset, hydrate, or mutate backend memory.

## Verification

Ran:

```bash
node --test examples/eval/scripts/fill-form.test.mjs
node --test examples/eval/scripts/fill-form.test.mjs examples/eval/scripts/scoring/form.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Results:

- `pnpm eval:test`: passed, 197 tests.
- `pnpm eval:validate`: passed with 0 errors and the existing 11 warning-only
  Alex realistic corpus realism warnings.
- `pnpm eval:verify`: passed.

## Follow-Ups

- Run a live backend smoke using `eval:ingest-documents`, exporter/database
  scoring, `eval:fill-form`, form scoring, and combined scoring.
- Consider a later one-command orchestration wrapper only after the artifact
  chain is stable.
- Continue separate open-schema work for MCP/Codex/Claude runners and/or
  upload-level schema discovery.

# Known-Schema Single-Call Evaluation Runner Implementation Summary

- Status: implemented
- Last updated: 2026-06-10

## What Changed

Implemented `pnpm eval:e2e-known-schema`, a single wrapper for the known-schema
live backend evaluation chain:

```text
validate documents
  -> ingest documents
  -> export stored preferences
  -> score database
  -> fill form
  -> score form
  -> score combined
```

The wrapper calls the existing runner functions directly and writes every stage
artifact under `--artifacts-root`, plus a new schema-validated
`evaluation-run.json` index artifact.

## Behavior

- Uses existing document files only; document generation remains separate.
- Defaults `--documents-root` to
  `examples/eval/users/<user>/corpora/<corpus>`.
- Stops at the first nonzero stage exit code and marks later stages skipped.
- Treats low but scorable database/form/combined scores as successful stage
  outputs.
- Writes partial `evaluation-run.json` on failure.
- Redacts auth tokens from wrapper output and artifacts.
- Sanitizes URL userinfo in `evaluation-run.json`.

## Supporting Changes

- Added `examples/eval/schemas/evaluation-run.schema.json`.
- Added package script `eval:e2e-known-schema`.
- Updated database scoring to accept an explicit `--validation-report <file>`
  for preview/external document roots while preserving the committed report
  default.

## Tests Added

- Wrapper argument parsing, env fallback, default document root, CLI override,
  stage order, pass-through flags, shortcut avoidance, schema-valid
  `evaluation-run.json`, token redaction, and partial failure/skipped stages.
- Database scorer and score CLI coverage for explicit validation report paths.

## Verification

Ran:

```bash
node --test examples/eval/scripts/e2e-known-schema.test.mjs examples/eval/scripts/score.test.mjs examples/eval/scripts/scoring/database.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

All commands passed. `eval:validate` still reports the existing warning-only
realism issues for Alex's committed realistic corpus; there are no validation
errors.

## Follow-Ups

- Run a live backend smoke with `eval:e2e-known-schema` and document the output
  quality.
- Decide whether a later generic config-driven pipeline is useful after more
  live runs.
- Keep open-schema/MCP evaluation separate from this known-schema wrapper.

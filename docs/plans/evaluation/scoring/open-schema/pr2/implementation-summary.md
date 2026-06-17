# Open-Schema PR2 Static Scoring Implementation Summary

- Status: implemented
- Last updated: 2026-06-17

## Summary

PR2 added deterministic open-schema scoring over PR1's
`memory-snapshot.json`. The repo can now produce open-schema database and
combined reports from static artifacts without enabling MCP open mode or
changing known-schema report contracts.

Known-schema `stored-preferences.json`, `database-score-report.json`, and
`combined-score-report.json` remain stable.

## Implemented Behavior

- Added `pnpm eval:score --mode open-schema-database`.
- Added `pnpm eval:score --mode open-schema-combined`.
- Added `examples/eval/scripts/scoring/open-schema-database.mjs`.
- Added `examples/eval/scripts/scoring/open-schema-combined.mjs`.
- Added `examples/eval/schemas/open-schema-database-score-report.schema.json`.
- Added `examples/eval/schemas/open-schema-combined-score-report.schema.json`.
- Reused known-schema fixture-readiness and fact collection helpers.
- Added focused Node tests for the new scorers and CLI modes.

## Database Report Behavior

`open-schema-database-score-report.json` uses `scoreType:
"open-schema-database-storage"` and validates the input `memory-snapshot.json`
before scoring.

Known-present facts are classified by value recovery first:

- accepted slug recovery;
- novel slug recovery;
- suggestion-only recovery;
- wrong active value;
- missing active value.

Intentionally missing facts are classified by active-memory hallucination:

- absent correctly;
- withheld value found under any active slug;
- accepted missing key populated;
- both value and key hallucinated.

The report preserves deterministic diagnostics for conflicts, canonical/alias
slug recovery, unscored active preferences, unscored suggestions, duplicate
definition slugs, empty definition descriptions, missing `definitionId`
references, and definition baseline ID/slug diffs.

Summary diagnostics include a row-level conflict count and separate
intentionally-missing hallucination counters for value-only, key-only,
both-value-and-key, and total active hallucinations.

## Combined Report Behavior

`open-schema-combined-score-report.json` uses `scoreType:
"open-schema-combined"` and joins open database rows with the existing
`form-fill-score-report.json` by `factKey`.

The combined report keeps form scoring semantics unchanged and records stage
attribution around open-schema memory outcomes:

- memory recovered plus form correct/wrong/missing;
- memory missing plus form correct/wrong/missing/hallucinated;
- suggestion-only plus form status;
- missing fact absent or hallucinated plus form absent/hallucinated/other;
- form facts with no scored memory row as `not_scored`.

## Verification

Commands run:

```bash
node --test examples/eval/scripts/scoring/open-schema-database.test.mjs examples/eval/scripts/scoring/open-schema-combined.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Results:

- Targeted open-schema scorer and score CLI tests passed: 13 tests.
- Full eval script test suite passed: 279 tests.
- Eval validation passed with the existing 11 Alex realism warnings and no
  errors.
- `pnpm eval:verify` passed.

## Remaining Checkpoints

- Checkpoint 3: enable MCP `--schema-mode open --form-mode backend` with the
  deterministic command adapter first.
- Checkpoint 4: enable live Claude open-schema runs without adding identity
  tooling or artifact reliability labels.
- Checkpoint 5: design upload-level schema discovery after MCP open-schema
  scoring works.

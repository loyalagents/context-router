# Scorer Implementation Summary

- Status: implemented
- Last updated: 2026-06-01

## Summary

Implemented the first-pass scoring layer as a pure artifact scorer. It reads
stored preference snapshots, filled-form snapshots, and committed fixture truth,
then writes deterministic database, form-fill, and combined score reports.

The scorer does not call the backend, upload documents, run ingestion, mutate
preferences, or invoke models.

## Implemented Behavior

- Added `pnpm eval:score` with `database`, `form`, and `combined` modes.
- Added schemas for stored-preferences input and all three score reports.
- Added `examples/eval/scoring/fact-storage-map.v1.json` for canonical and
  alias slug expectations.
- Added deterministic value matching for typed JSON values, date variants, and
  SSN formatted/digits-only values.
- Added database scoring over active stored preferences:
  - known-present recovery and accepted-slug accuracy
  - wrong slug, wrong value, conflict, and missing classifications
  - conflicts are reported separately and do not count as clean correctness
  - intentionally missing accepted-key and withheld-value checks
  - ignored non-active rows and unscored extra rows
  - fixture-readiness gating from validation reports
  - `stored-preferences.json` must declare `statusesScored: ["ACTIVE"]`
- Added form-fill score aggregation over existing `filled-form.json` snapshots:
  - full snapshot identity checks for `scenarioId`, `userId`, `corpusId`, and
    `formId`
  - should-fill, abstention-test, structural-skip, and unsupported denominators
  - source-slug agreement as a diagnostic
- Added combined fact-key reports with closed stage-attribution buckets.
- Tightened database, form-fill, and combined report schemas so summary fields
  and classifications are part of the machine-readable contract.
- Added optional manifest `intentionallyMissing[].withheldValue` support for
  future withheld-value leak fixtures.

## Verification

Commands run:

```bash
node --test examples/eval/scripts/scoring/*.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Results:

- scorer tests passed
- full eval script test suite passed
- eval validation passed with the existing Alex realism warnings and no errors
- `pnpm eval:verify` passed

## Known Limitations

- No stored-preferences exporter yet.
- No document ingestor yet.
- No Codex/Claude MCP runner yet.
- No derivation rules, semantic slug similarity, smart-search scoring, or
  LLM-judged equality.
- Accepted alias slugs count as correct in this MVP, though canonical/alias match
  booleans are preserved for future stricter scoring.

# Corpus Truth Report Implementation Summary

## Implemented

- Added `corpusTruth` to `validation-report.json`.
- The report records per document:
  - declared facts proven present
  - declared facts missing
  - declared facts unsupported by deterministic checks
  - effective forbidden facts proven absent
  - forbidden facts present
  - warning-only forbidden checks
  - skipped forbidden checks
- Added summary counts:
  - documents checked
  - facts proven present
  - facts missing
  - unsupported declared facts
  - facts proven absent
  - forbidden facts present
  - warning-only absence checks
  - skipped absence checks
  - hard failures
- Kept `issues[]` behavior unchanged for pass/fail.
- Updated `PLAYBOOK.md` to tell users to inspect `corpusTruth` before using a corpus for extraction benchmarking.
- Refreshed Elena and Nina validation reports.

## Nina Report Status

Nina focused validation passes with zero hard failures. The report now shows:

- 100 documents checked
- 294 facts proven present
- 299 effective forbidden facts proven absent
- 18 unsupported declared facts
- 0 hard failures

## Tests

- Added tests for corpus-truth report records covering proven present, missing, unsupported, proven absent, warning-only checks, and deterministic report output.

## Verification

- `pnpm eval:test`
- `pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report`
- `pnpm eval:validate`
- `pnpm eval:verify`

All commands passed.

## Remaining Gaps

- The report is a deterministic corpus-truth ledger, not extraction scoring.
- Backend document ingestion, extraction snapshots, and extraction-quality scoring remain future work.
- Fuzzy matching and stale/conflicting cue validation remain future validation work.

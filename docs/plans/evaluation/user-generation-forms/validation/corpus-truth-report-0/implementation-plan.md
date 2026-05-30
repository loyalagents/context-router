# Corpus Truth Report Implementation Plan

## Goal

Make the contain and does-not-contain validation status inspectable per document in `validation-report.json`.

## Scope

- Add a deterministic `corpusTruth` section to validation reports.
- Record per-document declared facts proven present, missing, and unsupported by deterministic checks.
- Record per-document effective forbidden facts proven absent, present, warning-only, or skipped.
- Keep existing `issues[]` behavior unchanged for pass/fail.
- Add summary counts for documents checked, facts proven present, facts proven absent, unsupported declared facts, warning-only absence checks, skipped absence checks, and hard failures.
- Update the playbook and validation TODO so users know to inspect the corpus-truth section before extraction benchmarking.

## Checkpoints

1. Add truth-record collection during document body validation.
2. Add stable report summary generation.
3. Add tests for pass, fail, unsupported, warning-only, and deterministic report output.
4. Refresh committed validation reports after the report shape changes.
5. Update closeout docs and TODO.

## Acceptance

- `validation-report.json` explains what was actually proven for each document.
- Unsupported facts are visible instead of being implied as validated.
- Repeated `--write-report` runs produce byte-identical report files.
- Nina focused report has zero hard failures and includes corpus-truth summary counts.

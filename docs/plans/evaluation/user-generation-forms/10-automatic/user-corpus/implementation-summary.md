# 10-Document I-9 User Corpus Workflow Implementation Summary

## What Changed

- Added modular eval commands:
  - `pnpm eval:plan-corpus`
  - `pnpm eval:repair-generation`
  - `pnpm eval:promote-preview`
- Extended `pnpm eval:validate` with preview support:
  - `--documents-root <previewRoot>`
  - `--report-out <path>`
- Pruned old active large fixtures:
  - removed `examples/eval/users/nina-meera-patel`
  - removed `examples/eval/scenarios/nina-meera-patel-i9-realistic`
  - removed `examples/eval/users/elena-marquez/corpora/realistic`
  - removed `examples/eval/scenarios/elena-marquez-i9-section1`
- Retargeted active docs and tests to the smaller template-smoke fixtures and
  temp-only validation corpora.
- Refreshed Elena's committed `template-smoke` validation report to include the
  current `corpusTruth` report shape.

## Files Added Or Updated

- Added `examples/eval/scripts/plan-corpus.mjs`
- Added `examples/eval/scripts/repair-generation.mjs`
- Added `examples/eval/scripts/promote-preview.mjs`
- Added targeted tests for all three new commands.
- Added a no-Vertex temp-repo workflow test that runs plan -> manifest ->
  preview generate -> preview validate -> promote.
- Updated `examples/eval/scripts/validate.mjs` and `validate.test.mjs`.
- Hardened `eval:promote-preview` so preview-validation failures restore the
  prior `manifest.json` state instead of leaving a generated manifest behind.
- Hardened `eval:promote-preview` post-copy failure handling so committed
  validation failures restore the prior manifest, validation report, and
  document tree.
- Hardened `eval:repair-generation` so repair prompts use the plan document
  metadata, including future per-document forbidden facts, and so mixed
  document/non-document failures do not call the generator.
- Updated `examples/eval/README.md`, `examples/eval/PLAYBOOK.md`, and
  `examples/eval/users/elena-marquez/README.md`.
- Updated root `package.json` scripts.

## Commands Run

```bash
node --test examples/eval/scripts/plan-corpus.test.mjs examples/eval/scripts/repair-generation.test.mjs examples/eval/scripts/promote-preview.test.mjs examples/eval/scripts/validate.test.mjs
node --test examples/eval/scripts/plan-corpus.test.mjs examples/eval/scripts/validate.test.mjs examples/eval/scripts/repair-generation.test.mjs examples/eval/scripts/promote-preview.test.mjs examples/eval/scripts/user-corpus-workflow.test.mjs
node --test examples/eval/scripts/repair-generation.test.mjs examples/eval/scripts/promote-preview.test.mjs
pnpm eval:validate --user elena-marquez --corpus template-smoke --write-report
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Final result:

- `pnpm eval:test`: passed, 104 tests.
- `pnpm eval:validate`: passed with 2 users, 2 corpora, 6 forms, 2 scenarios,
  and 7 templates.
- `pnpm eval:verify`: passed.

## Failures Encountered

- Existing validator tests initially failed because they still referenced the
  removed Elena realistic corpus and Nina validation report.
- The first repair test exposed a grouping bug where document-index issues were
  not associated with the same entries returned by document id; fixed by sharing
  one entry object per manifest document.
- A forbidden-fact test had assumed the first fixture document did not declare
  SSN; the new temp fixture did, so the test now clears declared facts before
  checking forbidden-value behavior.
- Elena's committed `template-smoke` validation report was stale after adding
  `corpusTruth`; refreshed with `--write-report`.
- The added preview-shape test initially asserted an exact temp path for an
  unlisted file; relaxed it to assert the unlisted preview filename while still
  verifying the preview-root validation path.
- Follow-up PR feedback identified a latent repair prompt asymmetry for
  per-document forbidden facts and a post-copy promote rollback gap; both are now
  covered by regression tests.

## Remaining Follow-Ups

- Add a single E2E wrapper command after the modular commands are exercised on a
  real new user.
- Add richer realism checks once the correctness repair loop is stable.
- Extend `eval:plan-corpus` with additional form-specific archetype catalogs
  after I-9 is proven.

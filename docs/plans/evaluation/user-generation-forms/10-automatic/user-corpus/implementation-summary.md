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
- Tightened `eval:repair-generation` to reject manifest/corpus-plan document
  drift instead of falling back to weaker manifest-only prompt metadata.
- Refined the intentionally-missing phone warning so I-9 identifier lines such
  as I-94, USCIS, alien registration, and foreign passport fields do not look
  like phone-number leaks.
- Clarified `eval:repair-generation` reports so non-blocking warnings are
  recorded as `warningDocumentIds` and `remainingWarnings`, while
  `failedDocumentIds` and `remainingIssues` stay focused on blocking failures.
- Changed `eval:plan-corpus --count` validation to derive the supported value
  from the I-9 archetype catalog length instead of a separate literal.
- Marked the superseded 100-document plan docs as historical and retargeted
  active orchestration/validation notes away from deleted Nina/Elena realistic
  fixtures.
- Updated `examples/eval/README.md`, `examples/eval/PLAYBOOK.md`, and
  `examples/eval/users/elena-marquez/README.md`.
- Updated root `package.json` scripts.

## Commands Run

```bash
node --test examples/eval/scripts/plan-corpus.test.mjs examples/eval/scripts/repair-generation.test.mjs examples/eval/scripts/promote-preview.test.mjs examples/eval/scripts/validate.test.mjs
node --test examples/eval/scripts/plan-corpus.test.mjs examples/eval/scripts/validate.test.mjs examples/eval/scripts/repair-generation.test.mjs examples/eval/scripts/promote-preview.test.mjs examples/eval/scripts/user-corpus-workflow.test.mjs
node --test examples/eval/scripts/repair-generation.test.mjs examples/eval/scripts/promote-preview.test.mjs
node --test examples/eval/scripts/plan-corpus.test.mjs examples/eval/scripts/repair-generation.test.mjs
node --test examples/eval/scripts/validate.test.mjs examples/eval/scripts/repair-generation.test.mjs
pnpm eval:validate --user elena-marquez --corpus template-smoke --write-report
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Final result:

- `pnpm eval:test`: passed, 107 tests.
- `pnpm eval:validate`: passed with 2 users, 2 corpora, 6 forms, 2 scenarios,
  and 7 templates, with 0 warnings.
- `pnpm eval:verify`: passed.

Manual local E2E smoke run:

- Created and generated a temporary `alex-i9-test` realistic I-9 corpus with 10
  documents using Vertex.
- Initial preview validation failed on deterministic omissions:
  - document 001 omitted `identity.dateOfBirth`.
  - document 003 omitted `identity.legalName`.
  - document 006 emitted a conservative missing-phone warning.
- `pnpm eval:repair-generation` repaired the blocking omissions in one repair
  round.
- `pnpm eval:promote-preview` promoted the repaired preview and
  `pnpm eval:verify` passed locally.
- The temporary `alex-i9-test` fixture was removed from the PR scope after the
  smoke run to keep committed examples centered on stable canonical fixtures.

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
- Follow-up PR feedback identified stale 100-document plan docs and a quiet
  manifest/plan drift fallback in repair; both are now addressed, with drift
  covered by a regression test.
- The Alex local smoke run exposed a phone-warning false positive caused by an
  I-94 number and a confusing repair report where warning-only documents were
  shown as failed; both are now covered by regression tests.

## Remaining Follow-Ups

- Add a single E2E wrapper command after the modular commands are exercised on a
  few more real new users.
- Add richer realism checks once the correctness repair loop is stable.
- Extend `eval:plan-corpus` with additional form-specific archetype catalogs
  after I-9 is proven.

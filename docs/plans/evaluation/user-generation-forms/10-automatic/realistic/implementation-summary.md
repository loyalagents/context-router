# Realistic Corpus Generation V2 Implementation Summary

## What Changed

- Replaced `corpus-plan.json` with a schema-breaking V2 contract:
  `artifactWorld`, `factContractDefaults.forbid`, per-document
  `sourceSpec`, `factContract`, and `evaluationRole`.
- Kept `manifest.json` as the compact V1 inventory projection. Manifest
  `documents[].factKeys` now comes from `factContract.include`.
- Rebuilt the I-9 planner around ten source artifact families:
  uploaded ID OCR, SSN OCR, status-aware work authorization support, resident
  portal lease export, utility JSON export, saved I-9 field export, offer
  email, onboarding YAML export, stale contact ticket, and newsletter noise.
- Added deterministic `artifactWorld` context from `userId + corpusId`, with
  collision checks against canonical profile facts.
- Rewrote generation and repair prompts around artifact identity, capture mode,
  source metadata, native signals, world slices, output format, and a separated
  fact contract.
- Added warning-only realism lints for eval-language leakage, missing native
  signals, source length mismatch, stale cue absence, repeated Markdown/title
  skeletons, and phone-like source values when `contact.phone` is intentionally
  missing.
- Migrated the checked-in Alex realistic corpus to V2 source artifacts and
  refreshed its manifest plus validation report.

## Schema Decisions

- `corpus-plan.json` is V2 only; V1 plan fields are intentionally rejected.
- `manifest.json` stays V1 so existing manifest-only corpora and downstream
  inventory consumers do not need to understand planning-only metadata.
- Repair remains focused on blocking deterministic validation failures.
  Realism lints are reported as warnings and are not auto-repaired.
- Source-only phone-like values remain warning-only until there is a source-fact
  ownership model.

## Verification

```bash
node --test examples/eval/scripts/plan-corpus.test.mjs examples/eval/scripts/generate.test.mjs examples/eval/scripts/validate.test.mjs examples/eval/scripts/repair-generation.test.mjs examples/eval/scripts/promote-preview.test.mjs examples/eval/scripts/user-corpus-workflow.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

All commands passed. The final `pnpm eval:verify` result was:

```text
eval validation passed
profiles=3 corpora=3 forms=6 scenarios=2 templates=7 errors=0 warnings=0
```

## Preview Status

- No live Vertex preview was promoted in this batch.
- The committed Alex realistic corpus was manually migrated to the new V2
  source-artifact inventory and validates with zero errors and zero warnings.

## Follow-Ups

- Add realism-oriented repair that preserves deterministic fact truth while
  improving source genre, density, native signals, and document voice.
- Add the later document ingestion runner:
  documents -> extracted facts -> scoring -> form-fill snapshot.
- Add a source-fact ownership model before permitting source-only phone numbers
  or other third-party contact values without warnings.

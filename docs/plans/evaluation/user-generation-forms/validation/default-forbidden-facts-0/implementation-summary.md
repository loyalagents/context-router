# Default Forbidden Facts Implementation Summary

## Implemented

- Added optional top-level `defaultForbiddenFactKeys[]` to `corpus-plan.schema.json`.
- Added schema duplicate rejection for top-level and document-level forbidden
  fact arrays.
- Kept default forbidden facts plan-owned; `manifest.json` projection still omits default and document-level forbidden metadata.
- Added default forbidden reference validation:
  - `CORPUS_PLAN_DEFAULT_FORBIDDEN_FACT_AREA`
  - `CORPUS_PLAN_DEFAULT_FORBIDDEN_FACT_MISSING`
- Added `CORPUS_PLAN_FORBIDDEN_FACT_CONFLICT` when a document lists the same fact in `factKeys[]` and `forbiddenFactKeys[]`.
- Added shared effective-forbidden computation:
  - top-level `defaultForbiddenFactKeys[]`
  - plus document-level `forbiddenFactKeys[]`
  - plus applicable `intentionallyMissing[].factKey`
  - minus the document's declared `factKeys[]`
- Derived intentionally missing facts apply to current, non-noise `extract` and `corroborate` documents.
- Updated generation prompts to include effective forbidden keys and only non-null effective forbidden values.

## Nina Corpus Update

- Moved Nina's repeated baseline forbidden facts into top-level
  `defaultForbiddenFactKeys[]`:
  - `identity.ssn`
  - `contact.email`
  - `employment.workEmail`
  - `contact.phone`
  - `workAuthorization.uscisANumber`
  - `workAuthorization.i94AdmissionNumber`
  - `workAuthorization.foreignPassportNumber`
- Removed duplicated baseline entries from document-level `forbiddenFactKeys[]`.
- Left document-specific additions, such as noise-document legal name and street-address exclusions, at document level.

## Tests

- Added tests for schema acceptance, unexpected field rejection, invalid default refs, manifest projection, effective default body checks, fact-key subtraction, document-level conflicts, and prompt effective forbidden values.

## Verification

- `pnpm eval:validate --user nina-meera-patel --corpus realistic --plan-only`
- `pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report`
- `pnpm eval:test`
- `pnpm eval:validate`
- `pnpm eval:verify`

All commands passed after fixture repairs from the positive-check batch.

## Remaining Gaps

- Null forbidden facts remain warning-only only when a conservative pattern
  scan is eligible for that document; otherwise they are skipped.
- Stale/conflicting documents still need a separate cue contract.

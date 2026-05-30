# First Corpus Truth Validation Update Implementation Summary

- Status: implemented
- Date: 2026-05-28

## Implemented Issue Codes

- `CORPUS_PLAN_FORBIDDEN_FACT_AREA`: `documents[].forbiddenFactKeys[]` points at
  a profile object/area instead of a leaf fact.
- `CORPUS_PLAN_FORBIDDEN_FACT_MISSING`: `documents[].forbiddenFactKeys[]` points
  at a fact that does not exist in the profile.
- `DOCUMENT_FORBIDDEN_FACT_PRESENT`: a document body contains a non-null value
  for one of its plan-owned forbidden facts.
- `DOCUMENT_NOISE_FACT_LEAK`: a noise or ignored document body contains a
  high-confidence current identifier.
- `DOCUMENT_FACT_VALUE_MISSING`: expanded to cover date of birth, ZIP, state,
  and citizenship status for `extract` and `corroborate` documents.
- `DOCUMENT_MISSING_FACT_PRESENT`: expanded with conservative warning-level
  checks for intentionally missing work-authorization identifier patterns.

## Schema Changes

`examples/eval/schemas/corpus-plan.schema.json` now accepts optional
`documents[].forbiddenFactKeys: string[]`.

`forbiddenFactKeys[]` remains plan-owned. It is not projected into
`manifest.json`, and the manifest projection tests assert that it stays out of
the manifest.

## Matcher Behavior

Exact/variant matching now covers:

- email and work email exact text
- SSN with dashes, spaces, or digits only
- USCIS/A-number with bare digits, `A` prefix, `A-` prefix, or `A ` prefix
- ISO, U.S. slash, and long month date forms for an explicit date-fact
  allow-list
- ZIP exact text
- state abbreviation and full state name
- U.S. citizen and lawful-permanent-resident status variants

SSN, USCIS/A-number, and two-letter state variants require token boundaries so
the matcher does not treat a value embedded inside a longer account or id
string as a corpus-truth hit.

Pattern-only checks for null facts remain warning-level and conservative. They
require value-like text for phone, USCIS/A-number, I-94, and foreign passport
numbers. Null `forbiddenFactKeys[]` values do not produce exact forbidden
errors; they rely on these conservative warnings when value-like patterns are
present.

Known matcher trade-offs:

- USCIS/A-number warnings use an `A` plus 7-9 digit shape. This can catch
  stray ID-column values that look like alien numbers, so it stays warning-only.
- I-94 and foreign-passport warnings require nearby labels and at least one
  digit. A terse label such as `Passport: AB1234567` is intentionally missed in
  this first pass.
- Citizenship status variants are still not exhaustive for every I-9 status;
  unmodeled statuses fall back to exact raw text matching.
- `DATE_FACT_KEYS` intentionally includes date facts that are not yet all hard
  positive checks. Promoting one into `isHighConfidenceFactKey()` should happen
  with focused fixture validation because it can create Elena-style body
  repairs for extract/corroborate documents.

## Nina Corpus-Plan Update Strategy

The Nina 100-document `corpus-plan.json` now has explicit
`forbiddenFactKeys[]` on every document.

Noise and ignored documents forbid legal name, personal email, work email, SSN,
USCIS/A-number, current street address, phone, I-94 number, and foreign passport
number.

Non-noise documents forbid sensitive identifiers that are not listed in that
document's `factKeys[]`: SSN, personal email, work email, phone, USCIS/A-number,
I-94 number, and foreign passport number.

The manifest did not need to change because forbidden facts stay plan-owned.

This update intentionally duplicates a baseline forbidden list across many
Nina documents. All 100 Nina documents now carry `forbiddenFactKeys[]`, but
there are only 7 distinct lists and 44 documents share the same 7-key baseline.
That keeps the V1 contract explicit, but it is plan ergonomics debt. A future
`defaultForbiddenFactKeys[]` or effective-default layer should let
per-document plans carry only document-specific exclusions.

Noise documents also keep the dedicated `DOCUMENT_NOISE_FACT_LEAK` safety
check. To avoid duplicate reports, noise leak checks skip facts already covered
by that document's `forbiddenFactKeys[]`; the dedicated issue code still catches
missed noise defaults when a plan forgets to forbid a high-confidence current
identifier.

## Fixture Corrections

The expanded positive checks found a few Elena fixture bodies where `factKeys[]`
already claimed facts that the body did not contain. For this batch, the
manifest metadata is treated as the intended corpus truth contract, so the
document bodies were corrected when the metadata looked plausible for the
document type.

- `004-birth-record-summary.txt`: kept `workAuthorization.citizenshipStatus` in
  metadata and added an explicit U.S. citizen status line. A birth record
  summary is plausible corroborating identity/citizenship context.
- `011-library-card-profile.md`: kept the declared current address facts and
  added a mailing address line. A library card profile is plausible
  medium-authority current contact/address evidence.
- `021-voter-registration-reminder.txt`: kept the declared current address
  facts and changed the body to list the full residential address, not just
  city/state/ZIP. Voter registration reminders are plausible address-contact
  evidence.
- `025-personal-crm-export.json`: kept the declared current address facts and
  added street/unit fields alongside city/state/ZIP. A personal CRM export is
  plausible current contact/address evidence.

If future review decides one of these documents should be intentionally partial
or weaker evidence, the right fix is to remove the overclaimed `factKeys[]`
instead of making the body richer.

## Commands Run

```bash
pnpm eval:test
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
pnpm eval:validate
pnpm eval:verify
```

All commands passed with zero errors. Focused Nina validation passed with zero
warnings, and full validation passed with zero warnings.

## Remaining Validation Gaps

- Fuzzy name/address matching is still deferred.
- Stale, mixed, conflicting, and guardrail cue hardening is still deferred.
- Extraction-specific expected fact snapshots are still deferred.
- Corpus-level intentionally missing facts are not yet auto-expanded into full
  hard negative checks for every current authoritative document.
- Corpus-level/default forbidden facts are not yet available, so large plans
  still repeat common per-document exclusions.
- Plan/manifest matching uses document id first and path second so forbidden
  checks can still run during drift diagnostics. If a badly drifted plan reuses
  an id/path for the wrong document, it can attach forbidden checks to the wrong
  body until the drift is fixed.
- Backend document ingestion and extraction scoring were intentionally not added
  in this batch.

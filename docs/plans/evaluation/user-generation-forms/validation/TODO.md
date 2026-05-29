# Eval Fixture Validation TODO

This file tracks validation work for the reusable synthetic-user form
evaluation fixtures. It is the canonical backlog for validation improvements
that affect `examples/eval/**`, including the 100-document corpus work tracked
under `../100-doc-goal/`.

## Current Validation Boundary

Current validation is useful, but it is not yet a full corpus-truth oracle.

`pnpm eval:validate` currently validates:

- profile, manifest, corpus-plan, scenario, field-map, template, and
  filled-form snapshot schemas
- generated seed preference determinism from `profile.yaml`
- seed preference slug existence and value-type compatibility against the
  backend preference catalog
- corpus plan category counts, path safety, ids, output-extension consistency,
  challenge tags, noise metadata, and profile fact references
- manifest/document inventory, including missing files, unlisted files, unsafe
  paths, symlinks, duplicate ids, and duplicate paths
- plan/manifest drift when both `corpus-plan.json` and `manifest.json` exist
- field-map exhaustiveness against `fields.generated.json`
- form-mapped fact references against profile leaf facts
- coverage metadata: every non-null form-mapped fact must be covered by either
  seed preferences or at least one document `factKeys[]` entry
- intentional missingness metadata: intentionally missing facts must be null,
  mapped by a listed form, and absent from every document `factKeys[]`
- exact/variant document-body checks for declared high-confidence fact values,
  including email, work email, SSN, USCIS/A-number, date of birth, ZIP, state,
  and citizenship status
- plan-owned `documents[].forbiddenFactKeys[]` references and body-level
  absence checks for non-null forbidden facts
- warning-level pattern checks for intentionally missing phone and
  work-authorization identifiers in current extract/corroborate documents
- high-confidence current identifier leak checks for noise/ignored documents
- file-type checks for planned/generated `json`, `yaml`, and `txt` documents
- scenario snapshot existence and filled-form snapshot schema

`pnpm eval:run` is separate from validation. It validates a scenario, hydrates
known-good backend memory directly from `profile.yaml`, calls the backend
form-fill path with deterministic fill actions, and compares normalized
filled-form snapshots. It does not ingest corpus documents.

## Current Gaps

The current validator does not yet prove that the corpus is fully trustworthy
for extraction scoring.

Implemented in `first-validation-update-0`:

- `forbiddenFactKeys[]` is schema-valid in `corpus-plan.json`, validated
  against profile leaf facts, and kept out of `manifest.json`
- first positive body checks are hard errors for declared extract/corroborate
  values: date of birth, ZIP, state, and citizenship status, alongside the
  earlier email, work email, SSN, and USCIS/A-number checks
- first negative body checks emit `DOCUMENT_FORBIDDEN_FACT_PRESENT` when a
  non-null forbidden value appears in a document body
- first conservative missing-value checks warn for value-like phone and
  work-authorization identifiers when those facts are intentionally missing
- noise and ignored documents emit `DOCUMENT_NOISE_FACT_LEAK` when they contain
  high-confidence current identifiers such as legal name, personal/work email,
  SSN, USCIS/A-number, or current street address

Known remaining gaps:

- most declared facts in `documents[].factKeys[]` are trusted as metadata and
  are not checked in document text
- only a high-confidence exact/variant subset is body-checked today
- common forbidden-fact baselines are repeated per document; there is no
  corpus-level `defaultForbiddenFactKeys[]` or equivalent effective-default
  layer yet
- intentionally missing facts are checked against metadata, but most are not
  checked against every document body
- noise documents are scanned for first-wave high-confidence identifiers, but
  not yet with fuzzy name/address matching
- stale, conflicting, partial, and guardrail documents do not yet have a strong
  machine-checked non-authoritative cue contract
- there is no extraction-specific expected fact snapshot yet

## Corpus Truth Validation Goal

Before running a document-ingestion extraction benchmark, prove that the corpus
files themselves are correct.

The goal is:

```text
profile.yaml ground truth
  -> corpus-plan document inclusion/exclusion contract
  -> generated document body
  -> validator proves required facts appear and forbidden facts are absent
  -> only then use the corpus for extraction scoring
```

This keeps future extraction failures attributable to backend/model extraction
behavior instead of broken fixture documents.

## Proposed Contract Additions

Add explicit document-level inclusion and exclusion metadata.

Possible schema direction:

- keep `factKeys[]` as the list of profile facts expected to appear in the
  document body
- add `forbiddenFactKeys[]` or an equivalent field for facts that must not
  appear in the document body
- consider `allowedStaleFactKeys[]` or challenge-specific metadata for stale
  and conflicting documents, so old values can appear without looking current
- keep `intentionallyMissing[]` at corpus scope for facts expected to stay
  absent from current authoritative material
- keep `challengeTags[]` plan-owned, but use tags to drive validation rules
  when they become reliable

Do not make extraction scoring depend on prose-only assumptions that the
validator cannot enforce.

## Positive Fact Checks

For facts that should appear, expand body validation beyond the current
high-confidence subset.

Implemented exact or variant-based checks:

- `contact.email`
- `employment.workEmail`
- `identity.ssn`
- `workAuthorization.uscisANumber`
- `identity.dateOfBirth`
- `address.current.postalCode`
- `address.current.state`
- `workAuthorization.citizenshipStatus`

Next checks after calibration:

- `identity.legalName`
- `identity.firstName`
- `identity.lastName`
- `identity.middleInitial`
- `identity.otherLastNames`
- `address.current.street`
- `address.current.unit`
- `address.current.city`
- `employment.company`
- `employment.title`
- `employment.startDate`

Implemented variant handling:

- SSN with dashes, without dashes, and with spacing
- USCIS/A-number with bare digits, `A` prefix, and `A-` prefix
- dates as ISO, U.S. slash dates, and long dates
- state full name vs postal abbreviation when profile data supports it

Variant handling still to add:

- addresses with unit on the same line or separate line
- common street abbreviations only after false positives are understood

## Negative Fact Checks

For facts that should not appear, add body-level absence checks.

Implemented:

- scan current extract/corroborate documents for intentionally missing
  `contact.phone`
- scan all current extract/corroborate documents for intentionally missing
  work-authorization identifiers:
  - `workAuthorization.uscisANumber`
  - `workAuthorization.i94AdmissionNumber`
  - `workAuthorization.foreignPassportNumber`
- scan noise documents for high-confidence current identifiers:
  - legal name
  - personal email
  - work email
  - SSN
  - USCIS/A-number
  - current street address
- scan every document against its own non-null `forbiddenFactKeys[]` values

Remaining:

- add a corpus-level/default forbidden-fact mechanism so generated plans do not
  repeat the same baseline exclusions on every document
- corpus-level intentionally missing facts should be translated into default
  forbidden checks for current authoritative documents
- stale/conflicting documents should be allowed to contain stale values only
  when the plan explicitly says so

## Stale And Conflicting Documents

Extraction benchmarks need stale and conflicting files, but those files must be
unambiguous fixtures.

Validation should eventually check that stale/conflicting/guardrail documents:

- have `freshness: "stale"` or `freshness: "mixed"` when they contain old or
  conflicting values
- do not use `authority: "high"` plus `freshness: "current"` plus
  `expectedUse: "extract"` unless they are actually current source material
- include body cues such as "former", "old", "historical", "superseded",
  "do not use", "sample", "redacted", or equivalent wording
- do not accidentally contain current high-confidence values unless declared
  and intended

Keep these as warnings first. Promote only after the cue rules are stable.

## File-Type Validation

Current mixed-file validation exists for the Nina 100-document corpus:

- JSON bodies must parse as JSON
- YAML bodies must parse as YAML
- JSON/YAML bodies cannot be wrapped in Markdown fences
- TXT bodies warn when they look like Markdown

Future file types should not be added until validation rules exist for them.
For example, `.ics`, `.eml`, `.csv`, `.tsv`, `.vcf`, HTML, PDFs, and scanned
images need deliberate parser/rendering and ingestion decisions before they
become extraction eval fixtures.

## Suggested Implementation Order

1. Implemented: add `forbiddenFactKeys[]` to `corpus-plan.schema.json`.
2. Implemented: project exclusion metadata into validation without projecting it
   into `manifest.json`.
3. Implemented: add exact positive body checks for date, ZIP, state, and
   citizenship status.
4. Implemented: add conservative warning checks for intentionally missing
   work-authorization identifier patterns.
5. Implemented: add noise-document leak checks for high-confidence current
   identifiers.
6. Implemented: update the Nina 100-document `corpus-plan.json` with explicit
   forbidden facts.
7. Implemented: run focused validation and refresh the Nina validation report.
8. Next: add warning-level stale/conflicting cue checks.
9. Next: add corpus-level/default forbidden facts to reduce repeated
   per-document exclusions.
10. Next: add fuzzy name/address matching after calibration.
11. Next: add extraction-specific expected fact snapshots.

## Verification Commands

For validation-only work, prefer:

```bash
pnpm eval:test
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
pnpm eval:validate
pnpm eval:verify
```

For plan-only changes before body files exist:

```bash
pnpm eval:validate --user nina-meera-patel --corpus realistic --plan-only
```

## Non-Goals

- Do not add backend document ingestion in this validation track.
- Do not score extraction quality here.
- Do not require AI calls in validation, tests, or CI.
- Do not promote fuzzy natural-language checks to hard errors before they are
  calibrated against committed corpora.

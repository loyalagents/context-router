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
- exact/variant document-body checks for declared deterministic fact values,
  including email, work email, SSN, USCIS/A-number, legal name, name
  components, current address parts, date of birth, ZIP, state, employer,
  title, employment start date, and citizenship status
- plan-owned `defaultForbiddenFactKeys[]` and
  `documents[].forbiddenFactKeys[]` references plus body-level absence checks
  for non-null effective forbidden facts
- warning-level pattern checks for intentionally missing phone and
  work-authorization identifiers in current extract/corroborate documents
- high-confidence current identifier leak checks for noise/ignored documents
- file-type checks for planned/generated `json`, `yaml`, and `txt` documents
- `validation-report.json` `corpusTruth` summaries showing facts proven
  present, missing, unsupported, proven absent, present, warning-only, or
  skipped per document
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

Implemented in `default-forbidden-facts-0`,
`positive-fact-expansion-0`, and `corpus-truth-report-0`:

- `defaultForbiddenFactKeys[]` is schema-valid in `corpus-plan.json`,
  validated against profile leaf facts, and kept out of `manifest.json`
- each document's effective forbidden set combines top-level defaults,
  document-level forbidden facts, and applicable intentionally missing facts,
  then removes facts declared by that document's `factKeys[]`
- document-level forbidden facts that conflict with the same document's
  declared `factKeys[]` are hard errors
- positive body checks now cover legal name, first/last/middle initial,
  other last names, current street/unit/city, employer, title, and employment
  start date with nearby start/hire cues
- common deterministic variants are supported for street suffixes, unit labels,
  employer `&`/`and`, and structured start-date labels
- `validation-report.json` includes `corpusTruth` with per-document contain
  and does-not-contain validation status

Known remaining gaps:

- some declared facts in `documents[].factKeys[]` remain unsupported by
  deterministic text checks and are reported as unsupported in `corpusTruth`
- deterministic checks are still exact/variant-based, not fuzzy semantic
  matching
- intentionally missing facts are translated into effective forbidden checks
  for current authoritative documents, but null/pattern-only absence remains
  warning-level
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
- `employment.company`
- `employment.title`
- `employment.startDate`
- `identity.ssn`
- `identity.legalName`
- `identity.firstName`
- `identity.lastName`
- `identity.middleInitial`
- `identity.otherLastNames`
- `workAuthorization.uscisANumber`
- `identity.dateOfBirth`
- `address.current.street`
- `address.current.unit`
- `address.current.city`
- `address.current.postalCode`
- `address.current.state`
- `workAuthorization.citizenshipStatus`

Still unsupported or future candidates:

- facts not listed above, as surfaced in `validation-report.json`
  `corpusTruth.documents[].declaredFacts.unsupported`
- fuzzy name/address checks after false positives are understood

Implemented variant handling:

- SSN with dashes, without dashes, and with spacing
- USCIS/A-number with bare digits, `A` prefix, and `A-` prefix
- dates as ISO, U.S. slash dates, and long dates
- state full name vs postal abbreviation when profile data supports it
- common street suffix abbreviations
- unit variants such as `Apt`, `Apartment`, `Unit`, and `#`
- employer `&`/`and` variants
- employment start dates only when a date variant appears near start/hire cues

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
- scan every document against its effective non-null forbidden facts:
  - top-level `defaultForbiddenFactKeys[]`
  - document-level `forbiddenFactKeys[]`
  - applicable `intentionallyMissing[].factKey`
  - minus the document's declared `factKeys[]`

Remaining:

- stale/conflicting documents should be allowed to contain stale values only
  when the plan explicitly says so
- fuzzy or semantic absence checks for names and addresses should remain future
  work until they can be calibrated without false positives

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

## Need To Do For Contain And Does-Not-Contain Truth

These are the next validation updates needed to make an example user corpus
trustworthy as a set of files where known facts are present and known facts are
absent.

Implemented:

1. Add `forbiddenFactKeys[]` to `corpus-plan.schema.json`.
2. Project exclusion metadata into validation without projecting it into
   `manifest.json`.
3. Add exact positive body checks for date, ZIP, state, and citizenship status.
4. Add conservative warning checks for intentionally missing work-authorization
   identifier patterns.
5. Add noise-document leak checks for high-confidence current identifiers.
6. Update the Nina 100-document `corpus-plan.json` with explicit forbidden
   facts.
7. Run focused validation and refresh the Nina validation report.
8. Add corpus-level/default forbidden facts to reduce repeated per-document
   exclusions.
9. Translate corpus-level intentionally missing facts into default forbidden
   checks for current authoritative documents.
10. Expand positive body checks for declared `factKeys[]`, including:
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
11. Add calibrated deterministic name/address variant matching where reliable:
    - full legal-name phrase matching
    - token-boundary checks for short name components
    - common street suffix variants
    - unit label variants
12. Add a focused corpus-truth report view that shows, per document, which facts
    were proven present, which forbidden facts were checked absent, and which
    checks remain warning-only or unsupported.

Next:

1. Add calibrated fuzzy name/address matching so positive and negative checks
   can handle realistic document wording:
   - full name vs component names
   - address unit on same line or separate line
   - common street abbreviations
   - city/state/ZIP line variations
2. Harden stale/conflicting cue validation without blocking legitimate guardrail
   documents.
3. Add extraction-specific expected fact snapshots once document corpus truth is
   stable.

## Helpful For Future Extraction Benchmarks

These are useful after the corpus truth layer can already prove the main
contain/does-not-contain contract.

1. Add warning-level stale/conflicting cue checks.
2. Add `allowedStaleFactKeys[]` or equivalent metadata so stale/conflicting
   documents can intentionally contain old values without looking current.
3. Add extraction-specific expected fact snapshots.
4. Add backend document ingestion for corpus extraction benchmarks.
5. Add extraction scoring that compares model/backend extracted facts against
   the corpus truth snapshot.
6. Add validation support for more file types only when parser/rendering and
   ingestion decisions are explicit.

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

# Positive Fact Expansion Implementation Summary

## Implemented

- Expanded deterministic positive body checks for:
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
- Added deterministic matcher behavior:
  - legal name phrase matching with normalization
  - token-boundary matching for short name components and city/unit/title values
  - array facts require every profile value to appear
  - common street suffix variants
  - unit variants such as `Apt`, `Apartment`, `Unit`, and `#`
  - employer `&`/`and` variants
  - employment start date requires a date variant near start/hire cues
- Existing issue code `DOCUMENT_FACT_VALUE_MISSING` is reused for missing supported declared facts.

## Fixture Repairs

- Elena:
  - Added full legal-name text to the driver-license transcript and W-4 draft header.
  - Added current street, unit, and city fields to the state tax intake YAML.
- Nina:
  - Made three employment start-date documents explicit with start-date cues:
    - benefits election draft
    - orientation calendar invite
    - department headcount JSON

These repairs follow the current rule that metadata is the contract unless review shows the metadata overclaimed.

## Tests

- Added tests for missing expanded facts, realistic name/address variants, start date with and without start/hire context, and boundary protection for short values.

## Verification

- `pnpm eval:test`
- `pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report`
- `pnpm eval:validate`
- `pnpm eval:verify`

All commands passed.

## Remaining Gaps

- Matching remains deterministic. Fuzzy legal-name/address matching is intentionally future work.
- Unsupported declared facts are surfaced in `corpusTruth` rather than treated as proven.

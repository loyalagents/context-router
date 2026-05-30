# Positive Fact Expansion Implementation Plan

## Goal

Prove more declared facts actually appear in generated document bodies using deterministic matching only.

## Scope

- Add positive body checks for identity names, current address parts, employer, title, and employment start date.
- Keep hard failures limited to deterministic checks that can be defended with exact or constrained variants.
- Require `employment.startDate` to match both a date variant and a nearby employment-start cue.
- Require array facts such as `identity.otherLastNames` to have every declared value present.
- Support conservative variants for common street suffixes, unit labels, dates, state names, citizenship status, and `&`/`and` employer spellings.
- Repair generated corpus body drift when metadata is the intended contract.

## Checkpoints

1. Expand shared fact variants and supported positive fact logic.
2. Add focused unit tests for name, address, employer/title, and start-date behavior.
3. Run validation against Elena and Nina.
4. Repair body-vs-metadata drift where documents overclaim facts by omission.
5. Re-run eval tests and validation.

## Acceptance

- Supported declared facts missing from `extract` or `corroborate` documents produce `DOCUMENT_FACT_VALUE_MISSING`.
- Start-date checks do not pass on an unrelated date without a start/hire cue.
- Short names and compact address values do not match inside longer unrelated tokens.
- Elena and Nina pass full validation after fixture repair.

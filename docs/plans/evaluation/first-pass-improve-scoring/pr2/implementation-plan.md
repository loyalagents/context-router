# PR 2 Field-Map Conditionality And Form Scoring Cleanup Plan

- Status: completed
- Last updated: 2026-06-15

## Goal

Make form scoring reflect real form-fill behavior for conditional I-9 branches
instead of treating inactive branches as missing-value abstention or structural
overfills.

This PR is eval-tooling only. It does not change backend NestJS product
behavior.

## Checkpoint 1: Field-Map V2 Contract

- Bump `field-map.json` to `schemaVersion: 2`.
- Add fact-field `when: { factKey, equals }`.
  - `equals` accepts one scalar or a non-empty scalar array.
  - If `when` is false, the field is inactive and should be scored as a
    structural skip.
- Add `render: "mmddyyyy"` beside the existing `digits-only` render hint.
- Add tests for schema validation, invalid `when` fact keys, invalid render
  values, and inactive conditional coverage.

## Checkpoint 2: Runner And Snapshot Semantics

- Add shared eval helpers for conditional activity and field rendering.
- Make the deterministic runner:
  - skip inactive conditional fields with an internal skip marker,
  - check conditional checkbox fields when active,
  - render ISO dates as compact `MMDDYYYY` when the field map requests
    `mmddyyyy`.
- Make snapshot classification compare render-aware values so slash/no-slash
  date renderings do not become false wrong-field scores.

## Checkpoint 3: I-9 Field Map And Fixtures

- Encode I-9 citizenship checkbox meanings in the I-9 field map only:
  - `CB_1`: U.S. citizen
  - `CB_2`: noncitizen national
  - `CB_3`: lawful permanent resident
  - `CB_4`: alien/noncitizen authorized to work
- Make the LPR A-number field active only for lawful permanent resident.
- Make alien-authorized expiration, USCIS/A-number, I-94, and foreign-passport
  fields active only for alien/noncitizen-authorized statuses.
- Add `mmddyyyy` render hints to I-9 date fields.
- Regenerate Elena and Samir expected snapshots.
- Regenerate manifests/validation reports if inactive branches change
  intentionally-missing facts.

## Checkpoint 4: Scoring, Docs, And Verification

- Make the form scorer treat inactive conditional skips as `structural-skip`,
  not `abstention-test`.
- Keep the scorer generic; do not hard-code I-9 checkbox meanings.
- Write `implementation-summary.md`.
- Update PR 2 status in the first-pass scoring TODO and orchestration docs.
- Run focused eval tests, then `pnpm eval:test`, `pnpm eval:validate`, and
  `pnpm eval:verify`.

## Acceptance Criteria

- Inactive conditional form branches do not count as missing known fields or
  missing-value abstention tests.
- Only the applicable I-9 citizenship checkbox is expected to be checked for
  U.S. citizen, noncitizen national, lawful permanent resident, and
  alien-authorized profiles.
- Alien-authorized profiles are not penalized for the LPR-only A-number field.
- Date format differences such as `03141992` and `03/14/1992` do not create
  false snapshot/scorer failures.
- Eval validation and fixture snapshots are green after the contract bump.

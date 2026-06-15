# PR 2 Field-Map Conditionality And Form Scoring Cleanup Summary

- Status: implemented
- Last updated: 2026-06-15

## What Changed

- Added field-map schema V2 with fact-field `when` conditions and render hints.
- Added shared eval helpers for conditional activity, `digits-only` rendering,
  `mmddyyyy` rendering, and render-aware value equality.
- Updated the I-9 field map so citizenship checkboxes and work-authorization
  branches are explicit conditional fact fields:
  - `CB_1`: U.S. citizen
  - `CB_2`: noncitizen national
  - `CB_3`: lawful permanent resident
  - `CB_4`: alien/noncitizen authorized to work
- Kept the scorer generic. I-9-specific meanings live only in the I-9 field
  map.
- Added an internal `conditional-inactive` skip marker so inactive branches
  score as `structural-skip`, not `abstention-test`.
- Added `render: "mmddyyyy"` to I-9 date fields and made snapshot
  classification render-aware.
- Updated deterministic runner, snapshot building, form scoring, database
  scoring, validation, corpus planning, scaffolding, and direct-document prompt
  metadata consumers to respect inactive conditional fields.
- Regenerated Elena and Samir template-smoke manifests, validation reports, and
  filled-form snapshots.

## Tests Added Or Updated

- Field-map schema and validator coverage for V2 `when`, scalar-array
  `equals`, invalid render hints, invalid condition fact keys, and inactive
  conditional coverage.
- Runner coverage for U.S. citizen, noncitizen national, lawful permanent
  resident, and alien-authorized I-9 branches.
- Runner/snapshot coverage for `mmddyyyy` rendering and slash/no-slash
  equivalence.
- Form scorer coverage proving inactive conditionals are structural skips.
- Corpus planning, scaffolding, promote-preview, repair-generation, and
  fill-form test fixtures updated for active-only I-9 branch semantics.

## Verification

- `node --test examples/eval/scripts/eval-runner/run.test.mjs examples/eval/scripts/scoring/form.test.mjs examples/eval/scripts/validate.test.mjs examples/eval/scripts/plan-corpus.test.mjs examples/eval/scripts/scaffold.test.mjs`
- `pnpm eval:test`
- `pnpm eval:validate`
- `pnpm eval:verify`
- `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/context_router_test pnpm eval:run --scenario elena-marquez-i9-template-smoke`
- `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/context_router_test pnpm eval:run --scenario samir-desai-i9-template-smoke`

## Notes

- `pnpm eval:validate` still reports the pre-existing Alex realistic corpus
  warnings, but no validation errors.
- No backend NestJS product behavior changed in this PR.

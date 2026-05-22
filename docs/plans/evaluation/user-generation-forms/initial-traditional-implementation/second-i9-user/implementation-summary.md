# Second I-9 User Implementation Summary

- Status: complete
- Date: 2026-05-21

## What Changed

- Added `examples/eval/users/samir-desai/profile.yaml` as a second synthetic
  I-9 user profile.
- Samir's work-authorization facts intentionally differ from Elena's:
  `workAuthorization.uscisANumber` is non-null, while phone, authorization
  expiration, I-94 admission number, foreign passport number, and foreign
  passport country remain null.
- Added generated Samir seed preferences at
  `examples/eval/users/samir-desai/seed-preferences.generated.json`.
- Added
  `examples/eval/templates/work-authorization/lawful-permanent-resident-note.mjs`
  to cover the non-null USCIS/A-number fact through scaffold-generated corpus
  documents.
- Updated scaffold tests so every committed template must render against at
  least one committed profile, rather than requiring every template to render
  against Elena.

## Fixtures Added

- Generated Samir's `template-smoke` corpus through `pnpm eval:scaffold`.
- Added deterministic corpus documents, `manifest.json`, and
  `validation-report.json` under
  `examples/eval/users/samir-desai/corpora/template-smoke/`.
- Added runner-owned scenario
  `examples/eval/scenarios/samir-desai-i9-template-smoke/`.
- Generated and committed the scenario's `expected/filled-form.json` through
  `pnpm eval:run --scenario samir-desai-i9-template-smoke --update-snapshots`.

## Snapshot Review

- Samir's snapshot has `48` total fields, `14` filled fields, and `34` skipped
  fields.
- Field classifications are `14` `correct` and `34` `skipped-correctly`.
- Planned action counts are `SET_TEXT: 13`, `SELECT_OPTION: 1`, `SKIP: 34`,
  with no check or uncheck actions.
- Fields `0` and `24`, both mapped to
  `workAuthorization.uscisANumber`, are filled correctly with `"123456789"`.
- Phone, authorization expiration, I-94, and foreign passport number remain
  skipped from null profile facts.
- Citizenship checkboxes and Section 2 fields remain skipped under the existing
  I-9 field map.

## Documentation Updates

- Updated `examples/eval/README.md` to list Samir, the new scenario, focused
  validation commands, and the second DB-backed smoke scenario.
- Updated `examples/eval/PLAYBOOK.md` to describe profile-specific template
  render coverage and replace the old "second I-9 user" next-expansion note
  with current repeatability coverage.
- Updated `orchestration-plan.md` to mark Batch 6 complete and record the new
  implemented state.

## Verification

Ran:

```bash
pnpm eval:test
pnpm eval:validate --user samir-desai --corpus template-smoke
pnpm eval:validate --scenario samir-desai-i9-template-smoke
pnpm --filter backend test:db:up
pnpm --filter backend test:db:migrate
pnpm eval:run --scenario samir-desai-i9-template-smoke --update-snapshots
pnpm eval:run --scenario samir-desai-i9-template-smoke
pnpm eval:validate
pnpm eval:verify
```

Results:

- Eval script tests passed.
- Focused Samir corpus and scenario validation passed.
- Full fixture validation passed with
  `profiles=2 corpora=3 forms=6 scenarios=3 templates=7 errors=0 warnings=0`.
- Backend test DB was running and had no pending migrations.
- Snapshot update mode generated Samir's committed filled-form snapshot.
- Normal runner mode matched the committed Samir snapshot.

## Deferred

- No W-4 fixture work.
- No I-9 field-map changes or citizenship checkbox hardening.
- No real LLM calls, document-analysis ingestion, UI/browser automation,
  backend product behavior, or schema changes.

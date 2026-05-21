# Batch 6 Second I-9 User Implementation Plan

## Summary

Batch 6 adds a second deterministic I-9 eval fixture user and runner-owned
scenario. The new user is `samir-desai`, a synthetic lawful permanent resident
whose I-9 work-authorization profile differs from Elena's U.S. citizen profile.

Scope:
- Stay inside local eval fixtures and evaluation planning docs.
- Do not add W-4, a new form map, UI/browser automation, document-analysis
  ingestion, backend product behavior, or real LLM calls.
- Keep the I-9 field map unchanged.
- Keep template expansion to one narrow work-authorization template needed for
  Samir's non-null USCIS/A-number fact.

## Key Changes

- Add `examples/eval/users/samir-desai/profile.yaml` as the authoritative
  profile with complete identity, contact, address, employment,
  communication, and I-9 work-authorization facts.
- Add
  `examples/eval/templates/work-authorization/lawful-permanent-resident-note.mjs`
  to cover `workAuthorization.uscisANumber` from generated corpus documents.
- Update scaffold/template tests so every template must render against at least
  one committed profile that satisfies its required facts, instead of assuming
  Elena can render all templates.
- Generate Samir's seed preferences, `template-smoke` corpus, validation
  report, and scenario through the existing `eval:derive-seeds` and
  `eval:scaffold` workflow.
- Make `samir-desai-i9-template-smoke` runner-owned by declaring
  `expectedSnapshots: ["filled-form"]` and generating
  `expected/filled-form.json` through `pnpm eval:run --update-snapshots`.

## Checkpoints

1. Planning Docs
   - Add this implementation plan.
   - Run `pnpm eval:test` to confirm the starting eval-script state.

2. Profile, Template, And Tests
   - Add Samir's profile.
   - Add the narrow lawful permanent resident template.
   - Update scaffold/template test coverage for multi-profile template
     renderability.
   - Run `pnpm eval:test`.

3. Corpus And Scenario
   - Run:
     ```bash
     pnpm eval:derive-seeds
     pnpm eval:scaffold --user samir-desai --corpus template-smoke --form i-9 --scenario samir-desai-i9-template-smoke --missing contact.phone --missing workAuthorization.workAuthorizationExpirationDate --missing workAuthorization.i94AdmissionNumber --missing workAuthorization.foreignPassportNumber
     ```
   - Edit only the new scenario to declare `expectedSnapshots:
     ["filled-form"]`.
   - Run focused validation for Samir's corpus and scenario.

4. Snapshot
   - With the backend test DB running and migrated, run:
     ```bash
     pnpm eval:run --scenario samir-desai-i9-template-smoke --update-snapshots
     pnpm eval:run --scenario samir-desai-i9-template-smoke
     ```
   - Review the snapshot summary and work-authorization fields before keeping
     the generated snapshot.

5. Completion Docs And Verification
   - Update `examples/eval/README.md` and `examples/eval/PLAYBOOK.md` if useful
     to mention the second I-9 repeatability fixture.
   - Add `implementation-summary.md` for this batch.
   - Update `orchestration-plan.md` status and implemented-state bullets.
   - Run final verification:
     ```bash
     pnpm eval:test
     pnpm eval:validate
     pnpm eval:verify
     pnpm eval:run --scenario samir-desai-i9-template-smoke
     ```

## Snapshot Review Criteria

- `summary.totalFields` remains `48`.
- Samir should have `14` correct fields and `34` skipped-correctly fields.
- Planned action counts should be `SET_TEXT: 13`, `SELECT_OPTION: 1`, `SKIP:
  34`, with no check or uncheck actions.
- Fields `0` and `24`, both mapped to
  `workAuthorization.uscisANumber`, should be `correct` with value
  `"123456789"`.
- Phone, authorization expiration, I-94, and foreign passport number should
  remain skipped from null profile facts.
- Citizenship checkboxes and Section 2 fields should remain skipped under the
  current field map.

## Assumptions

- User id: `samir-desai`.
- Corpus id: `template-smoke`.
- Scenario id: `samir-desai-i9-template-smoke`.
- Samir's `workAuthorization.foreignPassportCountry` remains null for profile
  completeness but is not passed to scaffold as `--missing` because the current
  I-9 field map does not map it directly.

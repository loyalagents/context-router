# Open-Schema Form Fill Improvements Implementation Summary

- Status: implemented
- Last updated: 2026-06-18

## Summary

Implemented a small backend form-fill resolution layer for open-schema memory.
The backend now builds deterministic resolved form facts from active
preferences, passes those facts to the prompt, and uses the same facts during
validation.

This keeps validation as the authority and does not change eval scoring.

## Implemented Behavior

- Added a pure form-fact resolver under backend form fill.
- Resolved policy-declared source slugs to their canonical `factKey`.
- Added explicit open-schema aliases for the observed work authorization slugs:
  - `work_auth.citizenship_status`
  - `work_auth.expiration_date`
  - `work_auth.uscis_number`
  - `work_auth.i94_admission_number`
  - `work_auth.foreign_passport_number`
- Added `profile.middle_name` -> `identity.middleName` and derived
  `identity.middleInitial` from middle name.
- Marked conflicting canonical facts unusable so conditionals and fill
  validation fail closed.
- Updated conditional validation to evaluate `policy.when.factKey` from
  resolved canonical facts first, while preserving the existing raw source-slug
  fallback.
- Updated source-policy diagnostics so active slugs that satisfy a canonical
  resolved fact are reported as resolved instead of only off-policy.
- Added prompt context for resolved facts with raw source-slug provenance.

## Files Changed

- `apps/backend/src/modules/preferences/form-fill/form-fact-resolution.ts`
- `apps/backend/src/modules/preferences/form-fill/form-fill.service.ts`
- `apps/backend/src/modules/preferences/form-fill/form-fill-prompt-builder.service.ts`
- `apps/backend/src/modules/preferences/form-fill/form-fill-validator.service.ts`
- `apps/backend/src/modules/preferences/form-fill/form-fill.types.ts`
- Backend form-fill unit specs for resolver, service, prompt builder, and
  validator.

## Verification

Commands run:

```bash
pnpm --filter backend exec jest src/modules/preferences/form-fill/form-fact-resolution.spec.ts src/modules/preferences/form-fill/form-fill-validator.service.spec.ts src/modules/preferences/form-fill/form-fill-prompt-builder.service.spec.ts src/modules/preferences/form-fill/form-fill.service.spec.ts
pnpm --filter backend exec jest src/modules/preferences/form-fill
```

Results:

- Focused form-fill resolver/service/prompt/validator specs passed: 4 suites,
  34 tests.
- All backend form-fill unit specs passed: 7 suites, 47 tests.

## Remaining Work

- The live Claude open-schema eval was not rerun, so this summary does not
  claim a measured score improvement.
- Resolver coverage is intentionally narrow and deterministic. Future forms can
  add explicit aliases or derivations without changing validator logic.
- Richer eval artifact diagnostics can be added later if the next live run
  shows remaining ambiguous failures.
- Stricter off-policy source-slug blocking remains a separate behavior decision.

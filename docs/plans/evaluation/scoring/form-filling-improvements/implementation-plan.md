# Open-Schema Form Fill Improvements Implementation Plan

- Status: active implementation plan
- Last updated: 2026-06-18

## Summary

Improve backend form filling for open-schema evaluation with the smallest
backend-first change that remains form-general.

Forms will continue to declare canonical `factKey` values and optional
`when.factKey` conditions. Before prompting and validation, backend form fill
will build a deterministic resolved fact map from active preferences:

```text
canonical factKey -> value + raw source slug + provenance
```

The prompt and validator will use that same map. Validation remains the
authority; scoring stays honest and does not auto-correct missing form fields.

## Non-Goals

- No LLM matching, fuzzy slug matching, or human schema-quality judgment in the
  behavior path.
- No I-9-specific branching in the filler.
- No database schema changes.
- No dependency on eval-only `fact-storage-map.v1.json` from backend code.
- No stricter off-policy source-slug blocking in this checkpoint.
- No eval-side score correction for values the backend did not fill.

## Backend Design

Add a lightweight helper under backend form fill, initially as a pure module:
`apps/backend/src/modules/preferences/form-fill/form-fact-resolution.ts`.

The helper will:

- accept active preferences and optional field policies;
- resolve trusted raw slugs to canonical form facts;
- derive a small set of safe form projections;
- mark conflicting canonical facts as unusable;
- return diagnostics that can be surfaced in validation events.

Initial explicit aliases:

| Raw slug | Canonical fact |
| --- | --- |
| `work_auth.citizenship_status` | `workAuthorization.citizenshipStatus` |
| `work_auth.expiration_date` | `workAuthorization.workAuthorizationExpirationDate` |
| `work_auth.uscis_number` | `workAuthorization.uscisANumber` |
| `work_auth.i94_admission_number` | `workAuthorization.i94AdmissionNumber` |
| `work_auth.foreign_passport_number` | `workAuthorization.foreignPassportNumber` |
| `profile.middle_name` | `identity.middleName` |

Initial derivation:

- `identity.middleInitial` from `identity.middleName`, only when no direct
  usable `identity.middleInitial` exists and middle name is non-empty. Use the
  first alphabetic character, uppercased.

Conflict behavior:

- If multiple source preferences resolve to the same canonical fact with
  different normalized values, the canonical fact is marked conflicted.
- Conflicted facts do not activate conditionals and are not treated as usable
  fill sources.
- The response should include a diagnostic validation event for blocked
  conflicts where relevant.

## Checkpoints

### Checkpoint 1: Tests First

Add backend tests before behavior changes:

- resolver unit tests for all explicit aliases;
- middle-initial derivation from `profile.middle_name`;
- unrelated plausible slugs do not resolve;
- conflicting resolved facts are marked unusable;
- validator conditionals activate from resolved canonical facts;
- missing/conflicted resolved facts fail closed;
- known-schema raw slug behavior remains unchanged;
- service passes resolved facts into prompt and validation.

### Checkpoint 2: Resolver Helper

Implement the pure helper and export small typed structures for:

- resolved facts;
- conflicted facts;
- resolution provenance;
- prompt-safe resolved fact summaries.

Keep the API generic over canonical fact keys so future forms can reuse it by
adding aliases or derivations, not by adding per-form code paths.

### Checkpoint 3: Prompt And Validation Wiring

Update `FormFillService` to build the resolved fact map after loading active
preferences.

Update `FormFillPromptBuilderService` to include a compact resolved-facts
section with canonical fact keys, values, source slugs, and provenance.

Update `FormFillValidatorService` so `policy.when.factKey` checks the resolved
canonical fact map first and falls back to the existing raw source-slug check
for known-schema behavior.

### Checkpoint 4: Targeted Verification

Run targeted backend form-fill tests first. Then run relevant eval script tests
only if eval artifacts or schemas are changed.

Expected local outcome:

- the six known live-run misses have a backend path to fill or produce precise
  unresolved/conflict diagnostics;
- existing known-schema guardrails stay green.

### Checkpoint 5: Implementation Summary

After implementation, add
`docs/plans/evaluation/scoring/form-filling-improvements/implementation-summary.md`
with:

- changed behavior;
- files touched;
- tests run and results;
- remaining risks and follow-up work;
- live eval comparison only if a rerun is actually performed.

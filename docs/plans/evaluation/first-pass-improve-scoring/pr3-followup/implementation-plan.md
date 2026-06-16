# PR3 Follow-Up Normalization And Guarded Form Fill Plan

## Summary

Implement a staged PR3 follow-up that improves backend/eval reliability without adding a model retry loop:

- Fix backend preference value normalization for enum casing and scalar-to-array values.
- Add optional metadata-backed form-fill policies for eval/backend E2E runs.
- Treat form-fill confidence as diagnostic for otherwise valid actions.
- Preserve PDF-only form-fill compatibility.
- End by writing an implementation summary and updating the first-pass scoring TODO/orchestration docs.

## Key Changes

- Backend preference normalization:
  - `STRING`: trim only; do not lowercase.
  - `ENUM`: trim, then case-insensitively match configured options and store the canonical option.
  - `ARRAY`: coerce a non-empty scalar string to a singleton array, then trim and dedupe string entries.
  - `BOOLEAN`: unchanged.
  - Keep validation after normalization, so ambiguous or unmatched values still fail clearly.
  - Log concise normalization events without changing GraphQL mutation response shapes.

- Backend form-fill policies:
  - Add optional multipart field `fieldPolicies` to `POST /api/form-fill/pdf`.
  - Accept `schemaVersion: 1` and a `fields` array keyed by exact PDF field name.
  - Allow field policies to describe fact fields, structural skip fields, conditional branches, source slugs, and checkbox groups.
  - Keep existing PDF-only clients working with no policy metadata.

- Backend form-fill validation:
  - Include field policies in the model prompt when provided.
  - Resolve conditional policies against active stored preferences.
  - Block non-SKIP actions for inactive conditional fields and structural-skip fields.
  - Enforce checkbox group conflicts deterministically after field-level validation.
  - Apply otherwise valid source-backed actions regardless of confidence and record low-confidence validation events.
  - Add optional `summary.validationEvents` to `FormFillResponse`.

- Eval tooling:
  - Generate form-fill field policies from eval field maps plus storage slug mappings.
  - Send policies by default from `examples/eval/scripts/fill-form.mjs`.
  - Add `--no-field-policies` for raw backend PDF-only behavior.
  - Ensure `eval:e2e-known-schema` continues to use the default policy-backed form-fill path.
  - Preserve direct-doc baseline behavior.

## Implementation Checkpoints

1. Create this implementation plan.
2. Add backend tests for enum normalization, scalar-to-array coercion, strict validation for ambiguous values, and normalization events.
3. Implement backend normalization and run focused preference/document-analysis tests.
4. Add backend form-fill tests for optional `fieldPolicies`, prompt inclusion, diagnostic confidence, inactive conditional blocking, structural-skip blocking, and checkbox group conflicts.
5. Implement form-fill policy parsing, prompt inclusion, validation events, and guarded validation.
6. Add eval tests for default field-policy submission and `--no-field-policies`.
7. Implement eval policy generation from field maps plus storage slug mappings.
8. Run focused backend/eval tests, then broader eval verification.
9. Write `implementation-summary.md`.
10. Update `docs/plans/evaluation/first-pass-improve-scoring/TODO.md` and `docs/plans/evaluation/first-pass-improve-scoring/orchestration.md`.

## Test Plan

Focused backend:

```bash
pnpm --filter backend exec jest src/modules/preferences/preference src/modules/preferences/document-analysis src/modules/preferences/form-fill --runInBand
pnpm --filter backend test:e2e:tests-only -- form-fill.e2e-spec.ts
```

Focused eval:

```bash
node --test examples/eval/scripts/fill-form.test.mjs examples/eval/scripts/e2e-known-schema.test.mjs
```

Broader eval:

```bash
pnpm eval:verify
```

## Assumptions

- Scalar-to-array coercion is accepted for all `ARRAY` definitions, not only eval slugs.
- Confidence is diagnostic-only for otherwise valid form actions; it no longer causes skips by itself.
- Semantic form guards require optional field policy metadata; generic PDF-only uploads remain supported.
- Policies are derived from field maps and storage slug mappings, not profile truth or expected values.
- No model retry loop is added.
- No database migration is required.

# PR3 Follow-Up Feedback A

- Reviewer: Codex
- Date: 2026-06-16
- Branch reviewed: `check-e2e-testing`
- Commit reviewed: `646b333` against `main` at `4efbbfe`
- Scope reviewed: PR3 follow-up plan/summary, branch diff, backend preference normalization, backend form-fill policy validation, eval field-policy generation, and focused tests.

## Summary

The implementation is mostly aligned with the follow-up plan. Enum canonicalization, scalar-to-array support, optional `fieldPolicies`, structural/conditional/checkbox guards, default eval policy submission, and `--no-field-policies` are all wired through the expected surfaces.

I found one storage correctness issue and a few diagnostics/guarding gaps worth fixing before using the new live E2E results as a clean baseline.

## Findings

### P1: Blank scalar strings for ARRAY preferences now become valid empty arrays

`apps/backend/src/modules/preferences/preference/preference-value-normalization.ts:41-47`
`apps/backend/src/modules/preferences/preference/preference.validation.ts:51-54`

For `ARRAY` definitions, scalar strings are trimmed and non-empty values are coerced to singleton arrays, but whitespace-only scalar strings return `[]`. Existing validation accepts any array, so a direct GraphQL/MCP/product write like `value: "   "` can now pass validation and store an empty array.

That is broader than the plan's "coerce a non-empty scalar string" behavior. It also turns malformed or blank model output into a real storage update. If callers need to clear an array, they should send `[]` explicitly rather than having a blank scalar silently clear or create the preference.

Suggested fix:

- In the scalar-string `ARRAY` branch, return the original string or the trimmed empty string when `trimmed` is empty so existing validation rejects it.
- Add tests for `canonicalizePreferenceValue({ valueType: ARRAY }, "   ")` and a service or e2e mutation proving blank scalar strings do not store `[]`.

### P2: `low_confidence_applied` can be emitted for checkbox actions later blocked by group conflict

`apps/backend/src/modules/preferences/form-fill/form-fill-validator.service.ts:204-211`
`apps/backend/src/modules/preferences/form-fill/form-fill-validator.service.ts:301-326`

Low-confidence events are emitted during per-field validation, but checkbox group conflict pruning happens afterward. If two checkboxes in the same policy group are both `CHECK` and the losing checkbox is below the confidence threshold, the response can report `low_confidence_applied` for an action that is later removed from `validActions`.

That makes the new diagnostics misleading: the event name says "applied", but the field was skipped with `checkbox_group_conflict`.

Suggested fix:

- Defer low-confidence event creation until after final `validActions` are known, or remove `low_confidence_applied` events for fields added to `blockedFieldNames`.
- Add a validator test with two checked group members where the losing member is below threshold and verify only the conflict event remains for the loser.

### P2: Conditional policy matching fails closed for non-string active values

`apps/backend/src/modules/preferences/form-fill/form-fill-validator.service.ts:237-249`

`valueMatchesExpected` handles strings and arrays case-insensitively, but the scalar fallback compares active values directly to string candidates with `Object.is`. Because policy `equals` values are parsed as strings, a boolean active preference like `true` will not match `"true"`, and a numeric active value like `1` will not match `"1"`.

The current I-9 policies gate on string enum values, so this does not affect the present scenarios. It is still a latent bug in the generic policy API and will block applicable fields if future form policies gate on boolean or numeric preferences.

Suggested fix:

- Normalize scalar fallback values with `String(value).trim().toLocaleLowerCase()` and compare to normalized expected strings.
- Add a validator test where `activePreferenceValues` contains a boolean or number and the conditional branch should be active.

## Non-Blocking Notes

- `apps/backend/src/modules/preferences/form-fill/form-fill-validator.service.ts:194-198` only checks that action `sourceSlugs` are active preferences. It does not check that they are included in the field policy's allowed `sourceSlugs`, even though eval generates those policy slugs at `examples/eval/scripts/fill-form.mjs:334-346`. If policy source slugs are intended as prompt guidance only, that is fine. If "guarded form fill" is meant to enforce field-map source semantics, add a subset check or a validation event for active but off-policy slugs.
- `examples/eval/scripts/fill-form.test.mjs` currently asserts `policies.fields.length === fixture.joinedFields.length`. The builder intentionally skips unknown/non-`fact`/non-`skip` modes at `examples/eval/scripts/fill-form.mjs:330-331`, so that exact-length assertion will become brittle if the field map grows another mode. The specific field assertions in the test already provide the useful coverage.

## Verification Run

Passed locally:

```bash
pnpm --filter backend exec jest src/modules/preferences/preference/preference-value-normalization.spec.ts src/modules/preferences/form-fill/form-fill-validator.service.spec.ts --runInBand
node --test examples/eval/scripts/fill-form.test.mjs examples/eval/scripts/scoring/combined.test.mjs
```

# PR3 Follow-Up Review — Feedback 1

- Reviewer: Claude (automated review)
- Date: 2026-06-15
- Commit reviewed: `646b333` "Add guarded form fill policies and preference normalization"
- Scope reviewed: `implementation-plan.md`, `implementation-summary.md`, full commit diff
  (backend preference normalization, form-fill policy validation, eval `fill-form` policy
  generation, tests, and docs).

## Verdict

Solid, well-scoped work that matches the plan and its stated assumptions. Tests-first
discipline is visible (unit + e2e + eval), backwards compatibility is preserved (optional
`fieldPolicies`, PDF-only path intact), and there's no model retry loop or DB migration as
promised. I'd merge after considering the **two correctness items** in P1 below; the rest are
non-blocking notes.

## What's Good

- Normalization is a clean extension of `canonicalizePreferenceValue`: STRING trims, ENUM
  case-folds to the configured canonical option, ARRAY coerces a non-empty scalar to a singleton
  and keeps the existing trim/dedupe pass. Validation still runs *after* normalization, so
  unmatched/ambiguous values continue to fail clearly.
- Event emission via an `onEvent` callback keeps the pure normalizer side-effect-free and lets
  the service layer own logging. Good separation.
- Guarded form-fill is deterministic and observable: structural-skip blocking, inactive
  conditional blocking, and checkbox-group conflict resolution all emit structured
  `validationEvents`, surfaced through `summary.validationEvents`. The e2e test asserts the
  end-to-end shape including that the prompt now contains "Field policies:".
- Checkbox-group tie-break (confidence desc, then field order) is deterministic and tested.
- Eval policy generation derives source slugs from field maps + `fact-storage-map.v1.json` only,
  not from profile truth or expected values — consistent with the "no leakage" assumption.
- `--no-field-policies` cleanly preserves the raw PDF-only baseline and is tested on both the
  CLI and `fetchFormFillResponse` paths.

## P1 — Worth Addressing Before/With Merge

### 1. Confidence is now diagnostic-only for *all* form-fill callers, not just policy-backed eval runs

In `form-fill-validator.service.ts`, `confidence < confidenceThreshold` changed from
`return 'confidence below threshold'` (a skip) to merely pushing a `low_confidence_applied`
event and returning `null` (apply). This path is shared by **every** `POST /api/form-fill/pdf`
caller, including production PDF-only uploads with no policies attached. Net effect:
`config.confidenceThreshold` no longer blocks anything in the validator — it's now purely a
prompt-side suggestion (the prompt still tells the model to SKIP on low confidence, but the
validator no longer enforces it).

The plan lists this as an explicit assumption ("confidence is diagnostic-only … no longer
causes skips by itself"), so it may be fully intended. But it's a meaningful behavior change to
the live backend beyond eval. Please confirm the intent and, if global is desired, say so in the
config docs (and consider whether `confidenceThreshold` should be renamed/marked as
"diagnostic-only" so it isn't mistaken for an enforcement gate). If enforcement was only meant to
relax *under policies*, gate the relaxation on `policy` presence instead.

### 2. Conditional `when` matching breaks for non-string gating values

`valueMatchesExpected` compares `equals` (always `string[]`) against the active preference value.
For arrays and strings it case-folds correctly, but the fallback is
`expected.some((candidate) => Object.is(value, candidate))`. Since `candidate` is always a string
and `value` would be a `boolean`/`number`, `Object.is(true, "true")` is always `false`. So any
conditional that gates on a BOOLEAN or numeric preference will *always* evaluate inactive and
block the field.

The I-9 eval gates on `citizenshipStatus` (enum/string), so current scenarios are unaffected and
tests pass — but this is a latent correctness bug for any future boolean/number conditional.
Recommend coercing both sides to string for the scalar comparison (e.g.
`String(value).trim().toLocaleLowerCase()`), and adding a test with a boolean gating value.

## P2 — Non-Blocking Notes

- **Missing gating preference blocks the field.** `conditionIsActive` returns `false` when the
  conditional source slug isn't present in `activePreferenceValues`, so a genuinely-applicable
  conditional field whose gating fact simply wasn't extracted gets blocked. Conservative and
  reasonable for reset eval runs with known seed prefs, but it will cost recall on partial-memory
  runs. Worth a one-line comment documenting the intended fail-closed semantics.

- **`groupId` convention is implicit.** Eval generation sets `groupId = fieldMap.when.factKey`
  only for checkbox conditional branches, so grouped checkboxes must share an identical
  `when.factKey`. The validator schema accepts a free-form `groupId` with no doc of this
  convention. Add a short note to the policy schema/types so external policy authors know how
  grouping is expected to work.

- **Type drift from zod defaults.** `FieldConditionSchema`/`FieldPolicySchema` use
  `.default([])` for `sourceSlugs`, so the parsed output type diverges from the hand-written
  `FormFillFieldPolicy` interface (optional vs always-present), and the controller papers over it
  with `as FormFillFieldPolicies`. Prefer `z.infer<typeof FormFillFieldPoliciesSchema>` as the
  source of truth, or drop the casts, to keep types honest.

- **Brittle test assertion.** `buildFormFillFieldPolicies` asserts
  `policies.fields.length === fixture.joinedFields.length`, but the builder `continue`s past any
  joinedField whose `mode` is neither `fact` nor `skip`. If a fixture later introduces another
  mode, this exact-length assertion fails for an unrelated reason. Consider asserting on the
  presence of the specific expected policies (which the test already does) rather than total
  count.

- **Prompt size.** The full `fieldPolicies` JSON is appended to the prompt in addition to the
  field metadata, duplicating field names and adding the `when.equals` candidate lists. Fine for
  the I-9, but for large forms this grows tokens noticeably. Low priority; flag only if prompt
  budget becomes a concern.

- **STRING trim is now global.** Every STRING preference write is now trimmed (previously only
  ARRAY was canonicalized). Almost certainly desirable, but note it's an app-wide change, not an
  eval-only one — call it out in the changelog/PR description so it isn't a surprise.

## Test Coverage Assessment

Good breadth: normalization unit tests (enum casing, scalar→array, events), extraction-path
canonicalization, validator unit tests (structural skip, inactive conditional, checkbox-group
conflict, low-confidence-applied), controller parsing, an e2e covering the multipart policy +
structural-skip block + prompt inclusion, and eval tests for default vs `--no-field-policies` and
policy derivation. Gaps worth closing: (1) a boolean/number gating-value condition test (see P1.2),
and (2) an assertion that the global PDF-only path still applies low-confidence fills (guards the
intentional behavior change in P1.1 against future regressions).

## Suggested Follow-Ups (from the summary, endorsed)

- Run a live known-schema E2E for pro and flash-lite, then `pnpm eval:compare-runs` against the
  prior `/private/tmp/...known-schema-e2e` runs to confirm the database (~16/22) and form
  (~11/17) scores actually move, since that recall problem is the original motivation.
- Backend model introspection remains correctly deferred.

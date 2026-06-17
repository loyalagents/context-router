# PR Feedback — MCP Scoring Follow-Up

- Reviewer: Claude (Opus 4.8)
- Date: 2026-06-16
- Commit reviewed: `023835e` "Harden MCP form-fill policies and update scoring docs"
- Scope: follow-up to `docs/plans/evaluation/scoring/MCP-scoring/`

## What this follow-up does

1. Documents `--schema-mode known` as an existing/visible-backend-schema eval
   (not a closed target-form-only schema), and clarifies that the MCP
   known-schema runner and the backend known-schema document ingestor are
   intentionally different producers. Propagated consistently across
   `brainstorm.md`, both `implementation-summary.md` files, `orchestration.md`
   (MCP + scoring), and `TODO.md`.
2. Hardens `FormFillPromptBuilderService` so field policies are authoritative,
   `mode=fact` fields may only draw from policy `sourceSlugs`, fields with no
   usable allowed source must `SKIP`, and semantically similar substitutions
   (e.g. work email → contact email) are rejected.
3. Keeps `policy_source_slug_off_policy` validation diagnostic-only on purpose,
   so the eval still scores real backend form-fill mistakes truthfully.

## Verification I ran

- `pnpm exec jest .../form-fill-prompt-builder .../form-fill-validator --runInBand`
  → 17/17 passing.
- Confirmed in `form-fill-validator.service.ts:221-233` that the off-policy
  branch only pushes a `validationEvents` entry and returns `null`; the value is
  still applied. The "diagnostic-only / does not block" claim is accurate.
- Confirmed in `fill-form.mjs` that `sourceSlugsForFactKey` always appends
  `evalSlugForFactKey(factKey)`, so in the eval path a `mode=fact` policy never
  ships empty `sourceSlugs`. The prompt assertions match the prompt text exactly.

Overall this is a clean, well-scoped, internally consistent change. The docs are
honest about the limits of the known-schema runner, and the code change is
minimal and tested. The findings below are mostly about an edge case and a
verification gap, not correctness defects in the eval path.

## Findings

### 1. Prompt has no rule for `mode=fact` policies with empty `sourceSlugs` (main finding)

`FieldPolicySchema` defaults `sourceSlugs` to `[]` (`form-fill.types.ts:72`), and
the source field-map shape (`examples/eval/forms/i-9/field-map.json`) expresses
fact fields with a `factKey` and **no** `sourceSlugs` at all. The new prompt
instruction is unconditional:

> For mode=fact field policies, use only active memories whose slug is listed in
> that field policy's sourceSlugs. If no listed sourceSlug has a usable active
> memory value, return SKIP for that field.

Read literally, a `mode=fact` policy with empty `sourceSlugs` instructs the model
to `SKIP` every such field. The validator's off-policy check is also guarded by
`policy.sourceSlugs.length > 0` (`form-fill-validator.service.ts:221`), so it
stays silent on the empty case — meaning nothing else catches it.

- In the **eval** path this never fires, because `fill-form.mjs` always injects
  the eval slug, so `sourceSlugs` is non-empty. Safe today.
- But `FormFillPromptBuilderService` is the **shared product** path
  (`form-fill.controller.ts` accepts an arbitrary `fieldPolicies` multipart
  field). A caller passing a `mode=fact` + `factKey` + empty-`sourceSlugs` policy
  would now get blanket `SKIP`s where previously the model could fill from the
  `factKey`/general memory.

Recommendation: make the empty case explicit in the prompt — either "treat empty
`sourceSlugs` as no source restriction (fall back to best matching memory)" or
"empty `sourceSlugs` on a fact field means SKIP" — so behavior is intentional
rather than an emergent reading. Whichever is chosen, state it in the policy
contract docs too.

### 2. The motivating failure was not re-measured (verification gap)

The parent live smoke reported exactly "one wrong email field" — the precise
error class this hardening targets. The follow-up changes the prompt to prevent
that substitution but defers the post-change smoke to "Remaining Work." The new
unit tests only assert that the prompt *contains* the new strings; they do not
demonstrate any behavior change. So there's currently no evidence that the
hardening reduces the wrong-email substitution (or that it doesn't introduce
over-skip regressions per finding #1).

Recommendation: run one post-change live smoke against the same
`alex-i9-realistic` scenario and record whether the wrong-email field now fills
correctly or skips. It's the cheapest way to close the loop on the stated
motivation.

### 3. Hardening shifts the error distribution from "wrong" to "skipped"

Steering the model to `SKIP` rather than substitute converts some
"incorrect-value" outcomes into "missing/skipped-field" outcomes, which the form
scorer counts in a different bucket (missing known field vs. wrong field). This
is likely the desired product behavior (don't emit incorrect PII), but it means
score deltas after this change should not be read naively — a drop in "wrong"
fields with a rise in "skipped" fields is the intended effect, not a regression.

Recommendation: add a one-line note to the follow-up summary so future
score comparisons interpret the shift correctly.

### 4. This is a product behavior change, not eval-only (scope clarity)

The follow-up is framed as MCP-scoring work and is careful to say validator
enforcement is unchanged. True — but the prompt edit lives in the shared backend
form-fill service and changes real product fill behavior (more SKIPs, no
semantic substitution) for any caller that passes field policies. That's
probably fine, but it deserves explicit callout so it isn't treated as an
eval-only tweak by anyone reading the MCP-scoring docs.

### 5. Prompt-test brittleness (minor)

The new assertions are exact-substring matches against prompt copy, so any
rewording breaks them even when intent is preserved. Acceptable for a
string-builder unit, but consider anchoring on fewer, stable phrases.

## Suggested doc/code touch-ups

- Resolve finding #1 in `form-fill-prompt-builder.service.ts` and the field-policy
  contract.
- Add the "wrong → skipped" interpretation note and the "shared product path"
  scope note to `follow-up/implementation-summary.md`.
- Optionally run and record the post-change smoke referenced in finding #2.

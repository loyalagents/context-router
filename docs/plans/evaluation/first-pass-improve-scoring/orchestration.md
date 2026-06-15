# First-Pass E2E Scoring Improvements Orchestration

- Status: active orchestration plan
- Last updated: 2026-06-14

## Goal

Turn the live known-schema E2E findings into a small set of focused changes.

The E2E wrapper now runs end to end, but the first real runs showed that the
main quality issue is not the wrapper. The main issue is that good extracted
values can be overwritten by later stale, noisy, blank, or lower-authority
suggestions. A few form-scoring gaps also make some form results harder to
trust.

## Priority Order

1. Ingestor overwrite safety.
2. Field-map conditionality and form scoring correctness gaps.
3. Observability, debug artifacts, and run comparison.
4. Later source-authority and conflict-resolution work.

## Working Assumption

Backwards compatibility is not a goal for this batch. Prefer clean schema and
artifact contracts over compatibility shims. If an artifact shape needs to
change, update its schema, tests, and docs in the same PR.

## Parallelization

These tracks can mostly run in parallel:

- PR 1, ingestor overwrite safety, touches ingestion/apply behavior and
  `ingestion-run.json`.
- PR 2, field-map conditionality and form scoring cleanup, touches field-map
  schema/loading, scenario expectations, snapshot classification, and form
  scorer behavior.
- PR 3, observability and run comparison, touches wrapper artifacts, terminal
  response persistence, and docs/examples.

PR 1 and PR 2 can start immediately and independently.

PR 3 can also start immediately for:

- `--model-label` / `EVAL_MODEL_LABEL`
- terminal form-fill response persistence
- `evaluation-run.schema.json` updates

The rest of PR 3 should wait for PR 1 and PR 2:

- overwrite-aware comparison output depends on PR 1 provenance fields
- representative example artifacts should be generated after overwrite and
  scoring fixes land, otherwise the example will document known-bad behavior

## PR 1: Ingestor Overwrite Safety

### Goal

Prevent obviously bad suggestions from damaging active memory during
known-schema auto-apply.

This is the highest-priority track because the successful E2E runs showed good
address values being replaced by stale/noise/blank values.

### Changes

- [ ] Treat blank suggestions as non-storable unconditionally.
  - Treat `null`, `undefined`, `""`, empty arrays, and empty objects as
    non-storable.
  - Extend the existing non-storable suggestion path instead of adding
    fact-truth-specific logic for blanks.
  - Still record skipped suggestions in `ingestion-run.json`.
  - Pre-filter these suggestions before building `applyInput`, so intentional
    skips do not trip the applied-length invariant.

- [ ] Track applied state in memory during the run.
  - Keep a map keyed by slug.
  - Seed it from explicit `--seed-preferences` values when present.
  - Update it after each successful apply.
  - Use it to know whether a suggestion would overwrite a non-empty active
    value.
  - This first pass is optimized for reset E2E runs; non-reset robustness can
    fetch backend active preferences later if needed.

- [ ] Add overwrite diagnostics to `ingestion-run.json`.
  - For each applied suggestion, record:
    - document path
    - slug
    - old value
    - new value
    - whether it overwrote a non-empty value
  - For each blocked suggestion, record:
    - document path
    - slug
    - new value
    - block reason
    - current value if relevant
  - Add summary counts:
    - `overwriteCount`
    - `blankSuggestionSkippedCount`
    - `nonEmptyToBlankOverwriteCount`
    - `forbiddenSuggestionBlockedCount`
    - `staleOrNoiseOverwriteBlockedCount`

- [ ] Block forbidden and low-authority overwrites.
  - Use `factContract.forbid` as an unconditional deterministic block.
    - If a document forbids a fact, any suggestion for that fact from that
      document is blocked even when the target field is currently unset.
  - Use manifest metadata as the backstop for stale/noise/guardrail overwrite
    protection:
    - `evaluationRole.freshness`
    - `evaluationRole.authority`
    - `evaluationRole.expectedUse`
    - `evaluationRole.challengeTags`
    - `sourceSpec.sourceFamily`
  - Keep blocked suggestions in diagnostics, but do not apply them when they
    are forbidden or would let a stale/noise/low-authority document overwrite a
    current non-empty target value.

- [ ] Add document-order overwrite tests.
  - Good document writes correct address.
  - Later stale/noise document suggests blanks.
  - Later stale/noise document suggests conflicting concrete values.
  - Final exported memory keeps the good values.
  - Include `factContract.forbid` blocking even when the document is not
    otherwise low-authority and even when the target field is unset.
  - Include seeded-value protection.

- [ ] Update `ingestion-run.schema.json`.
  - Add skipped-suggestion diagnostics, overwrite diagnostics, and summary
    counts in the same PR.

### Success Criteria

- A forbidden suggestion is never applied.
- A later stale/noise/blank suggestion does not overwrite a useful target value.
- `ingestion-run.json` makes overwrite decisions visible without manual artifact
  spelunking.
- The Alex E2E database address failures should improve or become clearly
  attributable.

## PR 2: Field-Map Conditionality And Form Scoring Cleanup

### Goal

Make form scoring reflect true form-fill behavior rather than field-map,
scenario, or snapshot-classification gaps.

This can run in parallel with PR 1.

### Changes

- [ ] Add clean conditional field-map semantics.
  - Backwards compatibility is not required; choose the simplest durable shape.
  - Example shape to evaluate:
    - `when: { factKey: "workAuthorization.citizenshipStatus", equals:
      "alien authorized to work" }`
  - Update `field-map.schema.json`, field-map loaders, validation, and tests.

- [ ] Fix I-9 citizenship checkbox mapping with conditional semantics.
  - Recent run showed structural overfills on `CB_1`, `CB_2`, `CB_3`, and
    `CB_4`, all sourced from citizenship status.
  - Model these as mutually exclusive citizenship-status fields where possible,
    not as permanent unscored structural fields.
  - Add tests that only the matching citizenship checkbox is scored as filled.
  - Add Elena/U.S.-citizen regression coverage so the conditional behavior does
    not break the profile the original map was authored for.

- [ ] Make the LPR-only A-number field conditional.
  - Field: `3 A lawful permanent resident Enter USCIS or ANumber`.
  - For `alien authorized to work`, this should not count as a missing known
    field.
  - Keep the appropriate alien-authorized USCIS/A-number field scored
    separately.

- [ ] Confirm or add date render equivalence.
  - Accept `03141992` and `03/14/1992` as equivalent where an I-9 PDF field
    expects `MMDDYYYY`.
  - Implement this where classifications are computed, likely
    `eval-runner/snapshots.mjs`, not only in the form score aggregator.
  - Prefer render/digits-only metadata over date-only special cases.
  - Add tests for equivalent slash/no-slash date renderings and true
    mismatches.
  - Expect snapshot updates if filled-form classifications change.

### Success Criteria

- Structural overfills are either legitimate mapped score rows or eliminated as
  non-scored structural fields.
- Alien-authorized profiles are not penalized for LPR-only fields.
- Date formatting differences do not create false wrong-field scores.

## PR 3: Observability And Run Comparison

### Goal

Make live E2E runs easier to debug, compare, and document.

This can run in parallel with PR 1 and PR 2, though richer overwrite display can
wait for PR 1.

### Changes

- [ ] Record model metadata in `evaluation-run.json`.
  - Add `--model-label <label>` and `EVAL_MODEL_LABEL`.
  - Update `evaluation-run.schema.json`.
  - This should land early so future model comparisons are labeled.
  - Backend introspection for the actual loaded `VERTEX_MODEL_ID` is separate
    later work.

- [ ] Persist terminal `eval:fill-form` backend responses.
  - Write a redacted `form-fill-response.json` even when status is:
    - `failed`
    - `no_fillable_fields`
    - `unsupported_format`
  - Add a regression test that terminal responses still produce the response
    artifact.

- [ ] Add a compact E2E comparison tool or documented command recipe.
  - Compare two run directories and print:
    - database score deltas
    - form score deltas
    - changed wrong/missing fact keys
    - changed structural overfills
  - This is especially useful for comparing backend model choices.
  - Basic score comparison can land immediately.
  - Overwrite-provenance comparison should wait for PR 1.

- [ ] Save a representative successful E2E run under an example folder.
  - Include:
    - `evaluation-run.json`
    - `ingestion-run.json`
    - `stored-preferences.json`
    - `database-score-report.json`
    - `filled-form.json`
    - `form-score-report.json`
    - `combined-score-report.json`
    - a short qualitative summary
  - Generate this after PR 1 and PR 2 land.

### Success Criteria

- A run artifact can tell us which model/config label was used.
- Failed form-fill responses leave enough local evidence to debug without
  rerunning curl manually.
- Comparing two E2E runs is quick and repeatable.

## Later Work

- [ ] Add backend model introspection.
  - Expose the backend's actual loaded `VERTEX_MODEL_ID` through a safe
    diagnostic path.
  - Record it automatically in `evaluation-run.json`.

- [ ] Add richer source-authority policy beyond simple stale/noise/blank guards.
  - Possible dimensions:
    - authority
    - freshness
    - source family
    - expected use
    - fact category

- [ ] Add smart conflict resolution instead of first-write/last-write or simple
  no-overwrite rules.
  - Keep this separate from first-pass deterministic fixes.
  - Avoid LLM-judged conflict resolution until the deterministic baseline is
    much clearer.

## Recommended Execution

Start PR 1 first because it addresses the largest observed quality issue.

PR 2 can start at the same time because it touches different code paths and
improves score trustworthiness.

PR 3 can start at any point, but it is lower priority than preventing bad
memory writes and fixing scorer correctness gaps.

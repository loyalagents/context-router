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
2. Form scoring correctness gaps.
3. Observability, debug artifacts, and run comparison.
4. Later source-authority and conflict-resolution work.

## Parallelization

These tracks can mostly run in parallel:

- PR 1, ingestor overwrite safety, touches ingestion/apply behavior and
  `ingestion-run.json`.
- PR 2, form scoring cleanup, touches field maps and form scorer behavior.
- PR 3, observability and run comparison, touches wrapper artifacts, terminal
  response persistence, and docs/examples.

The only coordination point is that PR 3 may want to display diagnostics added
by PR 1. It can start independently with model labels and terminal response
artifacts, then add richer overwrite display later.

## PR 1: Ingestor Overwrite Safety

### Goal

Prevent obviously bad suggestions from damaging active memory during
known-schema auto-apply.

This is the highest-priority track because the successful E2E runs showed good
address values being replaced by stale/noise/blank values.

### Changes

- [ ] Skip auto-applying blank values for known-present target facts.
  - Treat `""`, `null`, and empty arrays/objects as blank.
  - Use fixture truth/manifest/profile data to know which target facts are
    expected to be known-present.
  - Still record skipped suggestions in `ingestion-run.json`.

- [ ] Add overwrite diagnostics to `ingestion-run.json`.
  - For each applied suggestion, record:
    - document path
    - slug
    - old value
    - new value
    - whether it overwrote a non-empty value
  - Add summary counts:
    - `overwriteCount`
    - `blankSuggestionSkippedCount`
    - `nonEmptyToBlankOverwriteCount`
    - `currentValueOverwrittenByStaleOrNoiseCount`

- [ ] Block stale/noise/guardrail documents from overwriting non-empty active
  target values.
  - Use manifest metadata already available to the ingestor:
    - `evaluationRole.freshness`
    - `evaluationRole.authority`
    - `evaluationRole.expectedUse`
    - `evaluationRole.challengeTags`
    - `sourceSpec.sourceFamily`
  - Keep suggestions in diagnostics, but do not apply them when they would
    overwrite a current non-empty value.

- [ ] Add document-order overwrite tests.
  - Good document writes correct address.
  - Later stale/noise document suggests blanks.
  - Later stale/noise document suggests conflicting concrete values.
  - Final exported memory keeps the good values.

### Success Criteria

- A later stale/noise/blank suggestion does not overwrite a known-present target
  fact.
- `ingestion-run.json` makes overwrite decisions visible without manual artifact
  spelunking.
- The Alex E2E database address failures should improve or become clearly
  attributable.

## PR 2: Form Scoring Cleanup

### Goal

Make form scoring reflect true form-fill behavior rather than field-map or
scorer gaps.

This can run in parallel with PR 1.

### Changes

- [ ] Review and fix I-9 citizenship checkbox mapping.
  - Recent run showed structural overfills on `CB_1`, `CB_2`, `CB_3`, and
    `CB_4`, all sourced from citizenship status.
  - Decide whether these should be mapped as mutually exclusive citizenship
    fields or explicitly treated as non-scored structural fields.
  - Add scorer tests for the chosen behavior.

- [ ] Make the LPR-only A-number field conditional.
  - Field: `3 A lawful permanent resident Enter USCIS or ANumber`.
  - For `alien authorized to work`, this should not count as a missing known
    field.
  - Keep the appropriate alien-authorized USCIS/A-number field scored
    separately.

- [ ] Confirm or add date render equivalence.
  - Accept `03141992` and `03/14/1992` as equivalent where an I-9 PDF field
    expects `MMDDYYYY`.
  - Add tests for date fields with slash and no-slash renderings.

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
  - Short-term:
    - add `--model-label <label>`
    - add `EVAL_MODEL_LABEL`
  - Later/better:
    - expose backend diagnostics for the actual loaded `VERTEX_MODEL_ID`
    - record the backend-reported model automatically

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

### Success Criteria

- A run artifact can tell us which model/config label was used.
- Failed form-fill responses leave enough local evidence to debug without
  rerunning curl manually.
- Comparing two E2E runs is quick and repeatable.

## Later Work

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

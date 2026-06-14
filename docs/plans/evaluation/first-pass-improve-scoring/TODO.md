# First-Pass E2E Scoring Improvements TODO

- Status: active follow-up list
- Last updated: 2026-06-14

## Context From Live E2E Runs

We ran the known-schema E2E wrapper against:

- `alex-i9-test` / `realistic` / `alex-i9-realistic`
- older run: `/private/tmp/alex-i9-test-realistic-20260612-174029-known-schema-e2e`
- newer run: `/private/tmp/alex-i9-test-realistic-20260614-155441-known-schema-e2e`

Both runs passed end to end after the SSN PDF-writing fix, but both exposed the
same main quality problem: good extracted memory can be overwritten by later
bad suggestions.

The artifacts do not currently record the backend model ID, so the model
comparison is inferred from when the backend env was changed. Do not treat these
runs as rigorous model comparisons until model metadata is captured.

## Main Observations

- The pipeline now works end to end:
  - validation
  - document ingestion
  - stored-preferences export
  - database scoring
  - live form fill
  - form scoring
  - combined scoring
- Database score stayed around `16/22` known-present facts correct in both
  successful runs.
- Form score stayed around `11/17` known fields correct in both successful
  runs.
- The failure mode changed across runs:
  - one run produced more wrong concrete values.
  - the newer run produced more blank/missing values.
- The most important recurring issue is overwrite quality, not the wrapper.

## P0: Prevent Bad Auto-Apply Overwrites

- [ ] Do not auto-apply blank values for known-present target facts.
  - Example from newer run:
    - `009-stale-contact-ticket.txt` wrote blank values for
      `eval.address.current.street`, `unit`, `state`, and `postal_code`.
  - Concrete change:
    - In known-schema ingestor auto-apply, skip suggestions where `newValue` is
      `""`, `null`, or empty array/object for facts that are expected to be
      known-present in the manifest/profile truth.
    - Record skipped blank suggestions in `ingestion-run.json`.
    - Add tests that blank suggestions are not applied and are still reported.

- [ ] Add overwrite diagnostics to `ingestion-run.json`.
  - Concrete change:
    - For every applied suggestion, record `oldValue`, `newValue`, document
      path, suggestion slug, and whether it overwrote a non-empty active value.
    - Add summary counts:
      - `overwriteCount`
      - `blankSuggestionSkippedCount`
      - `nonEmptyToBlankOverwriteCount`
      - `currentValueOverwrittenByStaleOrNoiseCount`
  - This makes future E2E failures attributable without manually diffing stored
    preferences.

- [ ] Block low-authority stale/noise documents from overwriting current
  high-authority values.
  - Examples:
    - `010-community-newsletter-email.txt` wrote `eval.address.current.city =
      Oakmont`.
    - `009-stale-contact-ticket.txt` damaged current address fields.
  - Concrete change:
    - Use manifest document metadata already available to the ingestor:
      `evaluationRole.freshness`, `evaluationRole.authority`,
      `evaluationRole.expectedUse`, `evaluationRole.challengeTags`, and
      `sourceSpec.sourceFamily`.
    - Prevent documents marked stale/noise/guardrail from overwriting non-empty
      active values for target facts.
    - If the suggestion is useful for diagnostics, keep it in the run report but
      do not apply it.

- [ ] Add tests for document-order overwrite behavior.
  - Test sequence:
    - doc 1 applies correct current address.
    - doc 2 is stale/noise and suggests blank or conflicting address.
    - final exported memory should keep doc 1 values.
  - Include both blank overwrite and concrete wrong overwrite cases.

## P1: Improve Scoring Diagnostics

- [ ] Add an overwrite-focused section to database score reports when provenance
  is available.
  - Concrete change:
    - If `stored-preferences.json` or `ingestion-run.json` includes write
      provenance, show which document last wrote each wrong/missing value.
    - For wrong accepted slugs, include the active accepted rows and their last
      source document.
  - Goal:
    - A reviewer should immediately see "wrong because stale ticket overwrote
      correct utility export" without manual artifact spelunking.

- [ ] Add a compact E2E comparison summary command or doc recipe.
  - Concrete change:
    - Provide a small jq/script command that compares two run directories and
      prints:
      - database score deltas
      - form score deltas
      - changed wrong/missing fact keys
      - changed structural overfills
  - This is useful for model comparisons once model metadata is recorded.

- [ ] Record backend model/config metadata in `evaluation-run.json`.
  - Concrete change:
    - At minimum, add wrapper support for `--model-label <label>` or
      `EVAL_MODEL_LABEL`.
    - Preferably also expose backend diagnostic metadata for the Vertex model
      actually loaded by the backend, then record it automatically.
  - Reason:
    - Current artifacts cannot prove whether a run used `gemini-2.5-flash-lite`
      or `gemini-2.5-pro`.

## P1: Fix Form Scoring And Field-Map Gaps

- [ ] Review I-9 citizenship checkbox mapping.
  - Newer run showed structural overfills on `CB_1`, `CB_2`, `CB_3`, and
    `CB_4`, sourced from citizenship status.
  - Concrete change:
    - Map these checkbox fields to the appropriate citizenship-status choices
      in `field-map.json`, or explicitly mark them as structural fields that
      should not be filled by the current scenario.
    - Add scorer tests for mutually exclusive I-9 citizenship checkboxes.

- [ ] Review the LPR-specific A-number field scoring.
  - Both runs marked `3 A lawful permanent resident Enter USCIS or ANumber` as
    missing even though Alex is `alien authorized to work`.
  - Concrete change:
    - Make the field map/scorer conditional on citizenship status.
    - For alien-authorized profiles, the LPR-only A-number field should be a
      structural skip, not a required known field.
    - Keep the alien-authorized USCIS A-number field scored separately.

- [ ] Confirm date render equivalence in form scoring.
  - Older run marked values like `03141992` and `09302028` wrong when expected
    values were rendered as `03/14/1992` and `09/30/2028`.
  - Concrete change:
    - If not already handled, make form scorer date comparison accept field
      native `MMDDYYYY` for I-9 date fields.
    - Add tests for slash and no-slash date renderings.

## P1: Improve Form-Fill Debuggability

- [ ] Persist terminal `eval:fill-form` backend responses.
  - Before the SSN fix, form fill returned `status: failed`, but the eval
    runner did not persist `form-fill-response.json`.
  - Concrete change:
    - Write a redacted response artifact before rejecting terminal statuses like
      `failed`, `no_fillable_fields`, and `unsupported_format`.
    - Add a test that terminal responses still produce a response artifact.

- [x] Normalize dashed SSN values for the I-9 PDF SSN field.
  - Fixed issue:
    - `000-00-0292` crashed PDF writing because the field max length is 9.
  - Implemented behavior:
    - Fill as `000000292` for the known I-9 SSN field / SSN-sourced actions.

## P2: Documentation And Example Artifacts

- [ ] Save a representative successful E2E run under an example folder.
  - Include:
    - `evaluation-run.json`
    - `ingestion-run.json`
    - `stored-preferences.json`
    - `database-score-report.json`
    - `filled-form.json`
    - `form-score-report.json`
    - `combined-score-report.json`
    - a short summary of what passed and what failed
  - Use this as the baseline for future PR review and model comparisons.

- [ ] Document how to run model comparisons.
  - Include:
    - how to set `VERTEX_MODEL_ID`
    - how to restart the backend
    - how to pass/record a model label
    - how to compare score reports between two run directories

## Later

- [ ] Consider a source-authority policy that uses more than stale/noise flags.
  - Example dimensions:
    - document authority
    - freshness
    - source family
    - expected use
    - whether the target fact is identity, contact, address, or work auth
  - Do this only after the simple blank/stale/noise overwrite guards are in
    place.

- [ ] Consider smart conflict resolution instead of first-write/last-write
  application.
  - This should remain separate from the first-pass deterministic fixes.

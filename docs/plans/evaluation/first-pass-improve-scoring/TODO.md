# First-Pass E2E Scoring Improvements TODO

- Status: active follow-up list
- Last updated: 2026-06-15

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

- [x] Treat blank suggestions as non-storable unconditionally.
  - Example from newer run:
    - `009-stale-contact-ticket.txt` wrote blank values for
      `eval.address.current.street`, `unit`, `state`, and `postal_code`.
  - Concrete change:
    - Extend the existing non-storable suggestion path to skip `newValue` values
      that are `null`, `undefined`, `""`, or whitespace-only strings.
    - Do this before building `applyInput` so intentional skips do not trip the
      applied-length invariant.
    - Record skipped blank suggestions in `ingestion-run.json`.
    - Add tests that blank suggestions are not applied and are still reported.

- [x] Add an in-memory applied-state map to the known-schema ingestor.
  - Concrete change:
    - Track current values by slug during the ingestion run.
    - Seed the map from explicit `--seed-preferences` values when present.
    - Update it after each successful apply.
    - Use it to decide whether a suggestion would overwrite a non-empty value.
  - First-pass scope:
    - optimize for reset E2E runs.
    - add backend active-preference initialization later only if non-reset runs
      become important.

- [x] Add overwrite diagnostics to `ingestion-run.json`.
  - Concrete change:
    - For every suggestion, record document identity, suggestion slug,
      `newValue`, optional existing value, decision, reasons, and whether it
      overwrote a non-empty active value.
    - For every blocked suggestion, record document path, suggestion slug,
      `newValue`, block reason, and current value if relevant.
    - Add summary counts:
      - `overwriteCount`
      - `blankSuggestionSkippedCount`
      - `forbiddenSuggestionBlockedCount`
      - `staleOrNoiseOverwriteBlockedCount`
    - Interpret counters precisely:
      - `overwriteCount` counts applied writes that replaced a non-empty value.
      - `staleOrNoiseOverwriteBlockedCount` counts prevented stale/noise
        overwrite attempts, not applied writes.
  - This makes future E2E failures attributable without manually diffing stored
    preferences.

- [x] Block forbidden and low-authority overwrites.
  - Examples:
    - `010-community-newsletter-email.txt` wrote `eval.address.current.city =
      Oakmont`.
    - `009-stale-contact-ticket.txt` damaged current address fields.
  - Concrete change:
    - Use `factContract.forbid` as an unconditional deterministic block.
      If a fact is effectively forbidden for a document, any suggestion for
      that fact from that document is blocked even when the target field is
      currently unset. Per-document `factContract.include` authorizes that
      document to extract facts listed in `factContractDefaults.forbid`.
    - Reuse the validator's `effectiveForbiddenFactKeys` helper so ingestion
      and corpus-truth semantics stay aligned, including intentionally missing
      facts that are derived as forbidden for current extract/corroborate docs.
    - Use manifest document metadata as the backstop for stale/noise overwrite
      protection:
      `evaluationRole.freshness`, `evaluationRole.authority`,
      `evaluationRole.expectedUse`, `evaluationRole.challengeTags`, and
      `sourceSpec.sourceFamily`.
    - Prevent documents marked stale/noise/guardrail from overwriting non-empty
      active values for target facts.
    - Keep blocked suggestions in the run report but do not apply them.

- [x] Update `ingestion-run.schema.json` in the same PR.
  - Add skipped-suggestion diagnostics, overwrite diagnostics, and summary
    counts.
  - Keep validation strict; do not add compatibility shims.

- [x] Add tests for document-order overwrite behavior.
  - Test sequence:
    - doc 1 applies correct current address.
    - doc 2 is stale/noise and suggests blank or conflicting address.
    - final exported memory should keep doc 1 values.
  - Include both blank overwrite and concrete wrong overwrite cases.
  - Include `factContract.forbid` blocking even when the document is not
    otherwise low-authority and even when the target field is unset.
  - Include seeded-value protection.
  - Include a legitimate first write from unset to value and verify it is not
    counted as an overwrite.
  - Include counter tests that distinguish applied overwrites from blocked
    attempts.

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
  - Basic score comparison can land before PR 1.
  - Overwrite-provenance comparison should wait for PR 1.

- [ ] Record backend model/config metadata in `evaluation-run.json`.
  - Concrete change:
    - Add wrapper support for `--model-label <label>` and `EVAL_MODEL_LABEL`.
    - Update `evaluation-run.schema.json`.
  - Reason:
    - Current artifacts cannot prove whether a run used `gemini-2.5-flash-lite`
      or `gemini-2.5-pro`.
  - Later separate work:
    - expose backend diagnostic metadata for the Vertex model actually loaded by
      the backend, then record it automatically.

## P1: Fix Form Scoring And Field-Map Gaps

- [ ] Add clean conditional field-map semantics.
  - Concrete change:
    - update `field-map.schema.json`, loaders, validation, and tests.
    - add a simple conditional shape for profile-dependent fields, for example
      `when: { factKey, equals }`.
    - do not preserve backwards compatibility if a cleaner shape is available.

- [ ] Fix I-9 citizenship checkbox mapping with conditional semantics.
  - Newer run showed structural overfills on `CB_1`, `CB_2`, `CB_3`, and
    `CB_4`, sourced from citizenship status.
  - Concrete change:
    - Map these checkbox fields as mutually exclusive citizenship-status fields
      where possible.
    - Add scorer tests that only the matching citizenship checkbox is scored as
      filled.
    - Add Elena/U.S.-citizen regression coverage so the conditional logic does
      not break the profile the original map was authored for.

- [ ] Review the LPR-specific A-number field scoring.
  - Both runs marked `3 A lawful permanent resident Enter USCIS or ANumber` as
    missing even though Alex is `alien authorized to work`.
  - Concrete change:
    - Make the field map/scorer conditional on citizenship status.
    - For alien-authorized profiles, the LPR-only A-number field should be a
      structural skip, not a required known field.
    - Keep the alien-authorized USCIS A-number field scored separately.
    - Resolve the current duplicate mapping where the LPR-only field and the
      alien-authorized USCIS field both map to
      `workAuthorization.uscisANumber`.

- [ ] Confirm date render equivalence in form scoring.
  - Older run marked values like `03141992` and `09302028` wrong when expected
    values were rendered as `03/14/1992` and `09/30/2028`.
  - Concrete change:
    - Fix this where filled-form classifications are computed, likely
      `eval-runner/snapshots.mjs`, not only in the form score aggregator.
    - Prefer render/digits-only metadata over date-only special cases.
    - Add tests for slash/no-slash date renderings and true mismatches.
    - Review any snapshot updates caused by changed classifications.

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
  - Generate this after the overwrite and field-map/scorer fixes land.

- [ ] Document how to run model comparisons.
  - Include:
    - how to set `VERTEX_MODEL_ID`
    - how to restart the backend
    - how to pass/record a model label
    - how to compare score reports between two run directories

## Later

- [ ] Add backend model introspection.
  - Expose the backend's actual loaded `VERTEX_MODEL_ID` through a safe
    diagnostic path.
  - Record it automatically in `evaluation-run.json`.

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

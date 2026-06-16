# Bug Failure Feedback A

- Status: review feedback
- Last updated: 2026-06-16
- Reviewed commit: `303ef28` (`Improve prompt guidance and form-fill failure detail`)

## Findings

### P1: The product-side extraction bug is still only prompt-mitigated

The original product concern was that document analysis accepted
absence/status text as a durable preference value. This commit improves the
prompt in `PreferenceExtractionService.buildExtractionPrompt`, but the backend
still accepts the same bad structured suggestion if the model returns it:

- `apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.ts:158`
- `apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.ts:159`
- `apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.ts:164`

The added test only asserts that the prompt contains the new instructions. It
does not cover the failure mode where the model ignores the prompt and returns:

```json
{
  "slug": "eval.address.current.postal_code",
  "newValue": "Address collection pending task completion",
  "sourceSnippet": "address: # Address collection pending task completion"
}
```

That suggestion would still flow through shape validation, string
canonicalization, no-change filtering, and then appear in the response as an
accepted suggestion. In known-schema auto-apply it can still overwrite active
memory. In normal product UI it can still be surfaced to the user as a plausible
preference suggestion.

Recommendation: keep the prompt update, but add a deterministic document-
analysis filter for high-signal absence/status values before accepted
suggestions are returned. Start narrow and origin-scoped rather than adding a
global `PreferenceService` write ban. A focused unit test should prove the bad
flash-lite suggestion is filtered into `filteredSuggestions`, not merely that
the prompt asks the model not to produce it.

### P2: Form-fill containment is good, but it is downstream of corrupted memory

The new max-length guard is a useful safety improvement:

- `apps/backend/src/modules/preferences/form-fill/pdf-field-extractor.service.ts:64`
- `apps/backend/src/modules/preferences/form-fill/form-fill-validator.service.ts:205`
- `apps/backend/src/modules/preferences/form-fill/form-fill-validator.service.ts:210`

It changes the original ZIP failure from an unrecoverable PDF write into a
skipped field with a `pdf_text_max_length_blocked` validation event. That is a
clear improvement for live E2E resilience and form-fill diagnostics.

However, this does not prevent bad active memory from being stored. The
database score would still be wrong, and any downstream field without a
restrictive `maxLength` could still receive the placeholder value. Treat this
as containment, not as a fix for the document-analysis bug.

Recommendation: document this distinction in the follow-up plan and make the
next backend checkpoint target suggestion filtering or inferred-write
validation.

### P2: Failure detail is more useful, but failed responses still drop stage context

The stage-aware warning is helpful:

- `apps/backend/src/modules/preferences/form-fill/form-fill.service.ts:156`
- `apps/backend/src/modules/preferences/form-fill/form-fill.service.ts:164`
- `examples/eval/scripts/fill-form.mjs:383`

The eval runner now surfaces a useful terminal detail instead of only
`status was failed`. That addresses the artifact-debugging pain from the failed
run.

One limitation: `emptyResponse` still resets `totalFields`, `filledFields`,
`skippedFields`, and `validationEvents` to empty for every failed stage:

- `apps/backend/src/modules/preferences/form-fill/form-fill.service.ts:193`

That is acceptable for field-extraction failures, but for a post-validation
`pdf_fill` failure it loses useful context that was already computed. The new
max-length guard should make the original ZIP case avoid `pdf_fill`, so this is
not urgent. If future PDF write failures remain hard failures, consider a
failed response shape that preserves extracted field count and validation
summary where available.

## What Looks Good

- The prompt update is clear and directly names the observed failure pattern.
- The PDF text `maxLength` metadata is extracted and passed through the prompt,
  validator, unit tests, and e2e test.
- The SSN normalization path was correctly shared between validation and PDF
  writing, so `000-00-0292` is measured as `000000292` for max-length checks.
- The eval runner terminal error now includes the first useful backend warning
  while preserving redacted response artifacts.
- The implementation keeps eval manifest truth out of backend product code,
  which is the right boundary.

## Suggested Next Step

Add a narrow deterministic backend filter in document analysis:

- Scope it to inferred document-analysis suggestions, not direct user writes.
- Reject scalar strings that are clearly absence/status markers.
- Preserve the rejected item in `filteredSuggestions` with a new filter reason.
- Add a regression test for the exact YAML-comment value from the flash-lite
  run.
- Then rerun the flash-lite known-schema E2E and compare against the failed run.

If you still want to avoid filtering at this stage, the minimum next step should
be a live flash-lite rerun proving the prompt-only mitigation actually changes
the model output for document 008.

## Verification Run

Passed locally:

```bash
pnpm --filter backend exec jest src/modules/preferences/document-analysis/preference-extraction.service.spec.ts src/modules/preferences/form-fill/form-fill-validator.service.spec.ts src/modules/preferences/form-fill/form-fill.service.spec.ts src/modules/preferences/form-fill/pdf-field-extractor.service.spec.ts src/modules/preferences/form-fill/pdf-field-filler.service.spec.ts --runInBand
node --test examples/eval/scripts/fill-form.test.mjs
pnpm --filter backend test:e2e:tests-only -- form-fill.e2e-spec.ts
```

# Plan: Duplicate-Slug Consolidation for Preference Extraction

## Summary
- Keep duplicate handling entirely post-extraction and make it the primary dedup mechanism.
- Treat this work as both a new consolidation feature and a bug fix for the current duplicate-before-`NO_CHANGE` ordering bug.
- Preserve auditability by keeping raw duplicate inputs in `filteredSuggestions`, showing their evidence in the UI, and giving all analysis results stable semantic IDs.

## Key Changes
- Refactor `PreferenceExtractionService` into explicit phases:
  - First-pass extraction returns raw candidates from the document.
  - `transformAiResult()` assigns stable internal IDs immediately using the original AI response position, e.g. `candidate:<originalIndex>`.
  - Pre-filter only hard-invalid candidates: `UNKNOWN_SLUG` and `MISSING_FIELDS`.
  - Group remaining candidates by exact `slug`.
  - For single-candidate groups, run a shared normalization helper.
  - For multi-candidate groups, run one consolidation call per slug group, then normalize the merged result through the same helper.
- Remove the misleading second parameter from `transformAiResult()`.
  - It should no longer accept `userId` or `analysisId`.
  - It should only map AI output into internal suggestion objects with semantic internal IDs.
- Extract a shared synchronous normalization helper with a discriminated-union return:
  - `{ kind: 'accepted'; suggestion: PreferenceSuggestion } | { kind: 'filtered'; suggestion: FilteredSuggestion }`
  - Responsibilities: correct `operation`, correct `oldValue`, and filter `NO_CHANGE`.
  - Use the same helper for ordinary single candidates and consolidated outputs so the rules stay identical.
- Consolidation prompt/schema design:
  - Add dedicated prompt/schema helpers in the document-analysis module.
  - Input: target slug, current DB value for that slug, and all surviving duplicate candidates with `operation`, `oldValue`, `newValue`, `confidence`, `sourceSnippet`, and `sourceMeta`.
  - The Zod schema must lock `slug` to the exact input slug for that call.
  - Prompt rules:
    - Return exactly one suggestion for the provided slug.
    - Do not invent facts or change the slug.
    - For array values, merge complementary values without duplicates.
    - For scalar values, choose the best-supported value from the candidates.
    - Pick one existing candidate snippet/meta as representative evidence.
    - Return a confidence score in `[0,1]` based on support and consistency across the duplicate candidates.
- ID strategy:
  - Use original AI response positions for all `<index>` placeholders.
  - Internal IDs:
    - Accepted raw candidate: `candidate:<originalIndex>`
    - Accepted consolidated suggestion: `consolidated:<slug>`
    - Filtered hard-invalid item: `filtered:invalid:<originalIndex>`
    - Filtered raw duplicate audit item: `filtered:duplicate:<slug>:<originalIndex>`
    - Synthetic consolidated `NO_CHANGE` item: `filtered:consolidated-no-change:<slug>`
  - `DocumentAnalysisService` prefixes these stable internal IDs with `analysisId` and does not reindex them.
  - Final client-visible IDs become `analysisId:<internalId>`.
- Duplicate-group behavior:
  - If consolidation succeeds and normalizes to a real change, return one final merged suggestion with ID `analysisId:consolidated:<slug>`.
  - Keep all raw duplicate inputs as `DUPLICATE_KEY` filtered items for auditability.
  - If consolidation normalizes to `NO_CHANGE`, return no accepted suggestion for that slug, add one synthetic `NO_CHANGE` filtered item using the consolidated output, and still keep the raw duplicates as `DUPLICATE_KEY` audit items.
  - Synthetic `NO_CHANGE` filtered item fields:
    - `id`: `filtered:consolidated-no-change:<slug>`
    - `slug`: target slug
    - `operation`: normalized operation
    - `oldValue`: actual existing DB value
    - `newValue`: consolidated value
    - `confidence`: consolidated confidence
    - `sourceSnippet` / `sourceMeta`: representative evidence selected by consolidation
    - `filterDetails`: `Consolidated <candidateCount> candidates for <slug>, but the merged value matches the existing preference.`
  - If consolidation throws or fails validation, keep the first valid candidate for that slug, filter the rest as `DUPLICATE_KEY`, and log the fallback explicitly.
- Logging:
  - Keep the repo’s current tagged-string style, not JSON logs.
  - Add:
    - `[DUPLICATE_GROUP_DETECTED] slug=... candidateCount=...`
    - `[DUPLICATE_GROUP_CONSOLIDATED] slug=... candidateCount=...`
    - `[DUPLICATE_GROUP_NO_CHANGE] slug=... candidateCount=...`
    - `[DUPLICATE_GROUP_FALLBACK_FIRST] slug=... candidateCount=... reason=...`
  - The fallback log must clearly state that the first valid candidate was kept.
- Latency policy for v1:
  - One consolidation call per duplicate slug group.
  - No batching in v1.
  - No new timeout/circuit-breaker in this change.
  - Log duplicate-group counts so real-world latency can be assessed later.
- UI:
  - Keep GraphQL DTOs unchanged; do not add `evidence[]`.
  - Update the filtered suggestions section to show `sourceSnippet` and page/line metadata for all filtered items.
  - Keep the main accepted suggestion card on the current single-snippet display.

## Public API / Types
- No new GraphQL fields, enums, or input types.
- `PreferenceSuggestion` and `FilteredSuggestion` keep the same shape.
- Behavioral changes:
  - All analysis suggestion IDs change from sequential reindexing to stable semantic IDs derived from original AI positions or consolidation type.
  - `filteredSuggestions` becomes the explicit audit trail for raw duplicate inputs.
  - `filteredSuggestions` may include a synthetic consolidated `NO_CHANGE` item.

## Test Plan
- Checkpoint 1: update `preference-extraction.service.spec.ts` first.
  - Regression: first duplicate would become `NO_CHANGE`, later duplicate is genuinely new, and the later value survives.
  - Duplicate group consolidates into one final suggestion.
  - Consolidated suggestion follows the semantic ID path.
  - Raw duplicate inputs remain in `filteredSuggestions` with `DUPLICATE_KEY`.
  - Consolidated result still gets `operation` and `oldValue` corrected.
  - Consolidated confidence is preserved from the second-pass response.
  - Consolidated result that matches the DB value produces one synthetic `NO_CHANGE` filtered item plus raw duplicate audit items.
  - Invalid consolidation output or thrown consolidation call falls back to first-kept and logs `[DUPLICATE_GROUP_FALLBACK_FIRST]`.
  - Groups reduced to one surviving candidate after pre-filter do not call consolidation.
  - Non-duplicate happy path assertions are updated to the new ID shape, e.g. `candidate:<originalIndex>`.
- Checkpoint 2: implement the refactor in small increments and run targeted backend tests after each increment.
  - Unit verification: `pnpm --filter backend exec jest src/modules/preferences/document-analysis/preference-extraction.service.spec.ts`
- Checkpoint 3: add one non-optional API-level test in `document-analysis.e2e-spec.ts`.
  - Hit `POST /api/preferences/analysis` with a small text file.
  - Mock `generateStructuredWithFile()` to return duplicate candidates.
  - Mock `generateStructured()` to return the merged result.
  - Assert the response includes one merged suggestion plus filtered duplicate audit items.
  - Assert `generateStructured()` was called exactly once for the one duplicate slug group.
  - Assert one ordinary non-duplicate suggestion also uses the new stable ID format.
- Checkpoint 4: manual frontend smoke check.
  - Accepted suggestion cards still show one representative source snippet.
  - Filtered items show source snippet and page/line metadata.
  - Duplicate-merge, synthetic `NO_CHANGE`, and fallback-first behavior are understandable from the filtered section.

## Assumptions And Defaults
- Duplicate handling is keyed by exact slug match only.
- All `<index>` values in IDs refer to original positions in the initial AI response array.
- Confidence for consolidated suggestions comes from the consolidation AI response, with no max/average post-processing in v1.
- `DocumentAnalysisService` prefixes stable extraction IDs with `analysisId` and never reindexes them.
- This change does not add new pre-apply value-type filtering in document analysis; persistence safety already exists in `PreferenceService.setPreference()`.
- Per-group AI calls are the deliberate v1 tradeoff because they keep schemas simple and failures isolated.


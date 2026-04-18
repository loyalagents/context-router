# Preference Extraction Deduping: Implementation Notes

## Summary

Duplicate-slug handling in document analysis was changed from "keep the first suggestion and drop the rest" to a post-extraction consolidation flow.

This work also fixed the existing ordering bug where the first duplicate could be marked `NO_CHANGE` and still prevent a later valid duplicate from surviving.

## Backend Changes

### 1. Extraction service refactor

`PreferenceExtractionService` now processes AI output in phases:

1. Transform the first-pass AI response into internal suggestion objects with stable IDs like `candidate:<originalIndex>`.
2. Pre-filter only hard-invalid suggestions:
   - `UNKNOWN_SLUG`
   - `MISSING_FIELDS`
3. Group the remaining suggestions by exact `slug`.
4. For single-candidate groups, run normal correction/no-change logic directly.
5. For duplicate groups, call a second structured-AI consolidation pass for that slug, then normalize the consolidated result through the same correction/no-change path.

### 2. Shared normalization path

The correction logic was extracted into a shared normalization helper so both normal suggestions and consolidated suggestions follow the same rules:

- Correct `operation` based on whether the preference already exists
- Correct `oldValue` from actual DB state
- Filter `NO_CHANGE` when `newValue` already matches the stored value

### 3. Duplicate consolidation prompt/schema

Two new helper files were added:

- `apps/backend/src/modules/preferences/document-analysis/duplicate-consolidation.prompt.ts`
- `apps/backend/src/modules/preferences/document-analysis/duplicate-consolidation.schema.ts`

These define the second-pass prompt and a slug-locked Zod schema for the duplicate-group consolidation call.

### 4. Stable public IDs

`DocumentAnalysisService` no longer reindexes suggestions by array position. It now prefixes the stable extraction IDs with the generated `analysisId`.

Examples:

- accepted raw suggestion: `analysisId:candidate:2`
- accepted consolidated suggestion: `analysisId:consolidated:food.dietary_restrictions`
- filtered duplicate audit item: `analysisId:filtered:duplicate:food.dietary_restrictions:1`
- synthetic consolidated no-change item: `analysisId:filtered:consolidated-no-change:food.dietary_restrictions`

### 5. Filtered duplicate audit trail

On successful consolidation, the merged suggestion is returned as the actionable suggestion and the raw duplicate inputs are kept in `filteredSuggestions` as audit items.

If the consolidated result normalizes to `NO_CHANGE`, no accepted suggestion is returned for that slug. Instead:

- a synthetic `NO_CHANGE` filtered item is returned for the consolidated result
- the raw duplicate inputs are still returned as `DUPLICATE_KEY` audit items

If consolidation fails, the first valid candidate is kept and the remaining duplicates are filtered with an explicit fallback log entry.

### 6. Logging

The duplicate flow now emits tagged log lines in the repo's existing string style:

- `[DUPLICATE_GROUP_DETECTED]`
- `[DUPLICATE_GROUP_CONSOLIDATED]`
- `[DUPLICATE_GROUP_NO_CHANGE]`
- `[DUPLICATE_GROUP_FALLBACK_FIRST]`

## Frontend Change

The filtered suggestions section in `SuggestionsList.tsx` now shows:

- `sourceSnippet`
- page metadata when available
- line metadata when available

This makes duplicate audit items reviewable in the UI instead of showing only slug/value/filter text.

## Tests Added / Updated

### Unit tests

`preference-extraction.service.spec.ts` was updated to cover:

- duplicate-group consolidation into one merged suggestion
- the regression where a later duplicate must survive even if the first would have become `NO_CHANGE`
- fallback-to-first behavior when consolidation fails
- synthetic consolidated `NO_CHANGE` filtered items
- skipping consolidation when only one candidate survives pre-filtering
- stable internal ID expectations
- correction of consolidated `operation` and `oldValue`

### API-level e2e test

`test/e2e/document-analysis.e2e-spec.ts` now includes a `POST /api/preferences/analysis` test that verifies:

- duplicate candidates are consolidated
- raw duplicates remain in `filteredSuggestions`
- ordinary non-duplicate suggestions preserve stable IDs
- the second AI call runs exactly once for one duplicate slug group

## Verification Run

The following commands were run successfully during implementation:

```bash
pnpm --filter backend exec jest src/modules/preferences/document-analysis/preference-extraction.service.spec.ts
env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand --runTestsByPath test/e2e/document-analysis.e2e-spec.ts
pnpm --filter backend build
```

## Notes

- No new GraphQL DTO fields were added.
- `evidence[]` was intentionally deferred; auditability currently comes from filtered duplicate entries plus representative evidence on the final merged suggestion.
- Pre-apply value-type validation in the document analysis response remains out of scope for this change; persistence safety still comes from `PreferenceService.setPreference()`.

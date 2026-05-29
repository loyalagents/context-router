# First Corpus Truth Validation Update Implementation Plan

- Status: implemented
- Date: 2026-05-28
- Read when: implementing the first document-body inclusion/exclusion validation layer for eval corpora

## Goal

Add the first deterministic corpus-truth validation layer for generated eval
documents. The validator should use `profile.yaml` and `corpus-plan.json` to
prove that selected facts appear in generated document bodies and that selected
forbidden facts do not appear before the corpus is used for extraction scoring.

## Context

Current validation already checks fixture schemas, seed determinism, plan and
manifest drift, field-map coverage, document inventory, limited high-confidence
fact presence, and mixed file-type format rules.

Current gap:

- most `documents[].factKeys[]` entries are metadata-only and are not checked
  against document bodies
- there is no document-level exclusion contract
- noise documents are not exhaustively checked for leaked current identifiers
- intentionally missing work-authorization identifiers are not body-checked

## Key Decisions

- Add optional plan-owned `documents[].forbiddenFactKeys[]`.
- Do not project `forbiddenFactKeys[]` into `manifest.json`.
- Keep the implementation validation-only: no backend document ingestion, no
  extraction scoring, no real LLM calls, and no runner snapshot behavior
  changes.
- Treat exact/variant positive checks for date, ZIP, state, and citizenship as
  hard errors for `extract` and `corroborate` documents.
- Treat pattern-only checks for null/missing facts as warnings.
- Keep fuzzy name/address matching limited to high-confidence noise-leak
  checks in this batch.

## Checkpoints

1. Schema and tests first:
   - Add `forbiddenFactKeys[]` to `corpus-plan.schema.json`.
   - Add validator tests for accepted forbidden facts, area refs, missing refs,
     positive missing values, forbidden present values, noise leaks, missing
     work-authorization patterns, and generator prompt output.
   - Run focused failing tests before implementation when practical.

2. Matcher support:
   - Expand `factValueVariants()` for dates, ZIP, state, and citizenship.
   - Expand the set of exact checkable body facts.
   - Add helper constants/functions for high-confidence noise identifiers and
     work-authorization number-like patterns.

3. Validator data flow:
   - Pass the matching corpus-plan document into document-body validation.
   - Validate `forbiddenFactKeys[]` in plan-only and normal validation.
   - Add `DOCUMENT_FORBIDDEN_FACT_PRESENT`.
   - Add a noise leak issue code for high-confidence current identifiers.
   - Add warning-level pattern checks for intentionally missing
     work-authorization identifiers.

4. Generator prompt:
   - Include a dedicated forbidden fact section in `buildDocumentPrompt()`.
   - Include only forbidden fact values for explicitly forbidden non-null
     forbidden keys.

5. Nina corpus:
   - Add explicit `forbiddenFactKeys[]` across the 100-document Nina realistic
     corpus plan.
   - Noise documents forbid high-confidence current identifiers.
   - Non-noise documents forbid sensitive identifiers not listed in
     `factKeys[]`, especially SSN, personal email, work email, and
     intentionally missing work-authorization identifiers.
   - Refresh `validation-report.json`.

6. Closeout:
   - Run the verification commands.
   - Update `validation/TODO.md`.
   - Write `implementation-summary.md` with implemented issue codes, schema
     changes, matcher behavior, Nina corpus-plan update strategy, commands run,
     validation status, and remaining gaps.

## Verification Commands

```bash
pnpm eval:test
pnpm eval:validate --user nina-meera-patel --corpus realistic --write-report
pnpm eval:validate
pnpm eval:verify
```

## Risks

- False positives are likely if fuzzy matching is too aggressive. Keep fuzzy
  checks as warnings or defer them.
- Existing generated documents may need corpus-plan exclusions tuned to avoid
  declaring impossible negative constraints.
- Plan-only validation must remain useful before document bodies exist.

## Acceptance Criteria

- `forbiddenFactKeys[]` is schema-valid and plan-owned.
- Plan validation catches bad forbidden fact references.
- Document-body validation checks first-wave positive facts and forbidden facts.
- Nina's 100-document corpus validates with zero errors and zero warnings.
- Eval script tests and full fixture validation pass.
- `validation/TODO.md` and this batch summary reflect the new validation
  boundary and remaining work.

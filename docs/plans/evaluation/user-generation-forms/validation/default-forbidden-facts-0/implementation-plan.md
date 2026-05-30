# Default Forbidden Facts Implementation Plan

## Goal

Make absence contracts systematic by adding top-level `defaultForbiddenFactKeys[]` to `corpus-plan.json` and computing each document's effective forbidden fact set deterministically during validation and generation.

## Scope

- Extend the corpus-plan schema with optional top-level `defaultForbiddenFactKeys: string[]`.
- Keep default forbidden facts plan-owned; do not write them into `manifest.json`.
- Validate top-level default forbidden refs as profile leaf facts. Missing refs and area refs are validation errors; null leaf values are allowed.
- Compute effective forbidden facts from defaults, document-level `forbiddenFactKeys[]`, and applicable `intentionallyMissing[].factKey`, minus the document's declared `factKeys[]`.
- Reject document-level `forbiddenFactKeys[]` entries that conflict with the same document's `factKeys[]`.
- Apply intentionally missing derived forbidden facts only to current, non-noise `extract` and `corroborate` documents.
- Update generator prompts so they receive the effective forbidden keys and only the non-null values for those effective keys.
- Reduce Nina's repeated forbidden metadata by moving the shared baseline into `defaultForbiddenFactKeys[]`.

## Checkpoints

1. Update schema and shared helper logic.
2. Add validator plan checks and effective forbidden body checks.
3. Update generator prompt construction and manifest projection tests.
4. Rewrite Nina's corpus plan to use defaults, then refresh validation report.
5. Run targeted and full eval validation commands.

## Acceptance

- Existing corpus plans remain valid because `defaultForbiddenFactKeys[]` is optional.
- Nina focused validation passes after the metadata rewrite.
- Defaults are visible to validation and generation but absent from `manifest.json`.
- A document may declare a default-forbidden fact in `factKeys[]`; the fact is removed from that document's effective forbidden set.

# Templates And Scaffold Implementation Summary

- Status: complete
- Date: 2026-05-20

## What Changed

- Added trusted repo-local template modules under `examples/eval/templates/`.
- Added deterministic template discovery, rendering helpers, seeded choice
  support, render instrumentation, and byte-stable rerender checks.
- Added `examples/eval/scripts/scaffold.mjs` with render mode, init-user mode,
  optional scenario skeleton generation, target-user seed derivation, and
  validation after generation.
- Added `examples/eval/schemas/template.schema.json`.
- Added shared fixture utilities in `examples/eval/scripts/shared.mjs` so seed
  derivation, fact classification, JSON formatting, and hash helpers are shared
  by seed generation, validation, rendering, and scaffold generation.
- Renamed the eval test script surface to `pnpm eval:test`.

## Contract Cleanup

- Manifest `seed` is now required. Scaffold defaults it to
  `<userId>__<corpusId>` and accepts `--seed` overrides matching
  `^[a-z0-9_-]+$`.
- Manifest `distribution` and document `note` metadata were removed.
- Document count is derived from `documents.length`.
- `documents[].template` is optional and is omitted for hand-authored
  documents.
- Document `category` is now a closed enum:
  `identity`, `address-contact`, `hr-onboarding`, `payroll-tax`,
  `work-authorization`, `employer-context`, `partial-conflicting`, `noise`.
- Elena's hand-authored `realistic` manifest and validation report were
  rewritten to the cleaned manifest contract.

## Template And Scaffold Behavior

- Template ids are path-derived and validated against
  `templates/<category>/<slug>.mjs`.
- Template discovery and scaffold selection sort deterministically.
- Template helpers enforce declared fact access, leaf-only area rules,
  non-null required facts, scalar-vs-array helper use, deterministic date
  formatting, and deterministic `choose()` output.
- Scaffold selection is metadata-only and covers non-null selected field-map
  facts not already covered by non-null seed preferences.
- Omitted `--count` renders exactly the required coverage set. Explicit
  `--count` fills from eligible unselected templates and rejects too-small or
  too-large counts.
- `--missing` writes deterministic `intentionallyMissing[]` entries only for
  selected-form facts that are present as null profile leaves.
- Generated JSON is two-space indented with trailing newlines. Template
  document output is written verbatim.
- Validation failures leave generated files on disk and return non-zero.

## Fixtures Added

- Added six starter templates across `identity`, `address-contact`, and
  `hr-onboarding`.
- Added Elena's generated `template-smoke` corpus.
- Added `scenarios/elena-marquez-i9-template-smoke/` as a generated scenario
  skeleton with no expected snapshots.

## Verification

Ran:

```bash
pnpm eval:derive-seeds
pnpm eval:test
pnpm eval:validate --user elena-marquez --corpus realistic
pnpm eval:validate --user elena-marquez --corpus template-smoke
pnpm eval:validate --scenario elena-marquez-i9-template-smoke
pnpm eval:validate
pnpm eval:scaffold --user elena-marquez --corpus template-smoke --form i-9 --scenario elena-marquez-i9-template-smoke --force
git diff --exit-code examples/eval/users/elena-marquez/corpora/template-smoke examples/eval/scenarios/elena-marquez-i9-template-smoke
```

Results:

- Seed derivation produced no fixture diff.
- Eval tests passed.
- Focused and full validation passed.
- Re-rendering Elena's `template-smoke` corpus and scenario produced no diff.

## Deferred

- No scenario runner or snapshot comparison.
- No LLM polish.
- No backend product behavior.
- Greedy template selection is intentionally kept simple for the small V1
  hand-curated template library.

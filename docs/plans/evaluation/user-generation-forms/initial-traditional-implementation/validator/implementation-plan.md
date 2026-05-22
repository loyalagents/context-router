# Batch 2 Implementation Plan: Validator

## Summary

Add `pnpm eval:validate` for deterministic local fixture validation under `examples/eval/`.

This remains fixture/script infrastructure: no templates, scaffold generation, template renderer, scenario runner, document-body analysis, or backend runtime behavior changes. The only backend edit is extracting static preference catalog data to JSON so the validator can check seed slugs and value types against the real backend catalog.

## Key Decisions

- Add root scripts:
  - `"eval:validate": "node examples/eval/scripts/validate.mjs"`
  - `"eval:test": "node --test examples/eval/scripts/*.test.mjs"`
- Use `ajv` for JSON Schema validation and hand-written checks for cross-file semantics.
- Add `ajv` as a root dev dependency; keep `yaml`.
- Extract only `PREFERENCE_CATALOG` data from `apps/backend/src/config/preferences.catalog.ts` to sibling `preferences.catalog.json`.
- Keep `preferences.catalog.ts` as the typed wrapper and preserve existing exports: `PreferenceEvidence`, `PreferenceValueType`, `PreferenceDefinition`, and `PREFERENCE_CATALOG`.
- Preserve catalog key insertion order during JSON extraction.
- The TS wrapper imports JSON and exports `PREFERENCE_CATALOG = catalogData as Record<string, PreferenceDefinition>`.
- Validator reads `apps/backend/src/config/preferences.catalog.json` directly as a one-way fixture-tools dependency on backend catalog truth.
- Runtime catalog validation lives in the validator, not the backend wrapper.
- Keep `intentionallyMissing[]` schema closed; authors should use `reason` and `expectedBehavior`, not a new `note`.

## CLI Shape

- `pnpm eval:validate`: validate all fixtures.
- `--user <userId>`: validate all corpora for one user.
- `--user <userId> --corpus <corpusId>`: validate one corpus.
- `--scenario <scenarioId>`: full transitive validation of the scenario and referenced user, corpus, form, field map, seed output, and coverage.
- `--form <formId>`: validate one form’s generated fields and field map if present; no profile fact resolution runs in form-only mode.
- `--corpus` without `--user` is an error.
- `--write-report` is allowed only with exactly one corpus: `--user <id> --corpus <id>`. Other combinations error clearly.
- Exit codes: `0` pass, `1` validation failures, `2` unsupported CLI or usage error.

## Contract Cleanups

- Keep `documents[].factKeys`, but make entries leaf-only profile fact keys. Area refs such as `address.current` become invalid.
- Update Elena’s manifest by expanding `address.current` to concrete leaves used by each document.
- Keep `detailTier`, but make it pure richness:
  - enum becomes `hero | medium | brief`
  - replace current `detailTier: "noise"` with `brief`
  - keep noise semantics in `category: "noise"` and `expectedUse: "ignore"`
- Enforce leaf-only `factKeys` in validator semantic checks, not JSON Schema.
- Fix seed generation sorting in `generate-seed-preferences.mjs` to ordinal comparison:
  - `left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0`

## Validator Checks

- Profile:
  - Parse and schema-validate `profile.yaml`.
  - Require folder user ID to match profile `userId`.
  - Collect leaf fact keys; arrays and `null` are leaves, objects are areas.
  - Require `seedPreferences[].factKey` to resolve to a leaf, allowing `null`.
  - Reject duplicate seed preference slugs.
  - Validate seed slugs and non-null value types against the real backend catalog JSON.

- Seed determinism:
  - Recompute seed preferences from `profile.yaml`.
  - Compare byte-for-byte with `seed-preferences.generated.json`, including sort order, two-space JSON, and trailing newline.
  - On mismatch, fail with guidance to run `pnpm eval:derive-seeds`.

- Corpus manifest:
  - Schema-validate `manifest.json`.
  - Require path IDs to match manifest `userId` and `corpusId`.
  - Require unique `forms[]`, document IDs, and document paths.
  - Require every `forms[]` entry to have `forms/<formId>/field-map.json`.
  - Require `distribution.documentCount === documents.length`.
  - Require listed document paths to be relative, non-escaping, under `documents/`, and existing.
  - Require every actual file under `documents/` to be listed.
  - Do not read document bodies in Batch 2.
  - Require every document `factKeys[]` entry to resolve to a non-null profile leaf.
  - Require `category === "noise"` documents to have `expectedUse === "ignore"`.
  - Require `expectedUse === "ignore"` documents to have `factKeys.length === 0`.

- Field maps:
  - Pre-pass `fields[]` before Ajv to produce clear errors for invalid `mode`, missing mode-specific fields, and field indexes.
  - Schema-validate every present `field-map.json`.
  - Require `formId` to match the folder and `fields.generated.json`.
  - If extraction status is `ok`, require exact exhaustiveness against generated fields: all indexes, no duplicates, and matching `pdfFieldName`.
  - For user/corpus/scenario validation, require `mode: "fact"` keys to resolve to profile leaves; `null` facts are allowed.
  - In `--form` scope, run only schema and exhaustiveness checks because no profile is in scope.

- Intentional missing:
  - Require each missing `factKey` to exist and resolve to `null`.
  - Require `intentionallyMissing[].forms[]` to be a subset of manifest `forms[]`.
  - Require at least one listed form’s field map to map the missing fact.
  - Strict V1 rule: intentionally missing facts must not appear in any document `factKeys[]`, regardless of freshness.

- Scenario references:
  - Schema-validate `scenario.json`.
  - Require folder name to match `scenarioId`.
  - Require referenced user, corpus, form, form field map, and `start/prompt.md`.
  - Require scenario `formId` to appear in manifest `forms[]`.
  - If `expectedSnapshots[]` is non-empty, require matching `expected/<name>.json` files to exist and parse.

- Coverage:
  - For every non-null `mode: "fact"` field in a manifest form’s field map, require exact leaf coverage by either `seedPreferences[]` or a document `factKeys[]`.
  - Array facts satisfy coverage for scalar PDF fields; fill-time rendering/joining is out of scope for Batch 2.
  - Failure messages must name the form, field index, PDF field name, missing fact key, and suggested fix.

## Output Format

- Stdout groups errors by fixture area and ends with counts: profiles, corpora, forms, scenarios, errors, warnings.
- `--write-report` writes only to `examples/eval/users/<userId>/corpora/<corpusId>/validation-report.json`.
- The validator never writes a report at repo root or under `examples/eval/scripts/`.
- `validation-report.json` shape:
  - `{ "schemaVersion": 1, "status": "pass" | "fail", "summary": {...}, "issues": [...] }`
  - issues use `{ level, code, file, pointer, message, fix? }`
- `file` is repo-relative POSIX.
- `pointer` is RFC 6901 JSON Pointer for JSON files and dotted profile paths for YAML facts.
- Reports must not include timestamps, absolute paths, `process.cwd()`, or host-specific data.
- All filesystem reads resolve relative to the repo root computed from `import.meta.url`, never `process.cwd()`.

## Checkpoints

1. Contract and catalog cleanup:
   - Run sanity greps: `rg "detailTier" -- examples docs apps`, `rg "address\\.current\\\"" -- examples`, `rg "PREFERENCE_CATALOG" -- apps`.
   - Extract `preferences.catalog.json`; keep backend TS exports unchanged.
   - Add/update tests proving backend imports still read the same catalog data.
   - Update manifest schema `detailTier` enum.
   - Update Elena manifest to leaf-only `factKeys` and `brief` detail tiers.
   - Fix ordinal seed sort.
   - Run `pnpm eval:derive-seeds` and confirm no seed diff.
   - Run `pnpm --filter backend build`.
   - Run `pnpm test:backend:unit`.
   - Run `pnpm --filter backend test:db:up`, `pnpm --filter backend test:db:migrate`, and `pnpm --filter backend test:integration --testPathPattern=seed`.

2. Structural validator:
   - Add `validate.mjs`, Ajv schema loading, CLI scope parsing, root script, and exit-code behavior.
   - Add catalog-load validator test proving the JSON catalog is readable and contains expected slugs/value types.
   - Run `pnpm eval:validate --user elena-marquez --corpus realistic`.

3. Cross-reference validator:
   - Add profile fact collection, seed determinism, document inventory, scenario references, noise/ignore rules, and intentional-missing checks.
   - Ensure `--scenario` performs transitive validation through implemented layers.
   - Run `pnpm eval:validate --scenario elena-marquez-i9-section1`.

4. Form coverage validator:
   - Add field-map pre-pass, exhaustiveness, fact-key checks, manifest form field-map requirement, and coverage checks.
   - Run `pnpm eval:validate`.

5. Reports and docs:
   - Add `--write-report`.
   - Add focused `node:test` coverage and root `eval:test`.
   - Update `examples/eval/README.md`.
   - Write `validator/implementation-summary.md`.
   - Update `orchestration-plan.md`.
   - Update `schema-contract/implementation-summary.md` follow-ups to mark resolved: `pnpm eval:validate`, leaf-only `factKeys`, pure-richness `detailTier`, and real catalog seed validation.

## Test Plan

Run:

```bash
pnpm eval:test
pnpm eval:validate --user elena-marquez --corpus realistic
pnpm eval:validate --scenario elena-marquez-i9-section1
pnpm eval:validate --form i-9
pnpm eval:validate
pnpm eval:validate --user elena-marquez --corpus realistic --write-report
pnpm --filter backend build
pnpm test:backend:unit
pnpm --filter backend test:db:up
pnpm --filter backend test:db:migrate
pnpm --filter backend test:integration --testPathPattern=seed
```

Focused validator tests should cover passing Elena, stale seed output, invalid catalog slug, catalog value-type mismatch, missing document path, actual unlisted document file, area fact ref rejection, `detailTier: "noise"` rejection, field-map mode pre-pass errors, field-map index/name mismatch, missing profile fact, null fact acceptance, array fact coverage, invalid intentional-missing form reference, noise/ignore violations, unsupported CLI flag combinations, exit codes, report path, and transitive scenario validation.

Backend tests should confirm existing catalog consumers still work after JSON extraction.

## Deferred

- No document realism, thinness, repetition, or document-body text checks in Batch 2.
- No denormalized name consistency checks.
- No employer-vs-employee fact ownership checks until a fact ownership taxonomy exists.
- No requirement that every corpus contain noise documents unless the manifest contract later declares a noise expectation.
- No runner snapshot semantics beyond existence and parse checks for declared expected snapshots.
- No compatibility path for old area-style `factKeys` or `detailTier: "noise"`.
- Wiring `pnpm eval:validate` and `pnpm eval:test` into CI is deferred to a follow-up batch.

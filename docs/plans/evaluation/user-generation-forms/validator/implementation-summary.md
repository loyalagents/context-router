# Validator Implementation Summary

- Status: complete
- Date: 2026-05-18

## What Changed

- Added `examples/eval/scripts/validate.mjs` and root scripts
  `pnpm eval:validate` and `pnpm eval:validate:test`.
- Added `ajv` as a root dev dependency for JSON Schema validation.
- Added focused `node:test` coverage for validator success, reference failures,
  stale generated seeds, catalog checks, field-map errors, report writing,
  committed-report freshness, report determinism, CLI usage errors, and
  transitive scenario validation.
- Added deterministic corpus report output at
  `examples/eval/users/elena-marquez/corpora/realistic/validation-report.json`.

## Contract And Fixture Updates

- Extracted static backend preference catalog data to
  `apps/backend/src/config/preferences.catalog.json`.
- Kept `apps/backend/src/config/preferences.catalog.ts` as the typed wrapper
  preserving `PreferenceEvidence`, `PreferenceValueType`,
  `PreferenceDefinition`, and `PREFERENCE_CATALOG` exports.
- Updated backend Jest module extension order so extensionless imports keep
  resolving to the TypeScript wrapper instead of the same-basename JSON file.
- Made corpus document `factKeys[]` leaf-only profile fact references.
  Elena's old `address.current` area references were expanded to concrete
  address leaves.
- Changed manifest `detailTier` from `hero | medium | noise` to
  `hero | medium | brief`.
- Moved noise semantics to document `category` and `expectedUse`.
- Fixed seed preference generation to use ordinal slug sorting.
- Cleaned Elena's noise metadata so ignored documents do not declare facts and
  the manual-signature guardrail is no longer categorized or located under
  noise.

## Validator Behavior

- Validates profile, manifest, scenario, and field-map schemas.
- Checks seed preference determinism against committed generated JSON.
- Checks seed preference slugs and non-null value types against the real backend
  catalog JSON for the current backend catalog types:
  `string | boolean | enum | array`.
- Checks corpus document inventory, path safety, listed-vs-actual files,
  distribution document count, noise/ignore metadata, and document fact keys.
- Checks field-map exhaustiveness against `fields.generated.json`.
- Checks profile fact references in field maps, corpus documents,
  intentionally missing entries, and coverage.
- If `profile.yaml` cannot be loaded, profile-dependent semantic checks are
  skipped so the output stays focused on the root profile problem.
- `--scenario` performs transitive validation of the referenced user, corpus,
  form, field map, seed output, and coverage.
- `--form` performs only form and field-map structural validation because no
  profile is in scope.
- Failure output is grouped by fixture area and reports remain deterministic
  with repo-relative files and no timestamps.
- Formatted `report=` paths are relative to the runtime repo root, including
  temp fixture copies used by tests.
- V1 emits only error-level issues; warning-level reporting is reserved for a
  future rule that is genuinely non-blocking.

## Verification

Ran:

```bash
pnpm eval:derive-seeds
git diff -- examples/eval/users/elena-marquez/seed-preferences.generated.json
pnpm eval:validate:test
pnpm eval:validate --user elena-marquez --corpus realistic
pnpm eval:validate --scenario elena-marquez-i9-section1
pnpm eval:validate --form i-9
pnpm eval:validate
pnpm eval:validate --user elena-marquez --corpus realistic --write-report
```

Results:

- Seed regeneration produced no diff.
- Validator tests passed.
- All validator CLI entry points passed.
- `--write-report` wrote the deterministic Elena corpus report.

Backend verification also passed:

```bash
pnpm --filter backend build
pnpm test:backend:unit
pnpm --filter backend test:db:up
pnpm --filter backend test:db:migrate
pnpm --filter backend test:integration --testPathPattern=seed
```

## Deferred

- No document-body realism, thinness, or repetition checks.
- No denormalized name consistency checks.
- No employer-vs-employee fact ownership taxonomy.
- No eval runner or snapshot comparison beyond declared snapshot file existence
  and JSON parsing.
- CI wiring for `pnpm eval:validate` and `pnpm eval:validate:test` remains a
  follow-up.

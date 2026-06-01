# Realistic V2 Unified Manifest Implementation Summary

## What Changed

- Made `manifest.json` the canonical V2 corpus contract.
  - `schemaVersion: 2`.
  - Added `corpusKind`.
  - `realistic-generated` manifests require `artifactWorld`,
    `factContractDefaults`, and document `sourceSpec`.
  - `template-smoke` manifests use `factContract` and `evaluationRole` but do
    not carry fake `sourceSpec`.
- Removed `corpus-plan.json` from the realistic planning, generation,
  validation, repair, and promote paths.
- Retired `examples/eval/schemas/corpus-plan.schema.json`.
- Migrated committed corpora:
  - Alex realistic corpus is now a single full V2 `manifest.json`.
  - Elena and Samir template-smoke manifests are V2 template-smoke manifests.
- Hardened validation:
  - Work-authorization expiration, I-94 admission number, and foreign passport
    number are deterministic high-confidence declared facts.
  - Native-signal matching normalizes camelCase, snake_case, kebab-case, slash,
    and spaced labels.
  - Added warning-only undeclared I-9 target-field contradiction linting.
- Tightened generation prompts:
  - Missing-value contract is now passed as absent fact paths rather than
    reason/behavior prose that the model may echo.
  - Prompt still instructs artifacts to omit absent values unless the source has
    a native blank/null field.
- Follow-up cleanup:
  - Removed the vestigial `pnpm eval:manifest` command.
  - Updated contributor-facing eval docs to the V2 unified-manifest flow.
  - Aligned the parent orchestration/TODO docs and the historical 100-doc
    runbook notes so they no longer present the retired manifest projection as
    the current workflow.
  - Added manifest-contract validation for inverted `sourceSpec.lengthTarget`
    ranges.

## Important Files

- `examples/eval/schemas/manifest.schema.json`
- `examples/eval/scripts/plan-corpus.mjs`
- `examples/eval/scripts/generate.mjs`
- `examples/eval/scripts/validate.mjs`
- `examples/eval/scripts/repair-generation.mjs`
- `examples/eval/scripts/promote-preview.mjs`
- `examples/eval/scripts/scaffold.mjs`
- `examples/eval/README.md`
- `examples/eval/PLAYBOOK.md`
- `docs/plans/evaluation/user-generation-forms/orchestration-plan.md`
- `docs/plans/evaluation/user-generation-forms/TODO.md`
- `examples/eval/users/alex-i9-test/corpora/realistic/manifest.json`
- `examples/eval/users/elena-marquez/corpora/template-smoke/manifest.json`
- `examples/eval/users/samir-desai/corpora/template-smoke/manifest.json`

## Verification

Passed:

```bash
node --test examples/eval/scripts/plan-corpus.test.mjs examples/eval/scripts/generate.test.mjs examples/eval/scripts/validate.test.mjs examples/eval/scripts/repair-generation.test.mjs examples/eval/scripts/promote-preview.test.mjs examples/eval/scripts/user-corpus-workflow.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
pnpm eval:validate --user alex-i9-test --corpus realistic --write-report
pnpm eval:validate --user elena-marquez --corpus template-smoke --write-report
pnpm eval:validate --user samir-desai --corpus template-smoke --write-report
```

Follow-up cleanup verification also passed:

```bash
node --test examples/eval/scripts/plan-corpus.test.mjs examples/eval/scripts/generate.test.mjs examples/eval/scripts/validate.test.mjs examples/eval/scripts/repair-generation.test.mjs examples/eval/scripts/promote-preview.test.mjs
pnpm eval:test
```

`pnpm eval:validate` result:

```text
profiles=3 corpora=3 forms=6 scenarios=2 templates=7 errors=0 warnings=0
```

## Preview Status

No live Vertex preview was generated in this batch. The no-Vertex full workflow
test covers plan -> generate preview -> validate preview -> promote using the
unified manifest.

## Deferred Work

- Realism-focused auto-repair.
- Source-fact ownership metadata, especially for source-only phone values.
- Document ingestion runner: documents -> extracted facts -> scoring ->
  form-fill snapshot.
- Larger subjective prompt/style iteration and canonical corpus regeneration.

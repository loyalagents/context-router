# Realistic V2 Unified Manifest Implementation Plan

## Goal

Replace the realistic corpus two-file planning flow with one canonical V2
`manifest.json` contract, then harden deterministic validation and realism
warnings on that simpler foundation.

## Non-Goals

- Do not keep backwards compatibility with V1 eval manifests.
- Do not add a realism auto-repair loop.
- Do not add source-fact ownership metadata.
- Do not add the document ingestion extraction runner.
- Do not change backend product behavior.

## Contract

- `manifest.json` becomes the canonical corpus contract with
  `schemaVersion: 2`.
- `corpusKind` identifies corpus shape:
  - `realistic-generated`: artifact-first generated corpora.
  - `template-smoke`: template-authored smoke corpora.
- Realistic manifests include top-level `artifactWorld`,
  `factContractDefaults`, and `intentionallyMissing`.
- Document facts live in `documents[].factContract.include`.
- Document forbidden facts live in `documents[].factContract.forbid`.
- Document role metadata lives in `documents[].evaluationRole`.
- `sourceSpec` is required for `realistic-generated` documents and absent for
  `template-smoke` documents.
- `corpus-plan.json` is retired from the generation and validation flow.

## Checkpoints

1. Move the V2 corpus contract into `manifest.schema.json` and stop validating
   `corpus-plan.json`.
2. Update shared accessors so scripts consume V2 manifest documents directly.
3. Update `plan-corpus` to write full V2 `manifest.json` files.
4. Update generation, repair, promote, and validation to read only the unified
   manifest.
5. Migrate committed corpora and tests to V2 manifests.
6. Add deterministic work-authorization validation for expiration, I-94, and
   foreign passport facts.
7. Normalize native-signal lints and add warning-only undeclared I-9
   contradiction lints.
8. De-narrate missing-value prompt handling and committed Alex fixture text.
9. Verify, write the implementation summary, and update the parent TODO.

## Verification Commands

```bash
node --test examples/eval/scripts/plan-corpus.test.mjs examples/eval/scripts/generate.test.mjs examples/eval/scripts/validate.test.mjs examples/eval/scripts/repair-generation.test.mjs examples/eval/scripts/promote-preview.test.mjs examples/eval/scripts/user-corpus-workflow.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Optional Vertex smoke, only when credentials are configured:

```bash
pnpm eval:generate --user alex-i9-test --corpus realistic --backend vertex --model <model> --out /private/tmp/alex-realistic-v2-preview
pnpm eval:validate --user alex-i9-test --corpus realistic --documents-root /private/tmp/alex-realistic-v2-preview --report-out /private/tmp/alex-realistic-v2-preview/validation-report.json
```

## Rollback Notes

This PR intentionally breaks V1 manifest compatibility. Rollback is a normal git
revert of the schema, script, fixture, and test changes. Do not try to support
both V1 and V2 in the same path unless a later requirement explicitly asks for a
compatibility layer.

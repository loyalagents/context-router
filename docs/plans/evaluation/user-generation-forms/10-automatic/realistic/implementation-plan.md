# Realistic Corpus Generation V2 Implementation Plan

## Goal

Implement a schema-breaking V2 for AI-authored realistic corpus plans so the
generator writes source artifacts from a coherent user file bundle instead of
eval-shaped fact carriers.

## Context

- `examples/eval/scripts/plan-corpus.mjs` currently emits V1 plans centered on
  `documents[].factKeys`, `documents[].forbiddenFactKeys`, and `brief`.
- `examples/eval/scripts/generate.mjs` currently frames prompts as synthetic
  eval fixtures and asks the model to place fact keys.
- `examples/eval/scripts/validate.mjs` already has deterministic corpus-truth
  checks, manifest projection drift checks, structured file parseability, and
  warning support.
- `examples/eval/scripts/repair-generation.mjs` reuses generation prompts for
  deterministic preview repairs.

## Non-Goals

- Do not add document-ingestion extraction scoring.
- Do not add realism auto-repair.
- Do not change backend product behavior.
- Do not make `manifest.json` a second generation contract.

## V2 Contract

- `corpus-plan.json` uses `schemaVersion: 2`.
- Top-level `artifactWorld` stores deterministic, non-canonical source context.
- Top-level `factContractDefaults.forbid` replaces
  `defaultForbiddenFactKeys`.
- Planned document facts move from `documents[].factKeys` to
  `documents[].factContract.include`.
- Per-document forbidden facts move from `documents[].forbiddenFactKeys` to
  `documents[].factContract.forbid`.
- Rich artifact guidance lives in `documents[].sourceSpec`.
- `detailTier`, `authority`, `freshness`, `expectedUse`, and optional
  `challengeTags` live in `documents[].evaluationRole`.
- `manifest.json` remains a V1 inventory projection and gets
  `documents[].factKeys` from `factContract.include`.

## Checkpoints

1. Update corpus-plan schema and shared helpers.
2. Rebuild the I-9 planner around source artifact specs, artifact-world
   generation, status-aware work-authorization slot selection, and collision
   checks.
3. Rewrite generation prompts around source artifacts and structured fact
   contracts, with no body-facing eval vocabulary.
4. Update validation and repair-generation for V2 plan docs while preserving
   deterministic corpus-truth checks.
5. Add warning-only realism lints for eval language, native signals, source-spec
   length, stale cues, repeated skeletons, and missing-phone collisions.
6. Update tests, docs, and generated reports.

## Verification Commands

```bash
node --test examples/eval/scripts/plan-corpus.test.mjs examples/eval/scripts/generate.test.mjs examples/eval/scripts/validate.test.mjs examples/eval/scripts/repair-generation.test.mjs examples/eval/scripts/promote-preview.test.mjs examples/eval/scripts/user-corpus-workflow.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Optional, only if Vertex env is configured:

```bash
EVAL_GENERATION_MODEL=<model> pnpm eval:generate --user <userId> --corpus realistic --backend vertex --out /private/tmp/<userId>-realistic-preview
pnpm eval:validate --user <userId> --corpus realistic --documents-root /private/tmp/<userId>-realistic-preview --report-out /private/tmp/<userId>-realistic-preview/validation-report.json
```

## Risks And Rollback

- V2 intentionally breaks compatibility for existing `corpus-plan.json` files.
  Manifest-only template-smoke corpora must continue to validate.
- The highest-risk area is validation drift between plan docs and manifest
  projection. Keep projection centralized and covered by tests.
- If prompt realism changes make live generation noisier, keep deterministic
  validation strict and repair only blocking document-level failures.

## Closeout

- Write `implementation-summary.md` in this directory.
- Update `../TODO.md` to mark the realistic generation flow work complete and
  leave realism repair plus document-ingestion evaluation as follow-ups.

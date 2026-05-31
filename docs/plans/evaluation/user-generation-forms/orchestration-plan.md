# User Generation Forms Orchestration Plan

- Status: orchestration
- Read when: coordinating implementation work for reusable synthetic users, document corpora, and form-fill evaluation
- Source of truth: `docs/plans/evaluation/user-generation-forms/brainstorm.md`
- Last reviewed: 2026-05-31

## Purpose

This file tracks the implementation batches for the reusable synthetic user corpus and form-fill evaluation work.

The brainstorming doc describes the target architecture. This orchestration plan exists to keep the work split into reviewable batches, make progress visible, and ensure each batch leaves behind its own implementation plan and implementation summary.

## Workflow Rule For Each Batch

Before implementing a batch:

1. Create a subdirectory under:

   ```text
   docs/plans/evaluation/user-generation-forms/
   ```

2. Add an `implementation-plan.md` in that subdirectory.

3. The implementation plan should include:

   - goal
   - context and relevant source files
   - non-goals
   - checkpoints
   - verification commands
   - expected file moves or edits
   - risks or rollback notes
   - a final checkpoint to write `implementation-summary.md`
   - a final checkpoint to update this `orchestration-plan.md`

4. Execute the batch from that implementation plan.

5. At the end of the batch, add `implementation-summary.md` in the same subdirectory.

6. Update the status table in this file.

Do not use this orchestration plan as the detailed implementation plan for a batch. It is intentionally smaller and higher-level.

Script names for this initiative should use the `eval:<verb>` namespace.

## Status Legend

- `not-started`: no implementation subdir exists yet
- `planned`: implementation subdir and `implementation-plan.md` exist
- `in-progress`: implementation has started
- `complete`: implementation is done, verified, summarized, and this file is updated
- `deferred`: intentionally postponed

## Current Status

| Batch | Status | Plan Folder | Summary |
| --- | --- | --- | --- |
| 0. Canonical eval tree cleanup | complete | `eval-tree-cleanup/` | Consolidated old demo trees into one eval home. |
| 1. Schema and fixture contract | complete | `schema-contract/` | Defined profile, manifest, scenario, field-map, and seed projection contracts. |
| 2. Validator | complete | `validator/` | Added deterministic fixture validation and corpus report generation. |
| 3. Templates and scaffold | complete | `templates-scaffold/` | Added deterministic templates, scaffold generation, and template-smoke fixtures. |
| 4. Eval runner | complete | `eval-runner/` | Added deterministic local backend eval runs and filled-form snapshots. |
| 5. Polish and playbook | complete | `polish-playbook/` | Added no-DB verify/CI, runner diagnostics, and contributor playbook. |
| 6. Second I-9 user | complete | `second-i9-user/` | Added a second I-9 user, generated corpus, and runner snapshot. |
| 7. 100-document realistic generation | deferred | `100-doc-goal/` | Superseded by the smaller modular 10-document I-9 workflow; old active Nina/Elena realistic fixtures were pruned. |
| 8. 10-document automatic user corpus | complete | `10-automatic/user-corpus/` | Added deterministic I-9 corpus planning, preview validation, repair, promotion, and fixture cleanup. |

Current implemented state:

- Brainstorming docs exist in this directory.
- Batch 0 is complete.
- `examples/eval/` is the canonical fixture home.
- Old `examples/form-fill-demo/`, `examples/memory-demo/`, and `examples/memory-demo-simple/` trees have been removed.
- Batch 1 is complete.
- `examples/eval/schemas/` defines V1 profile, corpus manifest, scenario, and field-map contracts.
- Elena Marquez has a canonical `profile.yaml`, generated seed preferences,
  a `template-smoke` corpus, and a runner-owned I-9 template-smoke scenario
  fixture.
- The I-9 field map keeps user-specific inapplicability in profile null facts
  rather than encoding Elena-specific skip reasons in the form-scoped map.
- `pnpm eval:derive-seeds` derives committed seed preference JSON from profiles.
- `pnpm eval:validate` validates schemas, seed determinism, corpus document
  inventory, scenario references, field-map exhaustiveness, fact references,
  intentional missingness, and form coverage.
- `pnpm eval:test` runs the eval fixture script test suite.
- Manifest document `factKeys[]` are now leaf-only profile fact keys.
- Corpus manifests now carry a required deterministic `seed`; document count is
  derived from `documents.length`; scaffold-generated documents use optional
  `documents[].template` references; legacy `distribution` and document `note`
  metadata have been removed.
- `detailTier` is now a pure richness field (`hero`, `medium`, `brief`);
  noise semantics live in `category` and `expectedUse`.
- Static backend preference catalog data lives in
  `apps/backend/src/config/preferences.catalog.json`, with the existing TS
  wrapper preserving backend exports.
- Batch 3 is complete.
- `examples/eval/templates/` contains trusted repo-local `.mjs` template
  modules with deterministic helper-based rendering.
- `pnpm eval:scaffold` can initialize profile skeletons, render deterministic
  template corpora, write target-user seed preferences, run validation, and
  optionally write scenario skeletons.
- Elena Marquez now has a generated `template-smoke` corpus, plus
  `elena-marquez-i9-template-smoke` as a generated scenario skeleton.
- Batch 4 is complete.
- `pnpm eval:run --scenario <scenarioId>` validates a scenario, boots the
  backend test-app harness against the isolated backend test DB, hydrates
  active preferences from `profile.yaml` and generated seed preferences, calls
  `/api/form-fill/pdf`, and compares deterministic filled-form snapshots.
- `pnpm eval:run --scenario <scenarioId> --update-snapshots` is the only
  supported snapshot update path; normal runs never update snapshots.
- The runner uses deterministic structured-AI actions and never calls a real
  LLM, Auth0, browser, UI automation, deployed backend, or document-analysis
  ingestion path.
- `examples/eval/schemas/filled-form-snapshot.schema.json` validates
  `expected/filled-form.json` snapshots through `pnpm eval:validate`.
- `elena-marquez-i9-template-smoke` is now runner-owned and carries the first
  committed `filled-form` expected snapshot.
- `pnpm eval:scaffold` may still create first-time scenario skeletons, but it
  refuses to overwrite existing scenario directories even with `--force`.
- Batch 5 is complete.
- `pnpm eval:verify` is the local non-DB eval gate, running eval script tests
  and full fixture validation.
- Batch 7 is deferred and historical.
- The old active Nina and Elena `realistic` corpora were pruned from
  `examples/eval`; the current committed fixture set is intentionally centered
  on the smaller template-smoke fixtures plus the new 10-document workflow.
- Batch 8 is complete.
- `pnpm eval:plan-corpus` writes a deterministic 10-document I-9
  `corpus-plan.json` from a reviewed profile.
- `pnpm eval:manifest` projects a corpus plan to a manifest without AI calls.
- `pnpm eval:generate` supports Vertex generation previews with `--ids`,
  short-id regeneration, and explicit full replacement with `--overwrite`.
- `pnpm eval:repair-generation` validates a preview and regenerates only
  repairable document failures, refusing non-document validation errors.
- `pnpm eval:promote-preview` validates preview documents, copies them into
  the committed corpus, and rolls back committed corpus state if final
  validation fails.
- The validator now checks JSON/YAML body parseability and flags structured
  files wrapped in Markdown fences.
- CI includes a dedicated no-DB `eval-fixture-checks` job that runs
  `pnpm eval:test` and `pnpm eval:validate` from the repo root.
- `pnpm eval:run --scenario <scenarioId> --verbose` surfaces stack traces for
  unexpected runner-internal failures while preserving concise backend harness
  diagnostics.
- `examples/eval/PLAYBOOK.md` documents contributor workflows, ownership rules,
  report-driven repair, snapshot review, V1 limitations, and fixture
  repeatability coverage.
- Optional LLM polish and archetypes/factories were intentionally excluded from
  Batch 5 and remain deferred future expansion work.
- Batch 6 is complete.
- Samir Desai is the second normalized synthetic I-9 user fixture, using a
  lawful permanent resident work-authorization profile with non-null
  `workAuthorization.uscisANumber`.
- `examples/eval/templates/work-authorization/` contains a narrow
  lawful-permanent-resident note template so scaffold can cover non-null
  USCIS/A-number facts without adding a broader archetype system.
- `samir-desai-i9-template-smoke` is runner-owned and carries a committed
  `filled-form` snapshot that exercises the same I-9 field map as Elena with
  different null and non-null work-authorization facts.

## Batch 0: Canonical Eval Tree Cleanup

Recommended plan folder:

```text
docs/plans/evaluation/user-generation-forms/eval-tree-cleanup/
```

Goal:

- Establish one canonical fixture home at `examples/eval/`.
- Remove the immediate confusion between `examples/form-fill-demo/`, `examples/memory-demo/`, and `examples/memory-demo-simple/`.

Work worth planning and executing together:

- Create `examples/eval/`.
- Move form-fill form fixtures and generated field manifests into `examples/eval/forms/`.
- Move `generate-field-manifests.mjs` into `examples/eval/scripts/`.
- Move the Elena corpus as the first realistic user/corpus example.
- Delete the old form-fill and memory demo trees.
- Update package scripts that reference old paths.

Non-goals:

- Do not build the new validator.
- Do not add the template renderer.
- Do not implement the eval runner.

Exit criteria:

- There is one obvious eval fixture home.
- Old memory demo directories are gone or explicitly marked as pending deletion.
- Package scripts do not point at removed paths.
- An `implementation-summary.md` documents exactly what moved, what was deleted, and what remains.

Status:

- Complete. See `eval-tree-cleanup/implementation-summary.md`.

## Batch 1: Schema And Fixture Contract

Recommended plan folder:

```text
docs/plans/evaluation/user-generation-forms/schema-contract/
```

Goal:

- Define the fixture contracts before automation depends on them.

Work worth planning and executing together:

- Add or document `profile.yaml`.
- Add or document `manifest.json`.
- Add or document `scenario.json`.
- Decide whether V1 uses `users/<userId>/realistic/` or `users/<userId>/corpora/<corpusId>/`.
- Define fact key conventions.
- Define where form-field-to-fact mappings live.
- Clarify `seed-preferences.generated.json` derivation from `profile.yaml`.
- Normalize the migrated Elena example enough to demonstrate the contracts.

Non-goals:

- Do not implement broad validation beyond lightweight schema checks needed for examples.
- Do not add corpus generation templates.

Exit criteria:

- Other engineers can review the data shape without reading future scripts.
- Elena has enough migrated shape to serve as the first validator target.
- The summary records any schema decisions and open questions.

Status:

- Complete. See `schema-contract/implementation-summary.md`.

## Batch 2: Validator

Recommended plan folder:

```text
docs/plans/evaluation/user-generation-forms/validator/
```

Goal:

- Build the highest-leverage reliability tool before generation automation.

Work worth planning and executing together:

- Implement `examples/eval/scripts/validate.mjs`.
- Validate profile, manifest, scenario, and field schema versions.
- Check referenced files exist.
- Check form coverage from `fields.generated.json` and form-field-to-fact mappings.
- Check every field-map, manifest, scenario, and intentionally-missing fact key
  resolves against `profile.yaml`, allowing null values.
- Check intentionally missing facts.
- Cross-check `intentionallyMissing[].forms` against top-level `manifest.forms[]`.
- Check corpus document inventory and coverage basics.
- Write `validation-report.json` for a single corpus when requested.

Design inputs to settle before or during this batch:

- Decide whether field maps are strictly form-scoped neutral maps or
  scenario-scoped maps. The current I-9 map keeps user-specific
  inapplicability in `profile.yaml` null facts, while Section 2 remains
  `out_of_scope` for the employee-memory scenario.
- Manifest document `factKeys` remain named `factKeys`, but are leaf-only
  profile fact references.
- `detailTier` is a pure richness scale; document category carries noise
  semantics.

Non-goals:

- Do not implement scaffold/render.
- Do not run end-to-end form-fill scenarios.

Exit criteria:

- `pnpm eval:validate --user elena-marquez --corpus realistic` or the chosen equivalent runs.
- Validator output gives actionable repair targets.
- Useful old `verify.mjs` behavior, if any, has been replaced or intentionally dropped.

Status:

- Complete. See `validator/implementation-summary.md`.

## Batch 3: Templates And Scaffold

Recommended plan folder:

```text
docs/plans/evaluation/user-generation-forms/templates-scaffold/
```

Goal:

- Make new corpora cheap, deterministic, and reviewable.

Work worth planning and executing together:

- Add a small template library for I-9/W-4-relevant document types.
- Implement deterministic seeded rendering, defaulting to `userId + corpusId`.
- Add `eval:scaffold` or the chosen equivalent.
- Have scaffold create or require `profile.yaml`.
- Select templates from form requirements and deterministic metadata.
- Render documents and `manifest.json`.
- Run validation after generation.

Non-goals:

- Do not add LLM polish.
- Do not add the scenario eval runner unless needed for a narrow smoke test.

Exit criteria:

- A new synthetic user/corpus can be created without asking an agent to write bulk documents.
- Re-running with the same seed produces the same output.
- Generated docs pass validation or produce clear failures.

Status:

- Complete. See `templates-scaffold/implementation-summary.md`.

## Batch 4: Eval Runner

Recommended plan folder:

```text
docs/plans/evaluation/user-generation-forms/eval-runner/
```

Goal:

- Close the loop from fixture corpus to form-fill quality.

Work worth planning and executing together:

- Define final scenario conventions.
- Implement `eval:run` or the chosen equivalent.
- Resolve user, corpus, and form references.
- Reset or seed memory.
- Hydrate deterministic active preferences from profile facts.
- Run the form-fill flow.
- Diff against conventional expected snapshots.
- Produce per-field classifications such as `correct`, `skipped-correctly`, `hallucinated`, and `missing`.
- Define fill-time rendering for array facts mapped to scalar PDF fields.

Non-goals:

- Do not add LLM polish.
- Do not add large archetype/factory systems.

Exit criteria:

- At least one scenario runs end to end for the canonical example user.
- Failures are explainable as snapshot diffs or field-level misses.
- The summary records how to run the scenario and how to interpret output.

Status:

- Complete. See `eval-runner/implementation-summary.md`.

## Batch 5: Polish And Playbook

Recommended plan folder:

```text
docs/plans/evaluation/user-generation-forms/polish-playbook/
```

Status:

- Complete. See `polish-playbook/implementation-summary.md`.

Goal:

- Improve realism and contributor ergonomics after the core fixture pipeline works.

Outcome:

- Added a repo playbook for contributor and agent workflows.
- Added local and CI non-DB verification coverage.
- Added small runner diagnostic hardening.
- Deferred optional LLM polish and archetypes/factories to future expansion
  work.
- Kept DB-backed eval runs manual/optional for this batch.

Non-goals:

- This batch should not become required for the core eval framework.

Exit criteria:

- The playbook improves workflow without becoming load-bearing.
- Existing deterministic fixtures are protected from drift by no-DB local and
  CI checks.

## Batch 6: Second I-9 User

Recommended plan folder:

```text
docs/plans/evaluation/user-generation-forms/second-i9-user/
```

Status:

- Complete. See `second-i9-user/implementation-summary.md`.

Goal:

- Add a second I-9 fixture user and runner-owned scenario before expanding to a
  new form.

Outcome:

- Added Samir Desai as a lawful permanent resident I-9 profile.
- Added one narrow work-authorization template for USCIS/A-number coverage.
- Generated Samir's `template-smoke` corpus, seed preferences, validation
  report, scenario, and filled-form snapshot through the existing workflow.
- Kept W-4, document-analysis ingestion, UI/browser automation, real LLM calls,
  and I-9 field-map changes out of scope.

Exit criteria:

- Samir's corpus and scenario validate.
- The runner snapshot shows the expected classification change from Elena:
  14 correct fields and 34 skipped-correctly fields.
- Existing no-DB eval gates remain green.

## Update Checklist

When a batch completes, update:

- The status table in this file.
- The "Current implemented state" section.
- The batch's own `implementation-summary.md`.
- Any follow-up batch notes that changed because of implementation discoveries.

If a later batch changes an earlier decision, update the relevant implementation summary or add a short note in this file pointing to the newer decision.

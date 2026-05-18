# User Generation Forms Orchestration Plan

- Status: orchestration
- Read when: coordinating implementation work for reusable synthetic users, document corpora, and form-fill evaluation
- Source of truth: `docs/plans/evaluation/user-generation-forms/brainstorm.md`
- Last reviewed: 2026-05-17

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
| 2. Validator | not-started | `validator/` | Build deterministic fixture validation against migrated Elena. |
| 3. Templates and scaffold | not-started | `templates-scaffold/` | Add deterministic templates and scaffold/render flow. |
| 4. Eval runner | not-started | `eval-runner/` | Run scenario fixtures and compare snapshots. |
| 5. Polish and playbook | deferred | `polish-playbook/` | Optional LLM polish and contributor/agent workflow guidance. |

Current implemented state:

- Brainstorming docs exist in this directory.
- Batch 0 is complete.
- `examples/eval/` is the canonical fixture home.
- Old `examples/form-fill-demo/`, `examples/memory-demo/`, and `examples/memory-demo-simple/` trees have been removed.
- Batch 1 is complete.
- `examples/eval/schemas/` defines V1 profile, corpus manifest, scenario, and field-map contracts.
- Elena Marquez has a canonical `profile.yaml`, generated seed preferences, a V1 realistic corpus manifest under `users/elena-marquez/corpora/realistic/`, and an I-9 Section 1 scenario fixture.
- The I-9 field map keeps user-specific inapplicability in profile null facts
  rather than encoding Elena-specific skip reasons in the form-scoped map.
- `pnpm eval:derive-seeds` derives committed seed preference JSON from profiles.
- Validation, templates, scaffold generation, and the eval runner are still future batches.

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
- Check corpus distribution basics.
- Warn on thin or repetitive docs using configurable or tier-aware thresholds.
- Write `validation-report.json`.

Design inputs to settle before or during this batch:

- Decide whether field maps are strictly form-scoped neutral maps or
  scenario-scoped maps. The current I-9 map keeps user-specific
  inapplicability in `profile.yaml` null facts, while Section 2 remains
  `out_of_scope` for the employee-memory scenario.
- Decide whether manifest document `factKeys` should remain a mixed leaf/area
  content marker or be renamed to `mentionedFacts` or `factAreas`.
- Decide whether `detailTier` should be a pure richness scale, with document
  category carrying noise semantics.

Non-goals:

- Do not implement scaffold/render.
- Do not run end-to-end form-fill scenarios.

Exit criteria:

- `pnpm eval:validate --user elena-marquez --corpus realistic` or the chosen equivalent runs.
- Validator output gives actionable repair targets.
- Useful old `verify.mjs` behavior, if any, has been replaced or intentionally dropped.

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
- Select templates from form requirements and distribution policy.
- Render documents and `manifest.json`.
- Run validation after generation.

Non-goals:

- Do not add LLM polish.
- Do not add the scenario eval runner unless needed for a narrow smoke test.

Exit criteria:

- A new synthetic user/corpus can be created without asking an agent to write bulk documents.
- Re-running with the same seed produces the same output.
- Generated docs pass validation or produce clear failures.

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
- Import or analyze corpus documents.
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

## Batch 5: Polish And Playbook

Recommended plan folder:

```text
docs/plans/evaluation/user-generation-forms/polish-playbook/
```

Status:

- Deferred until the deterministic path is useful.

Goal:

- Improve realism and contributor ergonomics after the core fixture pipeline works.

Possible work:

- Add optional LLM polish gated by validation.
- Add an Agent Skill or repo playbook.
- Add archetypes or factories for more users.
- Add snapshot update workflow.

Non-goals:

- This batch should not become required for the core eval framework.

Exit criteria:

- Optional polish or playbook improves workflow without becoming load-bearing.

## Update Checklist

When a batch completes, update:

- The status table in this file.
- The "Current implemented state" section.
- The batch's own `implementation-summary.md`.
- Any follow-up batch notes that changed because of implementation discoveries.

If a later batch changes an earlier decision, update the relevant implementation summary or add a short note in this file pointing to the newer decision.

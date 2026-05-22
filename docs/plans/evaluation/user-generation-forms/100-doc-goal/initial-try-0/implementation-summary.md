# Initial Try 0 Implementation Summary

- Status: implemented as a first working baseline
- Date: 2026-05-22
- Read when: reviewing the first 100-document generation implementation and deciding what to clean up next

## Folder Cleanup Context

The `100-doc-goal/` folder has been reorganized around implementation attempts:

- `initial-try-0/` contains the original implementation plan and this summary.
- `initial-clean-up-1/` is reserved for the next cleanup pass.
- Top-level `TODO.md` and `COMMANDS.MD` now track active follow-up work and command snippets.

The old top-level plan and review files were removed or moved out of the top level. The useful state now is: first attempt summary in `initial-try-0/`, next implementation plan in `initial-clean-up-1/`, and operational notes at the top of `100-doc-goal/`.

## What Was Implemented

The first implementation created the rails needed for mass document fixture generation:

- Added `examples/eval/schemas/corpus-plan.schema.json`.
- Added `examples/eval/scripts/generate.mjs`.
- Added root script `pnpm eval:generate`.
- Added generator tests in `examples/eval/scripts/generate.test.mjs`.
- Extended `examples/eval/scripts/validate.mjs` to understand `corpus-plan.json`.
- Added `--plan-only` validation support.
- Added plan/manifest drift detection with `MANIFEST_PLAN_MISMATCH`.
- Added conservative document prose checks for high-confidence values.
- Added shared fact-value matching helpers in `examples/eval/scripts/shared.mjs`.
- Updated eval docs and TODO material for the generation workflow.

The generation command calls Vertex directly. It does not call the backend app.

## New Test User And Corpus

The first working 100-document fixture user is:

```text
examples/eval/users/nina-meera-patel/
```

This user was chosen after the first attempt because `nina-patel` is already used by scaffold tests as an init-user example. The human persona is still Nina Patel, but the fixture id is `nina-meera-patel`.

The committed corpus is:

```text
examples/eval/users/nina-meera-patel/corpora/realistic/
```

It contains:

- `profile.yaml`
- `seed-preferences.generated.json`
- `corpus-plan.json`
- `manifest.json`
- `validation-report.json`
- 100 document body files under `documents/`

There is also a lightweight scenario hook:

```text
examples/eval/scenarios/nina-meera-patel-i9-realistic/
```

That scenario has no expected filled-form snapshot yet. It proves scenario wiring and validation scope, not extraction quality.

## Document Distribution

The Nina realistic corpus has exactly 100 documents:

| Category | Count |
| --- | ---: |
| `identity` | 15 |
| `address-contact` | 15 |
| `work-authorization` | 12 |
| `hr-onboarding` | 12 |
| `employer-context` | 8 |
| `partial-conflicting` | 18 |
| `noise` | 20 |

The intentionally missing facts are:

- `contact.phone`
- `workAuthorization.uscisANumber`
- `workAuthorization.i94AdmissionNumber`
- `workAuthorization.foreignPassportNumber`

These are expected to stay blank for this U.S. citizen I-9 fixture.

## What Validation Proves

The current validator proves:

- profile schema validity
- seed preference determinism
- corpus plan schema validity
- manifest schema validity
- document inventory completeness
- plan and manifest agreement
- category count agreement
- path safety and uniqueness
- form reference validity
- fact keys resolve to profile leaves
- noise docs have empty `factKeys[]`
- ignored docs have low/no authority
- high-confidence declared values appear in document bodies for selected fact types
- intentionally missing facts are declared and not claimed as current supported facts

High-confidence prose checks currently focus on values such as:

- personal email
- work email
- SSN
- USCIS/A-number when applicable

## What Validation Does Not Prove Yet

This is a validated corpus fixture, not a full extraction benchmark.

It does not yet prove:

- the backend can ingest these 100 documents and extract the right facts
- an AI document-analysis flow can choose current facts over stale/conflicting facts
- the final I-9 filled-form output is correct when driven only by document contents
- all non-identifier facts are semantically extractable from prose

The eval runner still hydrates known memory from profile facts. A later extraction runner is needed before this becomes a true ingestion benchmark.

## Vertex Preview

A Vertex preview was run manually with:

```bash
pnpm eval:generate --user nina-meera-patel --corpus realistic --limit 5 --out /private/tmp/nina-preview
```

That generated the first five planned identity documents with `gemini-2.5-pro`.

The preview looked correct fact-wise:

- the planned files were created
- supported values appeared in the bodies
- phone stayed blank in the passport draft
- SSN did not appear in the first five docs because those docs do not declare `identity.ssn`

The preview also exposed the main cleanup issue: the plan currently says all 100 docs are `md`, so Vertex produces clean Markdown-like documents. That is plausible, but not realistic enough for the next iteration.

## Verification Run

The final verification command passed:

```bash
pnpm eval:verify
```

Result:

- 63 eval script tests passed
- full `pnpm eval:validate` passed
- validation covered 3 profiles, 4 corpora, 4 scenarios, 7 templates
- 0 errors
- 0 warnings

## Main Known Problems

The first implementation was useful, but it is not the final realism target.

Known problems:

- all 100 document files are currently planned as `.md`
- per-document briefs are too generic
- the first preview only covers the first five identity docs
- there is no easy `--sample` or `--ids` preview command for cross-category previews
- `--regenerate` usage text suggests short ids, but the implementation expects full document ids
- generated documents are still structured and clean rather than messy real-world exports
- no expected filled-form snapshot exists for the new 100-doc scenario
- no extraction benchmark exists yet

The next cleanup pass should update mixed file types and strengthen per-document briefs before full Vertex regeneration.

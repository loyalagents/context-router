# Open-Schema Direct Vertex Baseline Implementation Summary

- Status: implemented
- Last updated: 2026-06-17

## Summary

Added `pnpm eval:direct-open-schema`, a no-storage direct Vertex baseline that
extracts form-relevant facts from all declared source documents, then fills the
target PDF from those extracted facts only.

The baseline does not call backend memory, MCP tools, GraphQL export APIs, or
the database. Final form correctness from `form-score-report.json` is the
headline metric. PR2 open-schema value-recovery reports are emitted as
diagnostics.

## Implemented Behavior

- Added `examples/eval/scripts/direct-open-schema.mjs`.
- Added package script `eval:direct-open-schema`.
- Added `examples/eval/schemas/open-schema-extraction.schema.json`.
- Added focused direct baseline tests in
  `examples/eval/scripts/direct-open-schema.test.mjs`.
- Reused existing direct-document PDF field loading and PDF fill helpers.
- Reused the existing form scorer for `form-score-report.json`.
- Reused PR2 open-schema database and combined scorers for diagnostic reports.
- Kept `pnpm eval:fill-form-from-docs` stable.

## Artifact Behavior

The command always writes `open-schema-extraction-response.json` after a Stage 1
model response, including malformed JSON cases.

When extraction parses and validates, the command writes
`open-schema-extraction.json` with evaluator-owned `factId` values such as
`fact-0001`. Model-authored slugs, labels, values, evidence document IDs, and
quotes are preserved exactly for accepted rows. Invalid fact rows are dropped
with diagnostics instead of aborting the whole run, so usable facts can still
produce the headline form score.

The form-fill stage writes:

- `direct-open-schema-fill-response.json`;
- `filled-form.json`;
- `filled-form.pdf`;
- `form-score-report.json`.

Unless `--skip-extraction-scoring` is passed, the command also writes:

- `synthetic-memory-snapshot.json`;
- `open-schema-database-score-report.json`;
- `open-schema-combined-score-report.json`.

## Prompt Boundaries

Stage 1 sees general open-schema extraction instructions and declared corpus
documents. It does not see the scenario prompt, target form context, field
names, field types, inferred labels, field policies, fixture truth, profile
facts, field-map fact keys, field-map notes, generated data-key hints, accepted
slug maps, validation reports, DB exports, score artifacts, or previous
baseline outputs. The prompt asks for a compact bounded extraction with short
JSON-safe evidence snippets, not an exhaustive corpus dump.

Stage 2 sees extracted facts and the same safe PDF field metadata projection.
It does not see raw source documents. Non-`SKIP` actions must cite
`sourceFactIds`; the evaluator derives diagnostic source slugs from those IDs.

## Synthetic Snapshot Behavior

`synthetic-memory-snapshot.json` is generated deterministically from
`open-schema-extraction.json`. It preserves extraction mistakes and duplicate
model slugs by creating separate synthetic definitions and active preferences
for each extracted fact.

The `memory-snapshot.schema.json` changes are scoped to represent synthetic
no-backend snapshots truthfully without weakening real backend export
validation:

- `definitionBaseline.strategy: "synthetic-no-backend"`;
- `diagnostics.schemaResetMode: "synthetic-no-backend"`;
- `diagnostics.queryName: "SyntheticDirectOpenSchemaSnapshot"`;
- nullable `diagnostics.backendUserId` only for synthetic snapshots.

## Checkpoint Status

- Checkpoint 1, form-only baseline: implemented.
- Checkpoint 2, synthetic extraction scoring: implemented.
- Checkpoint 3, `evaluation-run.json` polish: intentionally deferred.

## Verification

Commands run:

```bash
node --test examples/eval/scripts/direct-open-schema.test.mjs
node --test examples/eval/scripts/direct-open-schema.test.mjs examples/eval/scripts/scoring/open-schema-database.test.mjs examples/eval/scripts/scoring/open-schema-combined.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Results:

- Direct baseline tests passed: 8 tests.
- Direct plus PR2 scorer regression tests passed: 21 tests.
- Full eval script suite passed: 293 tests.
- Eval validation passed with the existing 11 Alex realistic warnings and no
  errors.
- `pnpm eval:verify` passed.

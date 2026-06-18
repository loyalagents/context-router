# Open-Schema Direct Vertex Baseline Implementation Plan

- Status: implemented in this branch
- Last updated: 2026-06-17

## Goal

Add a no-storage baseline that answers:

Given all declared source documents at once, can Vertex extract the needed
information and use it to fill the form without persistent memory, schema,
database, backend, or MCP tooling?

The headline metric is final form correctness from the existing form scorer.
Open-schema value-recovery scoring is diagnostic support, not the headline.

## Non-Goals

- Do not route through backend memory, GraphQL exports, MCP tools, preference
  definitions, or database writes.
- Do not change known-schema artifacts or scorers.
- Do not make slug correctness the headline metric.
- Do not repair model mistakes before scoring.
- Do not expose profile truth, accepted slug maps, validation reports, previous
  baseline outputs, or score artifacts to Vertex prompts.

## Command

```bash
pnpm eval:direct-open-schema \
  --scenario <scenarioId> \
  --artifacts-root <dir> \
  [--documents-root <dir>] \
  [--provider vertex] \
  [--model <model>] \
  [--temperature <number>] \
  [--run-id <id>] \
  [--skip-extraction-scoring]
```

`--provider` is intentionally named as a model provider, not a backend. Vertex
is the only supported provider in v1.

## Architecture

### Stage 1: Form-Agnostic Open-Schema Extraction

Vertex sees:

- general instructions to extract durable user facts/preferences;
- all declared corpus documents from the scenario manifest.

Vertex does not see the scenario prompt, target form context, PDF field names,
fixture truth, profile facts, field-map fact keys, field-map notes, accepted
slug maps, validation reports, database exports, score reports, or previous
baseline outputs.

The output is deliberately small and model-owned:

```json
{
  "facts": [
    {
      "slug": "category.fact_name",
      "label": "Human readable fact label",
      "valueType": "STRING",
      "value": "document-supported value",
      "confidence": 0.9,
      "evidence": [
        {
          "documentId": "document-id-from-list",
          "quote": "short exact supporting substring"
        }
      ]
    }
  ],
  "unresolved": [
    {
      "label": "Human readable missing or ambiguous fact",
      "reason": "Why the documents do not establish it."
    }
  ]
}
```

The evaluator assigns deterministic `factId` values after parsing. The model
authored `slug` is preserved exactly as behavior to score diagnostically.
Malformed envelopes fail. Invalid individual fact rows are dropped with
diagnostics so one bad row does not prevent final form scoring from the usable
facts.

The prompt bounds extraction to a compact general-purpose fact set and asks for
short JSON-safe evidence snippets. That keeps the stricter form-agnostic
baseline from turning into an exhaustive corpus dump while still letting Vertex
decide which facts/preferences are generally useful.

### Stage 2: Fact-Only Form Fill

Vertex sees:

- `open-schema-extraction.json` accepted facts with evaluator `factId` values
  and model slugs;
- safe PDF field metadata and safe field policies.

Vertex does not see the raw documents again or the Stage 1 `unresolved[]`
diagnostics. Every non-`SKIP` action must cite `sourceFactIds`. The evaluator
derives diagnostic source slugs from those fact IDs for existing form artifacts.
The fill prompt treats generated `inferredLabel` values as weak hints and asks
Vertex not to skip compound/noisy text fields solely because one related concept
is missing when an extracted fact clearly matches another part of the field
name.

## Artifacts

Always written after the Stage 1 model call:

- `open-schema-extraction-response.json`

Written only when Stage 1 parses and validates:

- `open-schema-extraction.json`

Required v1 outputs:

- `direct-open-schema-fill-response.json`
- `filled-form.json`
- `filled-form.pdf`
- `form-score-report.json`

Diagnostic outputs unless `--skip-extraction-scoring` is passed:

- `synthetic-memory-snapshot.json`
- `open-schema-database-score-report.json`
- `open-schema-combined-score-report.json`

`evaluation-run.json` remains out of v1 scope unless comparison tooling starts
depending on it.

## Checkpoints

### Checkpoint 1: Form-Only Baseline

- Add the CLI and package script.
- Add Stage 1 prompt, parser, diagnostics, and
  `open-schema-extraction.schema.json`.
- Add Stage 2 fact-only prompt and action validation.
- Write `filled-form.json`, `filled-form.pdf`, and `form-score-report.json`.
- Keep `eval:fill-form-from-docs` unchanged.

Stop point:

- The command can fill a form from extracted facts and score final form
  correctness without emitting synthetic memory artifacts.

### Checkpoint 2: Synthetic Extraction Scoring

- Convert `open-schema-extraction.json` to `synthetic-memory-snapshot.json`
  deterministically.
- Preserve mistakes: no slug cleanup, duplicate merging, value repair,
  missing-fact inference, evidence repair, or semantic normalization. Invalid
  rows may be dropped with diagnostics, but accepted rows preserve model
  authored strings exactly.
- Reuse PR2 open-schema database and combined scorers directly.
- Extend `memory-snapshot.schema.json` only as needed for truthful synthetic
  no-backend snapshots.

Stop point:

- The command emits PR2-compatible diagnostic open-schema reports.

### Checkpoint 3: Run Metadata Polish

- Add `evaluation-run.json` only if comparison tooling needs it.
- Use `evaluationMode: "direct-vertex-open-schema"`.
- Keep this as closeout polish, not a v1 blocker.

## Verification Plan

Checkpoint 1:

- CLI/default parsing.
- Prompt exclusions and Stage 1 form context.
- Stage 1 parser and extraction diagnostics.
- Extraction schema validation.
- Stage 2 fact-only prompt.
- `sourceFactIds` validation and source-slug derivation.
- PDF fill, filled-form snapshot, and form score.

Checkpoint 2:

- Synthetic snapshot deterministic IDs.
- Duplicate slug preservation.
- Scorer compatibility.
- No hidden repair of model mistakes.

Regression:

```bash
node --test examples/eval/scripts/direct-open-schema.test.mjs examples/eval/scripts/scoring/open-schema-database.test.mjs examples/eval/scripts/scoring/open-schema-combined.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

## Design Notes

- Stage 1 is intentionally form-agnostic because this baseline measures whether
  Vertex can extract useful open-schema user facts from source docs before it
  sees a target form.
- The form response shape is not considered over-engineered for the benchmark:
  it is the minimum structured interface needed to fill the actual PDF and run
  deterministic form scoring.
- The extraction artifact stays simpler than backend memory artifacts so model
  performance is not dominated by backend ceremony.
- Synthetic memory exists only to reuse PR2 diagnostic scorers; it is generated
  by eval code, not authored by Vertex.

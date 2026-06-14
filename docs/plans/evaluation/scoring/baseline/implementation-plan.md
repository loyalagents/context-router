# Direct-Document Form Fill Baseline Implementation Plan

## Summary

Implement an eval-only direct-document form-fill baseline. The runner reads a
scenario, the scenario's corpus documents, and PDF field metadata, sends all
evidence document text to Vertex in one structured prompt, fills the PDF locally
from returned fill actions, writes `filled-form.json`, and optionally writes a
filled PDF, response/debug artifact, and form score report.

This does not call the backend, mutate memory, read from the DB, or add product
API endpoints.

## Key Changes

- Add `pnpm eval:fill-form-from-docs`.
- Use local corpus files as evidence and label every document with `doc:<id>`.
- Build prompts from PDF field metadata and evidence text only.
- Exclude profile truth, expected field-map values, fact contracts, seed
  preferences, validation reports, and DB preferences from prompts.
- Parse Vertex JSON output into existing-style fill actions.
- Validate actions against field names, field options, confidence, and source
  document refs.
- Fill PDF locally using backend `pdf-lib` behavior mirrored in eval helpers.
- Reuse existing `filled-form.json` snapshot schema and form scorer.

## Interface

```bash
pnpm eval:fill-form-from-docs \
  --scenario <scenarioId> \
  --out <filled-form.json> \
  [--documents-root <dir>] \
  [--backend vertex] \
  [--model <model>] \
  [--temperature <number>] \
  [--filled-pdf-out <file>] \
  [--response-out <file>] \
  [--form-score-report <file>]
```

Defaults:

- `--documents-root`: `examples/eval/users/<scenario.userId>/corpora/<scenario.corpusId>`
- `--backend`: `vertex`
- `--model`: `EVAL_DIRECT_FORM_FILL_MODEL`
- `--temperature`: `0.2`

## Test Plan

- Add `examples/eval/scripts/fill-form-from-docs.test.mjs`.
- Cover CLI help, required args, env fallback, CLI override, invalid ids, and
  default document root.
- Cover prompt construction and ensure excluded truth inputs are absent.
- Cover JSON/fenced JSON parsing.
- Cover action validation: unknown fields, duplicates, invalid options, missing
  source refs, low confidence, and unknown source refs.
- Cover local PDF fill and filled-form snapshot/schema output.
- Cover optional form score report.

Run:

```bash
node --test examples/eval/scripts/fill-form-from-docs.test.mjs examples/eval/scripts/scoring/form.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

## Assumptions

- Evidence documents are text inputs in one Vertex prompt, not binary file
  attachments.
- The form PDF binary is not sent to Vertex; only field metadata is sent.
- Current corpora should fit in one prompt. The runner fails clearly if an
  evidence packet exceeds configured limits instead of silently truncating.
- `sourceSlugAgreementRate` in the existing form score is not meaningful for
  this baseline because source refs are document refs, not DB slugs.

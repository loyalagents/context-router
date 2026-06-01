# Scorer Implementation Plan

- Status: implementation plan
- Last updated: 2026-06-01

## Summary

Implement the first-pass scoring layer only. The scorer reads exported artifacts
plus fixture truth and writes deterministic database, form-fill, and combined
score reports. It does not call the backend, upload documents, mutate
preferences, run ingestion, or invoke models.

## Key Changes

- Add `pnpm eval:score` with three modes:
  - `database`
  - `form`
  - `combined`
- Add schemas for:
  - stored preferences input artifact
  - database score report
  - form-fill score report
  - combined score report
- Add a global fact storage map under `examples/eval/scoring/`.
- Add scoring modules under `examples/eval/scripts/scoring/`.

## Scoring Behavior

- Database scoring:
  - scores only active preference rows
  - requires the exported artifact to declare `statusesScored: ["ACTIVE"]`
  - derives canonical slugs from seed preferences or `eval.*` fact slugs
  - merges accepted aliases from the storage map
  - scores known-present facts from corpus truth and non-null profile values
  - keeps conflict rows separate from clean correctness
  - scores intentionally missing facts from manifest/profile missingness, not
    per-document `forbid`
  - reports unscored extra preferences without penalty
- Form scoring:
  - aggregates existing `filled-form.json` classifications
  - validates snapshot `scenarioId`, `userId`, `corpusId`, and `formId`
  - separates should-fill, abstention-test, structural-skip, and unsupported
    fields
  - reports source-slug agreement as a diagnostic
- Combined scoring:
  - joins database and form reports by `factKey`
  - emits closed stage-attribution buckets for cross-stage diagnosis

## Verification

Run:

```bash
node --test examples/eval/scripts/scoring/*.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

## Out Of Scope

- Stored-preferences exporter
- Document ingestor
- Codex/Claude MCP agent runner
- Derivation rules
- Smart-search scoring
- LLM-judged value equality
- Broad extra-slug categorization

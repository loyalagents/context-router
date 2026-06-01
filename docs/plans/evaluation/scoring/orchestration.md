# Evaluation Scoring Orchestration

- Status: active plan
- Last updated: 2026-06-01

## High-Level Flow

The evaluation stack is split into three implementation phases with a stable
artifact boundary between each phase.

```text
ingestor or manual/MCP run
  -> backend state
  -> exporter writes stored-preferences.json
  -> scorer writes database/form/combined score reports
```

## Phase Checklist

- [x] Brainstorm scoring, exporter, and ingestor boundaries.
- [x] Implement scorer.
- [ ] Implement stored-preferences exporter.
- [ ] Implement document ingestor with auto-apply into active memory.
- [ ] Add Codex/Claude MCP agent runners.

## Phase 1: Scorer

Pure deterministic scripts that read artifacts and fixture truth:

- `stored-preferences.json`
- `filled-form.json`
- profile, manifest, validation report, field map, accepted slug map

Outputs:

- `database-score-report.json`
- `form-fill-score-report.json`
- `combined-score-report.json`

The scorer does not call the backend, upload documents, run models, or mutate
state.

Implemented in this phase:

- `pnpm eval:score`
- stored-preferences and score-report schemas
- accepted slug map
- database, form-fill, and combined scoring modules
- targeted scorer tests and CLI tests

## Phase 2: Exporter

Snapshot backend memory into `stored-preferences.json`.

This lets the same scorer evaluate:

- automated document ingestion
- manual UI uploads
- Codex/Claude MCP runs
- deterministic test hydration

## Phase 3: Ingestor

Upload generated corpus documents through the product ingestion path, collect
diagnostics, auto-apply extracted suggestions into active preferences, then call
or hand off to the exporter.

This phase is intentionally separate from scoring so that scoring remains stable
while ingestion paths evolve.

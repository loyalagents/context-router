# Evaluation Scoring Orchestration

- Status: active plan
- Last updated: 2026-06-08

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
- [x] Implement stored-preferences exporter.
- [x] Brainstorm known-schema vs open-schema ingestion.
- [x] Implement known-schema document ingestor with auto-apply into active
  memory.
- [ ] Design open-schema ingestion with definition/slug creation.
- [ ] Decide ordering for MCP/Codex/Claude runner and upload-level schema
  discovery.

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
- active-only storage input validation and strict score-report contracts
- targeted scorer tests and CLI tests

## Phase 2: Exporter

Snapshot backend memory into `stored-preferences.json`.

This lets the same scorer evaluate:

- automated document ingestion
- manual UI uploads
- Codex/Claude MCP runs
- deterministic test hydration

Implemented in this phase:

- `pnpm eval:export-stored-preferences`
- existing GraphQL API export path with explicit local/hosted URL selection
- frontend debug-token manual workflow via `EVAL_AUTH_TOKEN`
- active-only scored rows with optional suggested-row diagnostics
- GraphQL query contract tests against `apps/backend/src/schema.gql`
- stored-preferences schema validation before writing artifacts

## Phase 3: Known-Schema Ingestor

Upload generated corpus documents through the current product ingestion path,
collect diagnostics, auto-apply extracted suggestions into active preferences,
then optionally call the exporter and database scorer.

This phase is intentionally separate from scoring so that scoring remains stable
while ingestion paths evolve.

This benchmark assumes useful preference definitions already exist. It measures
whether document upload can extract values into an available schema; it does not
measure slug discovery.

Implemented in this phase:

- `pnpm eval:ingest-documents`
- optional current-user memory reset
- optional explicit seed preference setup
- optional canonical eval definition setup without writing values
- manifest-driven document uploads from `--documents-root`
- auto-apply of only the current upload response's `suggestions[]`
- strict rejection of pagination-looking upload responses
- optional `stored-preferences.json` export
- optional database scoring
- `ingestion-run.json` schema and tests
- eval fixture user and authenticated backend user recorded separately

## Phase 4: Open-Schema Ingestion

Open-schema ingestion starts without pre-created eval-specific definitions. The
system or agent must choose or create useful definitions/slugs and store values.

We likely want both open-schema surfaces because they test different systems:

- MCP/Codex/Claude agent runner: tests agent-driven schema discovery and memory
  writes through tools.
- Upload-level schema discovery: tests product document analysis discovering or
  proposing definitions itself.

The order is not decided. Current document upload is known-schema only: it shows
the model existing valid slugs and filters unknown slugs instead of creating new
definitions.

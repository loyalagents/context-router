# Evaluation Scoring Orchestration

- Status: active plan
- Last updated: 2026-06-16

## High-Level Flow

The evaluation stack is split into three implementation phases with a stable
artifact boundary between each phase.

```text
ingestor or manual/MCP run
  -> backend state
  -> exporter writes stored-preferences.json
  -> database scorer writes database-score-report.json
  -> form runner writes filled-form.json
  -> form scorer writes form-fill-score-report.json
  -> combined scorer writes combined-score-report.json
```

## Phase Checklist

- [x] Brainstorm scoring, exporter, and ingestor boundaries.
- [x] Implement scorer.
- [x] Implement stored-preferences exporter.
- [x] Brainstorm known-schema vs open-schema ingestion.
- [x] Implement known-schema document ingestor with auto-apply into active
  memory.
- [x] Implement backend-memory form-fill runner.
- [x] Implement known-schema single-call wrapper over the existing stage
  commands.
- [x] Decide ordering for MCP/Codex/Claude runner and upload-level schema
  discovery: build MCP known-schema first, then MCP open-schema, then
  upload-level open-schema discovery.
- [x] Implement MCP known-schema agent runner.
- [ ] Run live MCP known-schema Claude smoke.
- [ ] Add open-schema memory snapshot/scoring and MCP open-schema mode.

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

## Phase 4: Form Fill From Backend Memory

Fill a form from the authenticated backend user's current active preferences and
write the existing `filled-form.json` artifact for form scoring.

This phase is separate from the deterministic `eval:run` test harness:

- `eval:run` resets a test DB, hydrates fixture truth, and mocks form-fill model
  output for deterministic snapshot tests.
- `eval:fill-form` calls the live `/api/form-fill/pdf` product endpoint against
  already-prepared backend memory.

Implemented in this phase:

- `pnpm eval:fill-form`
- optional filled-PDF and redacted response side artifacts
- optional form score report convenience output
- shared eval PDF field reader using the backend `pdf-lib` dependency
- Alex realistic live form-fill scenario without a committed golden snapshot

## Phase 5: Known-Schema Single-Call Wrapper

Run the existing known-schema chain with one command while preserving every
intermediate artifact:

```text
eval:e2e-known-schema
  -> validation-report.json
  -> ingestion-run.json
  -> stored-preferences.json
  -> database-score-report.json
  -> filled-form.json / filled-form.pdf / form-fill-response.json
  -> form-score-report.json
  -> combined-score-report.json
  -> evaluation-run.json
```

Implemented in this phase:

- `pnpm eval:e2e-known-schema`
- schema-validated `evaluation-run.json`
- partial run report writing on stage failure
- skipped-stage accounting after failures
- explicit `--validation-report` support for database scoring

## Phase 6: MCP Known-Schema Agent Runner

Run a local agent CLI against the configured MCP server and compare its memory
writes with the existing backend/form scorers.

```text
validate documents
  -> shared reset/known-schema definition setup
  -> Claude agent reads staged local corpus and writes memory through MCP
  -> export stored-preferences.json
  -> score database
  -> fill form from backend memory
  -> score form
  -> score combined
```

Implemented in this phase:

- `pnpm eval:e2e-mcp-agent`
- known-schema setup helper reuse without document upload
- Claude live adapter and explicit opt-in command test adapter
- hidden-truth-safe prompt template plus staged agent workspace containing only
  declared documents; this is not an OS-level filesystem sandbox
- sanitized agent environment, explicit Claude MCP config, and Claude
  headless/cloud model-provider auth env passthrough
- `mcp-agent-run.json`, redacted transcript, rendered prompt, and
  `evaluation-run.json` artifacts
- reuse of stored-preferences export, database scoring, backend form fill, form
  scoring, and combined scoring

Live smoke is still a manual follow-up because it requires a running backend,
`EVAL_AUTH_TOKEN`, Claude auth, and a Claude MCP config containing the local MCP
server. Live scores remain smoke-only until the runner can verify that the MCP
session and `EVAL_AUTH_TOKEN` resolve to the same backend user.

Design doc:

- `docs/plans/evaluation/scoring/MCP-scoring/brainstorm.md`

## Phase 7: Open-Schema Ingestion

Open-schema ingestion starts without pre-created eval-specific definitions. The
system or agent must choose or create useful definitions/slugs and store values.

Planned order:

1. MCP open-schema runner: tests agent-driven schema discovery and memory
   writes through existing MCP tools.
2. Upload-level schema discovery: tests product document analysis discovering
   or proposing definitions itself.

Open-schema scoring should use an enriched `memory-snapshot.json` with
`preferences[]` and `definitions[]`, headline form correctness, and treat novel
schema quality as diagnostic at first.

Current document upload is known-schema only: it shows the model existing valid
slugs and filters unknown slugs instead of creating new definitions.

Design doc:

- `docs/plans/evaluation/scoring/open-schema/brainstorm.md`

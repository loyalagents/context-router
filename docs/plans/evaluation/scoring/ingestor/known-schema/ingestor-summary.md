# Known-Schema Ingestor Implementation Summary

- Status: implemented
- Last updated: 2026-06-08

## Summary

Implemented `pnpm eval:ingest-documents` for the known-schema document
ingestion benchmark. The command uploads generated corpus documents through
existing backend APIs, optionally resets memory, optionally creates missing
target preference definitions, auto-applies only suggestions returned by each
upload response, and can chain into the existing exporter and database scorer.

This remains intentionally known-schema only. It does not test open-schema slug
discovery, upload-level proposed definitions, or MCP/Codex/Claude agent behavior.

## Changed Files

- Added `examples/eval/scripts/ingest-documents.mjs`.
- Added ingestor helper modules under `examples/eval/scripts/ingestor/`.
- Added `examples/eval/schemas/ingestion-run.schema.json`.
- Added `examples/eval/scripts/ingest-documents.test.mjs`.
- Added `eval:ingest-documents` to `package.json`.
- Added partial-run handling for soft document failures and separate analyzed /
  apply-failure summary counters.
- Added hard guards for partial apply success, malformed suggestion objects even
  in `--no-auto-apply` mode, and stale existing definition `valueType`
  mismatches.
- Updated exporter identity handling so `stored-preferences.userId` remains the
  eval fixture user while backend rows are validated against `me.userId`.
- Updated exporter tests for eval-user/backend-user separation.
- Added this implementation summary and updated scoring orchestration/TODO docs.

## Behavior

The ingestor flow is:

```text
load fixture
  -> call me
  -> optionally reset memory
  -> optionally ensure target definitions exist
  -> optionally seed explicit starting preferences
  -> upload manifest documents from --documents-root
  -> optionally auto-apply upload-response suggestions only
  -> optionally export stored-preferences.json
  -> optionally run database scoring
  -> write ingestion-run.json
```

The run artifact records eval fixture identity and authenticated backend identity
separately, records upload/analyze/apply counts, and never writes the auth token.

Definition setup creates missing canonical target definitions only, including
intentionally missing abstention targets. It creates slugs, not values. Created
definitions are user-owned by the authenticated backend user; the `GLOBAL` scope
marks how the definition is used, not shared catalog ownership. Seed values are
written only when `--seed-preferences` is explicitly provided.

Existing target definitions are checked for `valueType` compatibility before any
new definitions are created. A stale incompatible definition fails setup because
it can make the known-schema benchmark measure old schema state instead of
document extraction.

`MEMORY_ONLY` reset clears stored values but leaves user-owned definitions in
place, so repeated known-schema runs should skip previously created definitions.

Upload responses must include a complete `suggestions[]` array. Pagination-like
response shapes fail clearly until the upload contract explicitly supports them.
Suggestion objects are validated even when `--no-auto-apply` is used, because
that mode still records upload diagnostics.

Backend-reported `parse_error` / `ai_error` and upload HTTP failures are soft
per-document failures. The ingestor continues through later documents, runs any
requested export/scoring steps, writes a partial run artifact, and exits nonzero
at the end. Contract-shape failures, apply mutation failures, and partial apply
success still abort before export/scoring.

The summary distinguishes `uploadedCount`, `analyzedCount`,
`failedDocumentCount`, `appliedSuggestionCount`, and `applyFailureCount`.
`analyzedCount` means documents with an analysis record, including backend
`parse_error` / `ai_error` records.

When a partial ingestion run writes a chained database score report, interpret
that score together with `ingestion-run.status`; it is useful diagnostics for
the partial backend state, not a clean-run benchmark result.

Suggestion confidence values are recorded as returned by the backend, even when
they fall outside the usual `[0, 1]` band, so unusual confidences do not suppress
the entire run artifact.

## Verification

Passed:

```bash
node --test examples/eval/scripts/ingest-documents.test.mjs examples/eval/scripts/export-stored-preferences.test.mjs
node --test examples/eval/scripts/scoring/*.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

`pnpm eval:validate` still reports the known Alex realism warnings, but no hard
validation errors.

## Follow-Ups

- Run a live local backend smoke using generated Alex documents, then save a
  representative `ingestion-run.json`, exported preferences, and score report
  outside the repo or as curated examples if useful.
- Implement the MCP known-schema agent runner first, then use that runner shape
  for MCP open-schema evaluation before designing upload-level schema
  discovery.
- Add source-fact ownership and richer missing-value fixtures if source-only
  extras become a recurring scoring ambiguity.

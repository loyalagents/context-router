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
separately, records upload/apply counts, and never writes the auth token.

Definition setup creates missing canonical target definitions only, including
intentionally missing abstention targets. It creates slugs, not values. Created
definitions are user-owned by the authenticated backend user; the `GLOBAL` scope
marks how the definition is used, not shared catalog ownership. Seed values are
written only when `--seed-preferences` is explicitly provided.

`MEMORY_ONLY` reset clears stored values but leaves user-owned definitions in
place, so repeated known-schema runs should skip previously created definitions.

Upload responses must include a complete `suggestions[]` array. Pagination-like
response shapes fail clearly until the upload contract explicitly supports them.

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
- Design open-schema ingestion where the system or agent must create useful
  definitions/slugs instead of relying on pre-created target definitions.
- Decide whether the next open-schema track should start with MCP/Codex/Claude
  agent evaluation or upload-level schema discovery.
- Add source-fact ownership and richer missing-value fixtures if source-only
  extras become a recurring scoring ambiguity.

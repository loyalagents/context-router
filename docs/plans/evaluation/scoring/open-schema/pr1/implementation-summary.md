# Open-Schema PR1 Memory Snapshot Export Implementation Summary

- Status: implemented
- Last updated: 2026-06-17

## Summary

PR1 added the open-schema memory snapshot export boundary. The repo can now
write a schema-validated `memory-snapshot.json` from existing authenticated
GraphQL APIs without enabling open-schema scoring or MCP open mode.

Known-schema artifacts and scorers remain unchanged.

## Implemented Behavior

- Added `pnpm eval:export-memory-snapshot`.
- Added `examples/eval/scripts/export-memory-snapshot.mjs`.
- Added `examples/eval/scripts/memory-snapshot/` modules for:
  - GraphQL query text.
  - Authenticated GraphQL POST requests.
  - Response-to-artifact mapping.
  - Preference and definition normalization.
  - Deterministic preference and definition sorting.
  - Definition baseline input/output and post-run diff diagnostics.
  - Shared GraphQL URL sanitization for artifacts, success output, and failure
    output.
- Added `examples/eval/schemas/memory-snapshot.schema.json`.
- Added focused Node tests for CLI behavior, schema validation, query-contract
  validation, diagnostics, suggestions, sorting, baselines, malformed data,
  GraphQL errors, HTTP errors, empty definition descriptions, and token/URL
  redaction.
- Updated open-schema orchestration to mark Checkpoint 1 as implemented.

## Artifact Behavior

The exporter writes `memory-snapshot.json` with:

- `artifactType: "memory-snapshot"` and `schemaVersion: 1`.
- Active `preferences[]` using the stored preference export row shape plus
  `definitionId`.
- Optional `suggestions[]` when `--include-suggestions` is provided.
- Visible `definitions[]` from `exportPreferenceSchema(scope: ALL)`.
  Descriptions may be empty strings because backend update paths can produce
  that valid state; schema quality remains a later diagnostic.
- `definitionBaseline` from `--baseline-in`, `--baseline-out`, or an explicit
  no-baseline diagnostic state.
- Diagnostics for backend identity, sanitized GraphQL URL, location mode,
  merged-location behavior, schema mode, schema reset mode, counts, and export
  time.

Definition-created-by-run detection uses post-run definition ID diffs against a
captured baseline. Slug diffs are deduped and preserved as diagnostics only.

## Verification

Commands run:

```bash
node --test examples/eval/scripts/export-memory-snapshot.test.mjs examples/eval/scripts/export-stored-preferences.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Results:

- Targeted memory snapshot and stored-preferences exporter tests passed: 30
  tests.
- Full eval script test suite passed: 271 tests.
- Eval validation passed with the existing 11 Alex realism warnings and no
  errors.
- `pnpm eval:verify` passed.

## Remaining Checkpoints

- Checkpoint 2: add deterministic open-schema database and combined scorers.
- Checkpoint 3: enable MCP `--schema-mode open --form-mode backend` with the
  deterministic command adapter first.
- Checkpoint 4: enable live Claude open-schema runs without adding identity
  tooling or artifact reliability labels.
- Checkpoint 5: design upload-level schema discovery after MCP open-schema
  scoring works.

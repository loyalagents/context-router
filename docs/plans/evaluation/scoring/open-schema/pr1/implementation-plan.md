# Open-Schema PR1 Memory Snapshot Export Implementation Plan

- Status: implemented
- Last updated: 2026-06-17

## Goal

Add the first open-schema evaluation checkpoint: a standalone exporter that
captures current backend memory and visible schema into `memory-snapshot.json`.

The artifact gives later open-schema scorers a clean boundary: they can score
what is actually active in memory, inspect optional suggestions, and diagnose
schema changes without changing known-schema artifacts or runner behavior.

## Non-Goals

- Do not implement open-schema database scoring.
- Do not implement open-schema combined scoring.
- Do not enable MCP `--schema-mode open`.
- Do not add backend upload-level schema discovery.
- Do not change `stored-preferences.json`, known-schema reports, or known-schema
  runner semantics.
- Do not auto-correct or hide backend/agent mistakes during export.

## Command Contract

```bash
pnpm eval:export-memory-snapshot \
  --user <userId> \
  --corpus <corpusId> \
  --out <file> \
  [--scenario <scenarioId>] \
  [--graphql-url <url>] \
  [--auth-token <token>] \
  [--location-id <locationId>] \
  [--include-suggestions] \
  [--producer <label>] \
  [--schema-mode open|known] \
  [--schema-reset-mode none|fresh-user|archive-eval-owned|baseline-only] \
  [--baseline-in <file>] \
  [--baseline-out <file>] \
  [--run-id <id>]
```

Resolution rules:

- `--graphql-url` falls back to `EVAL_GRAPHQL_URL`, then
  `http://localhost:3000/graphql`.
- `--auth-token` falls back to `EVAL_AUTH_TOKEN`; fail if neither is present.
- No `--location-id` means `global-only`.
- `--location-id` records a `merged-location` export because the existing
  backend API returns global plus location-specific active preferences.
- `--schema-mode` defaults to `open`.
- `--producer` defaults to `manual-or-export`.
- `--schema-reset-mode` defaults to `none`.
- `--baseline-in` and `--baseline-out` are mutually exclusive.

## Artifact Contract

`memory-snapshot.json` uses `schemaVersion: 1` and
`artifactType: "memory-snapshot"`.

Required top-level sections:

- `runId`, `evaluationMode`, `userId`, `corpusId`, and optional `scenarioId`.
- `storageInput` describing schema mode, producer, scored statuses, and whether
  suggestions were auto-applied.
- `preferences[]` using the current exported active preference row shape plus
  `definitionId`.
- Optional `suggestions[]`, only when requested.
- `definitions[]` using the currently exported GraphQL schema fields:
  `id`, `namespace`, `slug`, `displayName`, `ownerUserId`, `archivedAt`,
  `description`, `valueType`, `scope`, `options`, `isSensitive`, `isCore`, and
  `category`.
- `definitionBaseline` with preexisting definition IDs/slugs and post-run
  ID/slug diffs when a baseline is available.
- `diagnostics` with backend user identity, export timestamp, sanitized
  GraphQL URL, location mode, merge flag, schema mode, schema reset mode, and
  counts.

Definition state is benchmark state. PR1 supports saved baselines by writing
`--baseline-out` before later mutation or embedding a previous `--baseline-in`
into the final snapshot. New definitions are detected by definition ID diffs;
slug diffs remain diagnostic. The exporter does not rely on definition
timestamps because the current GraphQL schema does not expose them.

## Implementation Checkpoints

1. Add exporter modules and CLI.
   - Add GraphQL query text, authenticated client, mapper, argument parser, and
     schema validation.
   - Add `examples/eval/schemas/memory-snapshot.schema.json`.
   - Add `pnpm eval:export-memory-snapshot`.

2. Add focused tests.
   - Validate the GraphQL query against `apps/backend/src/schema.gql`.
   - Cover help, missing args, env fallback, CLI overrides, token redaction,
     suggestions, location diagnostics, deterministic sorting, baseline in/out,
     removed definitions, backend-valid empty definition descriptions,
     malformed rows, user mismatch, GraphQL errors, HTTP errors, and GraphQL
     URL credential redaction.

3. Documentation closeout.
   - Add this implementation plan.
   - Add
     `docs/plans/evaluation/scoring/open-schema/pr1/implementation-summary.md`.
   - Update open-schema orchestration and repo-level evaluation TODO docs.

## Verification Commands

```bash
node --test examples/eval/scripts/export-memory-snapshot.test.mjs examples/eval/scripts/export-stored-preferences.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

## Rollback Notes

Remove the memory snapshot exporter script/modules, the
`memory-snapshot.schema.json` schema, the `eval:export-memory-snapshot` package
script, the focused tests, and the PR1 documentation updates. Known-schema
export/scoring artifacts should require no rollback because PR1 keeps them
unchanged.

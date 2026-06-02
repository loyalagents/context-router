# Stored Preferences Exporter Implementation Plan

- Status: planned
- Last updated: 2026-06-02

## Goal

Add a standalone eval exporter that snapshots authenticated backend preference
memory into the scorer's existing `stored-preferences.json` artifact.

The exporter should use existing GraphQL APIs, not a new backend endpoint. The
scorer remains API-agnostic; only the exporter depends on the current GraphQL
contract.

## Non-Goals

- Do not add a new backend export endpoint.
- Do not implement document ingestion, auto-apply, or MCP agent runners.
- Do not support backwards compatibility with older GraphQL query shapes.
- Do not automatically fetch browser cookies or call the frontend debug token
  route.

## Command Contract

```bash
pnpm eval:export-stored-preferences \
  --user <userId> \
  --corpus <corpusId> \
  --out <file> \
  [--graphql-url <url>] \
  [--auth-token <token>] \
  [--location-id <locationId>] \
  [--include-suggestions] \
  [--ingestion-mode <label>] \
  [--suggestions-were-auto-applied true|false] \
  [--run-id <id>]
```

Resolution rules:

- `--graphql-url` falls back to `EVAL_GRAPHQL_URL`, then
  `http://localhost:3000/graphql`.
- `--auth-token` falls back to `EVAL_AUTH_TOKEN`; fail if neither is provided.
- `--location-id` opts into the existing API's merged global plus
  location-specific preference view.
- No `--location-id` exports user-global preferences, matching current
  form-fill behavior.

Local token workflow:

1. Start backend and frontend.
2. Log into the frontend.
3. Open `http://localhost:3002/api/debug/token?format=json`.
4. Copy `token` into `EVAL_AUTH_TOKEN` or pass it with `--auth-token`.

## Implementation Checkpoints

1. Add exporter modules and CLI.
   - Add query text, GraphQL fetch helper, mapper, argument parser, and schema
     validation under `examples/eval/scripts/exporter/`.
   - Add `examples/eval/scripts/export-stored-preferences.mjs`.
   - Add `pnpm eval:export-stored-preferences`.

2. Add GraphQL contract validation.
   - Add root `graphql` dev dependency so eval tests can validate the exporter
     query against `apps/backend/src/schema.gql`.
   - Keep tests intentionally strict so backend API drift fails clearly.

3. Add tests.
   - Cover CLI help and argument errors.
   - Cover env fallback and CLI override behavior.
   - Cover successful export, deterministic sorting, suggestions, schema
     validation, user mismatch, row mismatch, GraphQL errors, HTTP errors, and
     token redaction from diagnostics.

4. Documentation closeout.
   - Write `implementation-summary.md`.
   - Update scoring orchestration and TODO docs.
   - Update user-generation forms TODO and orchestration docs.

## Verification Commands

```bash
node --test examples/eval/scripts/export-stored-preferences.test.mjs examples/eval/scripts/scoring/*.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Optional manual smoke:

```bash
export EVAL_GRAPHQL_URL=http://localhost:3000/graphql
export EVAL_AUTH_TOKEN=<token-from-frontend-debug-route>

pnpm eval:export-stored-preferences \
  --user alex-i9-test \
  --corpus realistic \
  --out /private/tmp/alex-stored-preferences.json

pnpm eval:score \
  --mode database \
  --user alex-i9-test \
  --corpus realistic \
  --stored-preferences /private/tmp/alex-stored-preferences.json \
  --out /private/tmp/alex-database-score-report.json
```

## Rollback Notes

Remove the exporter script/modules, the `eval:export-stored-preferences` package
script, the root `graphql` dev dependency if it is only used by exporter tests,
and the exporter documentation updates.

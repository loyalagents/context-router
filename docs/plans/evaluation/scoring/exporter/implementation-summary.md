# Stored Preferences Exporter Implementation Summary

- Status: implemented
- Last updated: 2026-06-02

## Summary

Implemented a standalone eval exporter that snapshots authenticated backend
GraphQL preference state into the existing `stored-preferences.json` scorer
artifact.

The exporter uses existing GraphQL APIs and does not add a backend endpoint.
The scorer remains independent from backend/API details.

## Implemented Behavior

- Added `pnpm eval:export-stored-preferences`.
- Added exporter modules for:
  - strict GraphQL query text
  - authenticated GraphQL POST requests
  - response-to-artifact mapping
  - deterministic preference sorting
  - user/status/row validation
  - stored-preferences schema validation before write
- Added CLI support for:
  - `--graphql-url` with `EVAL_GRAPHQL_URL` fallback and localhost default
  - `--auth-token` with `EVAL_AUTH_TOKEN` fallback
  - `--location-id` for the existing merged global plus location API view
  - `--include-suggestions` for diagnostic suggested rows
  - `--ingestion-mode`, `--suggestions-were-auto-applied`, and `--run-id`
- Added output diagnostics with GraphQL URL, location mode, counts, export
  timestamp, and query name.
- Ensured diagnostics, successful CLI output, and failure CLI output never
  include the auth token.
- Added root `graphql` dev dependency so eval tests can validate the exporter
  query against `apps/backend/src/schema.gql`.

## Verification

Commands run:

```bash
node --test examples/eval/scripts/export-stored-preferences.test.mjs examples/eval/scripts/scoring/*.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Results:

- Targeted exporter and scorer tests passed.
- Full eval script test suite passed with 169 tests.
- Eval validation passed with the existing 9 Alex realism warnings and no
  errors.
- `pnpm eval:verify` passed.

## Known Limitations

- The exporter requires an authenticated bearer token.
- The CLI does not fetch the frontend debug token automatically; users copy the
  token from `/api/debug/token?format=json`.
- No document-ingestion runner or auto-apply flow exists yet.
- Location-specific scoring semantics remain future work; `--location-id`
  exports the current API's merged view for diagnostics.

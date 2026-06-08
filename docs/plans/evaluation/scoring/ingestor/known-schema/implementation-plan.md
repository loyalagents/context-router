# Known-Schema Ingestor Implementation Plan

- Status: implementation plan
- Last updated: 2026-06-08

## Goal

Implement `pnpm eval:ingest-documents` for the known-schema ingestion benchmark.
The command should use existing backend APIs to reset current-user memory, ensure
target preference definitions exist without values, upload corpus documents,
auto-apply only suggestions returned by each upload response, optionally export
`stored-preferences.json`, optionally run database scoring, and write an
ingestion run summary.

This does not implement open-schema slug discovery, upload-level proposed
definitions, or MCP/Codex/Claude agent evaluation.

## Command Contract

```bash
pnpm eval:ingest-documents \
  --user <evalUserId> \
  --corpus <corpusId> \
  --documents-root <dir> \
  --out <ingestion-run.json> \
  [--backend-url <url>] \
  [--graphql-url <url>] \
  [--auth-token <token>] \
  [--reset-memory] \
  [--skip-ensure-definitions] \
  [--seed-preferences <file>] \
  [--no-auto-apply] \
  [--export-stored-preferences <file>] \
  [--database-score-report <file>] \
  [--location-id <locationId>] \
  [--run-id <id>]
```

Defaults:

- `--backend-url` -> `EVAL_BACKEND_URL` -> `http://localhost:3000`
- `--graphql-url` -> `EVAL_GRAPHQL_URL` -> `http://localhost:3000/graphql`
- `--auth-token` -> `EVAL_AUTH_TOKEN`, required
- auto-apply enabled unless `--no-auto-apply` is passed
- definition setup enabled unless `--skip-ensure-definitions` is passed
- memory reset only when `--reset-memory` is passed

## Implementation Checkpoints

1. Add docs and package script.
   - Add this plan before code changes.
   - Add `eval:ingest-documents` to `package.json`.

2. Add ingestor schema and modules.
   - Add an `ingestion-run` schema under `examples/eval/schemas`.
   - Add CLI parsing, GraphQL helper calls, upload helper, definition setup,
     seed setup, run-summary building, and token redaction.

3. Reuse existing backend APIs.
   - `me`
   - `resetMyMemory(MEMORY_ONLY)`
   - `exportPreferenceSchema(scope: ALL)`
   - `createPreferenceDefinition`
   - `setPreference` only for explicit seed inputs
   - `POST /api/preferences/analysis`
   - `applyPreferenceSuggestions`
   - existing exporter/scorer helpers for optional export and database scoring

4. Fix exporter identity semantics for ingestion.
   - Keep `stored-preferences.userId` as the eval fixture user.
   - Validate GraphQL rows against backend `me.userId`.
   - Add `diagnostics.backendUserId`.
   - Update exporter tests and docs.

5. Close out docs.
   - Write `docs/plans/evaluation/scoring/known-schema/ingestor-summary.md`.
   - Update `docs/plans/evaluation/scoring/orchestration.md`.
   - Update `docs/plans/evaluation/scoring/TODO.md`.

## Key Behavior

- Definition setup creates only canonical target definitions when missing. It
  does not write values.
- Seed values are written only when `--seed-preferences` is explicitly passed.
- Upload paths come from the corpus manifest and are resolved under
  `--documents-root`.
- Auto-apply uses only the current upload response's `suggestions[]`.
- The ingestor never queries or accepts `suggestedPreferences`.
- Pagination-looking upload responses fail clearly until pagination is
  supported.
- The run summary records eval fixture identity and backend authenticated
  identity separately.
- Auth tokens are never written to artifacts or unredacted error output.

## Verification

Run:

```bash
node --test examples/eval/scripts/ingest-documents.test.mjs examples/eval/scripts/export-stored-preferences.test.mjs
node --test examples/eval/scripts/scoring/*.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Optional local smoke when backend, token, and Vertex are configured:

```bash
USER_ID=alex-i9-test
PREVIEW=/private/tmp/alex-known-schema-preview
RUN=/private/tmp/alex-known-schema-ingestion-run.json
PREFS=/private/tmp/alex-known-schema-stored-preferences.json
DB_REPORT=/private/tmp/alex-known-schema-db-score.json

pnpm eval:ingest-documents \
  --user "$USER_ID" \
  --corpus realistic \
  --documents-root "$PREVIEW" \
  --reset-memory \
  --export-stored-preferences "$PREFS" \
  --database-score-report "$DB_REPORT" \
  --out "$RUN"
```

## Rollback

Remove the ingestor script/modules, package script, ingestion-run schema, exporter
identity changes if unused elsewhere, tests, and documentation updates.

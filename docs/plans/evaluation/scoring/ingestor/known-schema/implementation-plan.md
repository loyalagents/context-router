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
   - Write `docs/plans/evaluation/scoring/ingestor/known-schema/ingestor-summary.md`.
   - Update `docs/plans/evaluation/scoring/orchestration.md`.
   - Update `docs/plans/evaluation/scoring/TODO.md`.

## Key Behavior

- Definition setup creates only canonical target definitions when missing,
  including intentionally missing abstention targets. It does not write values.
- Created definitions are user-owned by the authenticated backend user; the
  `GLOBAL` scope marks how the definition is used, not shared catalog ownership.
- Existing target definitions are checked for `valueType` compatibility before
  creating any missing definitions. A stale incompatible definition is a setup
  failure because it can skew extraction and scoring.
- Seed values are written only when `--seed-preferences` is explicitly passed.
- Upload paths come from the corpus manifest and are resolved under
  `--documents-root`.
- Upload responses must include complete suggestion objects even when
  `--no-auto-apply` is used, because that mode is still an upload contract and
  diagnostics capture mode.
- Auto-apply uses only the current upload response's `suggestions[]`.
- The ingestor never queries or accepts `suggestedPreferences`.
- Backend-reported `parse_error` / `ai_error` and upload HTTP failures are
  recorded as per-document failures. The ingestor continues through later
  documents, runs requested export/scoring steps, writes a partial run artifact,
  and exits nonzero at the end.
- Contract-shape failures still abort before export/scoring: pagination-looking
  upload responses, missing required upload fields, and malformed suggestion
  inputs fail clearly until the contract supports them.
- Apply mutation failures and partial apply success are hard failures because
  the current runner does not prove whether the backend wrote partial state.
  If `applyPreferenceSuggestions` returns fewer preferences than requested, the
  run aborts before export/scoring.
- The summary records uploaded documents, analyzed documents, failed documents,
  applied suggestions, and apply failures separately.
- `analyzedCount` means documents with an analysis record, including backend
  `parse_error` / `ai_error` analysis records.
- The run summary records eval fixture identity and backend authenticated
  identity separately.
- Auth tokens are never written to artifacts or unredacted error output.
- Suggestion confidence is recorded as reported by the backend; unusual values
  outside `[0, 1]` should not suppress the entire run artifact.
- Chained database score reports should be interpreted together with
  `ingestion-run.json`; a score report from a partial ingestion run is useful
  diagnostics, not a clean-run benchmark result.

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

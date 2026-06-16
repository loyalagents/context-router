# MCP Known-Schema Eval Runner Implementation Plan

- Status: implementation plan
- Last updated: 2026-06-16

## Goal

Implement `pnpm eval:e2e-mcp-agent` for known-schema MCP memory ingestion. The
runner validates corpus documents, prepares backend memory/schema, runs one
Claude or explicit command agent session, exports active memory, fills the form from
backend memory, and reuses the existing deterministic scorers.

This plan does not implement open-schema scoring, backend upload-level schema
discovery, an MCP document-upload tool, or agent-filled forms.

## Command Contract

```bash
pnpm eval:e2e-mcp-agent \
  --agent claude|command \
  --schema-mode known \
  --form-mode backend \
  --user <userId> \
  --corpus <corpusId> \
  --scenario <scenarioId> \
  --artifacts-root <dir> \
  --mcp-server <name> \
  [--documents-root <dir>] \
  [--backend-url <url>] \
  [--graphql-url <url>] \
  [--auth-token <token>] \
  [--agent-command <command>] \
  [--mcp-config <path>] \
  [--agent-timeout-ms <ms>] \
  [--prompt-template <path>] \
  [--model-label <label>] \
  [--reset-memory] \
  [--skip-ensure-definitions] \
  [--location-id <locationId>] \
  [--run-id <id>]
```

Defaults:

- `--documents-root` defaults to
  `examples/eval/users/<user>/corpora/<corpus>`.
- `--backend-url` falls back to `EVAL_BACKEND_URL`, then
  `http://localhost:3000`.
- `--graphql-url` falls back to `EVAL_GRAPHQL_URL`, then
  `http://localhost:3000/graphql`.
- `--auth-token` falls back to `EVAL_AUTH_TOKEN` and is required.
- `--mcp-config` is required with `--agent claude` and is passed with
  `--strict-mcp-config`.
- `--agent-timeout-ms` defaults to 900000.
- `--model-label` falls back to `EVAL_MODEL_LABEL`.
- `--agent codex` is reserved until a similarly isolated Codex adapter is
  implemented.
- `--schema-mode open` and `--form-mode agent` are reserved and should fail
  with usage errors until implemented.

## Implementation Checkpoints

1. Add docs and tracker files.
   - Add this plan before code changes.
   - Add `docs/plans/evaluation/scoring/MCP-scoring/orchestration.md`.

2. Extract shared known-schema setup helpers.
   - Move reusable fixture loading and definition setup from
     `ingest-documents.mjs` into a shared helper.
   - Preserve `eval:ingest-documents` behavior.
   - Shared setup should fetch backend user, optionally reset memory, collect
     known-schema definition targets, ensure compatible definitions, and create
     missing definitions without writing values.

3. Add prompt and artifact contracts.
   - Add `examples/eval/prompts/mcp-known-schema.md`.
   - Add `examples/eval/schemas/mcp-agent-run.schema.json`.
   - Update `evaluation-run.schema.json` for `mcp-known-schema` and MCP stage
     names.
   - Prompt rendering must exclude profile truth, validation reports, accepted
     slug maps, expected snapshots, score paths, and manifest truth metadata.

4. Add the MCP runner and adapters.
   - Add `examples/eval/scripts/e2e-mcp-agent.mjs`.
   - Add Claude and explicit command adapters.
   - Stage an isolated agent workspace under `--artifacts-root` containing only
     declared corpus documents and a safe document index.
   - Launch the agent from the staged workspace with a sanitized environment
     that does not inherit `EVAL_AUTH_TOKEN`, backend credentials, Auth0
     secrets, or database URLs.
   - Capture redacted transcript output and completion-marker diagnostics.
   - Treat nonzero exit and timeout as failures. Treat a missing completion
     marker as diagnostic-only for v1.

5. Add package script and tests.
   - Add `eval:e2e-mcp-agent` to `package.json`.
   - Add targeted runner tests with fake agent commands.
   - Keep live Codex/Claude MCP runs as manual smoke tests.

6. Close out docs.
   - Update TODO and orchestration docs.
   - Add `implementation-summary.md` after verification.

## Verification

Run:

```bash
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/ingest-documents.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Optional local smoke:

```bash
pnpm eval:e2e-mcp-agent \
  --agent claude \
  --schema-mode known \
  --form-mode backend \
  --user alex-i9-test \
  --corpus realistic \
  --scenario alex-i9-realistic \
  --artifacts-root /private/tmp/alex-mcp-known \
  --mcp-server context-router-local \
  --mcp-config /path/to/context-router-mcp.json \
  --reset-memory
```

## Rollback

The runner is additive. Remove the package script, MCP runner, MCP run schema,
prompt template, tests, and MCP docs. Keep the extracted setup helper only if
`ingest-documents` still benefits from it; otherwise inline it back into the
ingestor.

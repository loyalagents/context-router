# Open-Schema PR3 MCP Runner Implementation Summary

- Status: implemented
- Last updated: 2026-06-17

## Summary

PR3 enables open-schema MCP runner wiring for the deterministic `command`
adapter:

```bash
pnpm eval:e2e-mcp-agent --schema-mode open --form-mode backend
```

The runner now executes the open-schema artifact chain from PR1 and PR2 without
changing known-schema MCP artifacts or score report contracts.

## Implemented Behavior

- Added `examples/eval/prompts/mcp-open-schema.md`.
- Accepted `--schema-mode open` for `--agent command`.
- Kept `--agent codex`, live Claude open mode, and `--form-mode agent`
  reserved.
- Defaulted open mode to the open-schema prompt template.
- Generated open run IDs with the `mcp-open-schema-` prefix.
- Forced known-schema definition setup off in open mode.
- Added open stage orchestration:
  - `setup-open-schema-memory`;
  - `capture-definition-baseline`;
  - `export-memory-snapshot`;
  - `score-open-schema-database`;
  - `score-open-schema-combined`.
- Captured `definition-baseline.json` before the agent stage using existing
  memory snapshot GraphQL helpers.
- Exported final memory with `memory-snapshot.json`, `baseline-only`,
  `--baseline-in`, `--include-suggestions`, and producer
  `mcp-open-schema-agent`.
- Scored with PR2 `open-schema-database` and `open-schema-combined` modes.
- Updated `evaluation-run.schema.json` and `mcp-agent-run.schema.json` for
  open stage names and mode-specific artifact paths.
- Added deterministic runner tests for the open happy path and failure paths.

## Known-Schema Stability

Known mode keeps the existing stage order:

```text
validate-documents
  -> setup-memory-and-schema
  -> run-mcp-agent
  -> export-stored-preferences
  -> score-database
  -> fill-form
  -> score-form
  -> score-combined
```

Known mode still writes `stored-preferences.json`,
`database-score-report.json`, and `combined-score-report.json`.

## Remaining Checkpoints

- Checkpoint 4: add MCP/backend identity hardening and schema-state isolation,
  then run a live Claude open-schema smoke with a clear reliability label.
- Checkpoint 5: design upload-level schema discovery after MCP open-schema
  scoring is working.

## Verification

Commands run:

```bash
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/export-memory-snapshot.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Results:

- Focused MCP runner tests passed: 19 tests.
- PR3 targeted runner/exporter/score tests passed: 41 tests.
- Full eval script suite passed: 284 tests.
- Eval validation passed with the existing 11 Alex realistic warnings and no
  errors.
- `pnpm eval:verify` passed.

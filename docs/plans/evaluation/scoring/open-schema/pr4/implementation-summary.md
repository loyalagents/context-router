# Open-Schema PR4 Live Claude Implementation Summary

- Status: implemented
- Last updated: 2026-06-17

## Summary

PR4 enables live Claude open-schema MCP runs:

```bash
pnpm eval:e2e-mcp-agent --agent claude --schema-mode open --form-mode backend
```

The implementation reuses the PR3 open-schema artifact chain unchanged and
only relaxes the runner gate that previously limited open mode to the
deterministic command adapter.

## Implemented Behavior

- Accepted `--agent claude --schema-mode open --form-mode backend` when
  `--mcp-config` is provided.
- Kept `--agent codex` reserved.
- Kept `--form-mode agent` reserved.
- Kept command adapter safeguards unchanged.
- Kept open mode defaulting to `examples/eval/prompts/mcp-open-schema.md`.
- Kept open mode forcing known-schema definition setup off.
- Kept open mode exporting `memory-snapshot.json` with `baseline-only`,
  `--baseline-in`, `--include-suggestions`, and producer
  `mcp-open-schema-agent`.
- Added `--reset-demo-data` for explicit current-user demo-data resets via
  existing `resetMyMemory(mode: DEMO_DATA)` backend behavior. This is mutually
  exclusive with `--reset-memory`, requires backend `ENABLE_DEMO_RESET=true`,
  and clears user-owned definitions before baseline capture.
- Recorded reset mode in `evaluation-run.json` settings and
  `mcp-agent-run.json` setup metadata.
- Kept existing identity metadata without adding a new MCP identity tool or
  artifact reliability label.
- Added mocked Claude open-schema runner coverage for the full open-stage
  chain and schema-valid run artifacts.

## Known-Schema Stability

Known-schema MCP behavior is unchanged. Known mode still writes
`stored-preferences.json`, `database-score-report.json`, and
`combined-score-report.json`, and still uses the known-schema prompt by
default.

## Remaining Checkpoints

- Later identity hardening can add stronger proof that the Claude MCP session
  and `EVAL_AUTH_TOKEN` resolve to the same backend user if research needs it.
- Later repeatability work can add fresh-user or selective eval-owned
  definition-cleanup workflows if whole-user demo-data reset is too blunt.
- Checkpoint 5 remains upload-level schema discovery.

## Verification

Commands run:

```bash
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/export-memory-snapshot.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Results:

- Targeted runner/exporter/score tests passed: 43 tests.
- Full eval script suite passed: 286 tests.
- Eval validation passed with the existing 11 Alex realistic warnings and no
  errors.
- `pnpm eval:verify` passed.

# MCP Scoring Orchestration

- Status: active implementation tracker
- Last updated: 2026-06-15

## Target Flow

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

## Checkpoints

- [x] Add implementation plan.
- [x] Extract shared known-schema setup helpers.
- [x] Add prompt template and `mcp-agent-run` schema.
- [x] Add `eval:e2e-mcp-agent` runner and agent adapters.
- [x] Add targeted tests.
- [x] Run targeted and full eval verification.
- [x] Add implementation summary.
- [ ] Run optional live Codex MCP smoke against `context-router-local`.

## Notes

- V1 is known-schema MCP memory ingestion with backend form fill.
- Open schema remains a follow-up after the known-schema runner has a useful
  smoke result.
- Low scores are benchmark output, not runner failures.
- Automated verification used fake agent runners and local command-adapter
  tests. Live smoke was not run because it needs a running backend,
  `EVAL_AUTH_TOKEN`, and an authenticated `context-router-local` MCP config.

# MCP Scoring Orchestration

- Status: active implementation tracker
- Last updated: 2026-06-16

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
- [x] Harden agent isolation after PR feedback.
- [x] Restrict v1 real-agent support to Claude plus command test adapter.
- [ ] Run optional live Claude MCP smoke against `context-router-local`.

## Notes

- V1 is known-schema MCP memory ingestion with backend form fill.
- V1 supports `--agent claude --mcp-config <path>` for live runs and
  `--agent command` for deterministic tests.
- The agent is launched from `agent-workspace/`, which contains only declared
  corpus documents and a safe document index.
- Open schema remains a follow-up after the known-schema runner has a useful
  smoke result.
- Low scores are benchmark output, not runner failures.
- Automated verification used fake agent runners and local command-adapter
  tests. Live smoke was not run because it needs a running backend,
  `EVAL_AUTH_TOKEN`, Claude auth, and a Claude MCP config containing
  `context-router-local`.

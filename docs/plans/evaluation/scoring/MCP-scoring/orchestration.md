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
- [x] Require explicit opt-in for the deterministic command test adapter.
- [x] Allow Claude headless/cloud model-provider auth env vars while stripping
  eval/backend/database secrets.
- [x] Record staged-document containment and unverified MCP/backend identity
  honestly in `mcp-agent-run.json`.
- [x] Run optional live Claude MCP smoke against `context-router-local`.
- [x] Fail live Claude runs when the MCP server is unavailable, no MCP tools are
  exposed, or the required completion marker is missing.
- [x] Clarify known-schema MCP as existing visible backend schema, not a closed
  target-form-only schema.
- [x] Harden backend form-fill prompt wording so field policies are
  authoritative and semantically similar source substitutions are discouraged
  while remaining visible to scoring.
- [ ] Add a hard MCP/backend identity preflight before using live MCP scores as
  benchmark-reliable rather than smoke-only.

## Notes

- V1 is known-schema MCP memory ingestion with backend form fill.
- In V1, `--schema-mode known` means the agent sees and may use existing
  backend schema through MCP. It is intentionally different from the backend
  known-schema document ingestor and is not a closed target-form-only benchmark.
- V1 supports `--agent claude --mcp-config <path>` for live runs and
  `--agent command --allow-test-command-agent` for deterministic tests.
- The agent is launched from `agent-workspace/`, which contains only declared
  corpus documents and a safe document index. This is not an OS-level
  filesystem sandbox, and the command adapter is not benchmark-safe.
- Live Claude scores require the Claude MCP config to authenticate as the same
  backend user as `EVAL_AUTH_TOKEN`; v1 records that this is unverified.
- Live Claude runs hard-fail the agent stage if `context-router-local` is not
  connected, no `mcp__context-router-local__*` tools are exposed, or
  `EVAL_MCP_AGENT_DONE` is missing.
- `mcp-agent-transcript.txt` can contain corpus PII even after auth-token
  redaction, so artifact roots should not be committed.
- Open schema remains a follow-up after the known-schema runner has a useful
  smoke result.
- Backend form-fill prompting now tells the model to treat field policies as
  authoritative, use only allowed `sourceSlugs`, skip when no allowed source is
  usable, and avoid semantically similar substitutions. Field-policy parsing now
  rejects `mode=fact` policies without explicit `sourceSlugs`; off-policy source
  slug validation remains diagnostic-only so score reports still capture real
  form-fill failures.
- Low scores are benchmark output, not runner failures.
- Automated verification uses fake agent runners and local command-adapter
  tests. The first live smoke completed locally on 2026-06-16 with 27 active
  preferences exported, 21/22 known-present database facts correct, and 16/17
  known form fields correct.

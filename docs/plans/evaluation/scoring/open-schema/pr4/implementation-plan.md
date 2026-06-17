# Open-Schema PR4 Live Claude Implementation Plan

- Status: implemented
- Last updated: 2026-06-17

## Goal

Enable live Claude open-schema MCP runs through the existing PR1-PR3 artifact
chain:

```bash
pnpm eval:e2e-mcp-agent --agent claude --schema-mode open --form-mode backend
```

PR4 is a research-eval enablement checkpoint. It lets Claude use the
open-schema prompt and existing MCP tools to create or reuse definitions, store
active memory, export `memory-snapshot.json`, and score the backend form-fill
outcome.

## Non-Goals

- Do not add a new MCP identity tool.
- Do not add benchmark reliability or smoke labels to artifacts.
- Do not automate fresh-user creation or selective eval-owned definition
  cleanup.
- Do not enable `--agent codex`.
- Do not enable `--form-mode agent`.
- Do not add backend upload-level schema discovery.
- Do not change known-schema artifacts or scoring contracts.

## Runner Contract

Open mode keeps the PR3 stage list:

```text
validate-documents
  -> setup-open-schema-memory
  -> capture-definition-baseline
  -> run-mcp-agent
  -> export-memory-snapshot
  -> score-open-schema-database
  -> fill-form
  -> score-form
  -> score-open-schema-combined
```

The only runner behavior change is CLI gating:

- `--agent claude --schema-mode open --form-mode backend` is accepted when
  `--mcp-config` is provided.
- `--agent command --schema-mode open --form-mode backend` remains supported
  with the existing test-adapter opt-in flags.
- `--agent codex` and `--form-mode agent` remain reserved.
- `--reset-demo-data` is an explicit current-user wipe using existing
  `resetMyMemory(mode: DEMO_DATA)` backend behavior. It is mutually exclusive
  with `--reset-memory`, requires backend `ENABLE_DEMO_RESET=true`, and is the
  no-new-account path for clearing user-owned open-schema definitions before
  baseline capture.

## Artifact Contract

PR4 keeps the existing artifact schemas and paths:

- `definition-baseline.json`
- `mcp-agent-run.json`
- `memory-snapshot.json`
- `open-schema-database-score-report.json`
- `filled-form.json`
- `form-score-report.json`
- `open-schema-combined-score-report.json`
- `evaluation-run.json`

`mcp-agent-run.json` continues to record identity as factual metadata:

- `identity.verifiedSameBackendUser: false`
- `identity.verificationMethod: "not-implemented"`

No new benchmark maturity label is added in PR4.

`evaluation-run.json` and `mcp-agent-run.json` record the reset mode when a
runner reset is requested:

- `MEMORY_ONLY` for `--reset-memory`
- `DEMO_DATA` for `--reset-demo-data`

## Tests And Verification

- Parser tests cover open Claude acceptance, open prompt defaults, open run ID
  prefix, required `--mcp-config`, reserved Codex, reserved agent-form mode,
  mutually exclusive reset flags, demo-data reset mode, and existing
  command-adapter safeguards.
- Mocked Claude runner coverage exercises the full open-stage order and
  validates `evaluation-run.json` and `mcp-agent-run.json`.
- Existing command-adapter open tests continue to prove the PR3 stage chain.
- Failure-path tests continue to prove redaction and skipped later stages.

Verification commands:

```bash
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/export-memory-snapshot.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Optional manual live run after tests:

```bash
pnpm eval:e2e-mcp-agent \
  --agent claude \
  --schema-mode open \
  --form-mode backend \
  --user alex-i9-test \
  --corpus realistic \
  --scenario alex-i9-realistic \
  --artifacts-root /tmp/context-router-open-claude \
  --mcp-server context-router-local \
  --mcp-config /path/to/context-router-mcp.json \
  --reset-demo-data
```

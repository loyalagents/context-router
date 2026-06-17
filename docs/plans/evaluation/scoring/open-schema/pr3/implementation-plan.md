# Open-Schema PR3 MCP Runner Implementation Plan

- Status: implemented
- Last updated: 2026-06-17

## Goal

Enable Checkpoint 3 for open-schema evaluation:

```bash
pnpm eval:e2e-mcp-agent --schema-mode open --form-mode backend
```

PR3 wires the deterministic `command` adapter through the full open-schema
artifact chain. It exercises the same runner surface as MCP known-schema runs,
but branches to PR1/PR2 open-schema artifacts after the agent writes memory.

## Non-Goals

- Do not run or bless live Claude open-schema smoke.
- Do not enable `--agent codex`.
- Do not enable `--form-mode agent`.
- Do not add MCP/backend identity hardening.
- Do not implement fresh-user or cleanup schema isolation.
- Do not add backend upload-level schema discovery.
- Do not change known-schema MCP artifact names or scoring contracts.

## Runner Contract

Known mode keeps the existing stage list:

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

Open mode uses:

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

Open mode is accepted only for the deterministic command adapter in PR3. Live
Claude open-schema runs remain reserved until identity and schema-state
isolation are addressed.

## Artifact Contract

Open mode adds these runner artifacts under the run artifact root:

- `definition-baseline.json`
- `memory-snapshot.json`
- `open-schema-database-score-report.json`
- `open-schema-combined-score-report.json`

`mcp-agent-run.json` records mode-specific artifact paths:

- known mode records `stored-preferences.json`, `database-score-report.json`,
  and `combined-score-report.json`;
- open mode records the definition baseline, memory snapshot, and open-schema
  score reports.

`evaluation-run.json` records `evaluationMode: "mcp-open-schema"` and the open
stage names.

## Implementation Checkpoints

1. Add open-mode parser and prompt defaults.
   - Accept `--schema-mode open`.
   - Default to `examples/eval/prompts/mcp-open-schema.md`.
   - Generate run IDs with the `mcp-open-schema-` prefix.
   - Keep `--form-mode agent`, `--agent codex`, and live Claude open mode
     rejected.

2. Add open-stage orchestration.
   - Force known-schema definition setup off in open mode.
   - Keep `--reset-memory` scoped to active memory values.
   - Capture `definition-baseline.json` before the agent stage.
   - Run the existing agent stage against the staged document workspace.
   - Export `memory-snapshot.json` with `--baseline-in`,
     `--schema-mode open`, `--schema-reset-mode baseline-only`,
     `--include-suggestions`, and `--producer mcp-open-schema-agent`.
   - Score with PR2 `open-schema-database` and `open-schema-combined` modes.

3. Update schemas.
   - Allow open stage names in `evaluation-run.schema.json`.
   - Allow `schemaMode: "open"` in `mcp-agent-run.schema.json`.
   - Require mode-specific known or open artifact paths.

4. Add focused tests.
   - Parser/default behavior.
   - Hidden-truth-safe open prompt.
   - Full deterministic command-adapter open run.
   - Agent, baseline, and memory snapshot export failure paths.
   - Existing known-schema MCP tests unchanged.

5. Documentation closeout.
   - Add this plan and PR3 implementation summary.
   - Update open-schema orchestration, scoring orchestration, and scoring TODO.

## Verification Commands

```bash
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/export-memory-snapshot.test.mjs examples/eval/scripts/score.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

## Rollback Notes

Remove the open prompt, open-mode runner branches, schema additions, PR3 tests,
and PR3 docs. Known-schema runner behavior should not require rollback because
the known stage list and known artifact names remain unchanged.

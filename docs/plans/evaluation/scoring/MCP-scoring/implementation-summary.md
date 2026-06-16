# MCP Known-Schema Eval Runner Implementation Summary

- Status: implemented
- Last updated: 2026-06-15

## Implemented

- Added `pnpm eval:e2e-mcp-agent`.
- Added `examples/eval/scripts/e2e-mcp-agent.mjs` as a sibling of
  `e2e-known-schema.mjs`.
- Added known-schema setup helpers in `examples/eval/scripts/ingestor/setup.mjs`
  and reused them from `ingest-documents.mjs`.
- Added the default prompt template at
  `examples/eval/prompts/mcp-known-schema.md`.
- Added `examples/eval/schemas/mcp-agent-run.schema.json`.
- Updated `evaluation-run.schema.json` so it validates the existing
  `known-schema` wrapper and the new `mcp-known-schema` stage flow.
- Added tests in `examples/eval/scripts/e2e-mcp-agent.test.mjs`.

## Runner Flow

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

The runner supports:

- `--agent codex`
- `--agent claude`
- `--agent command --agent-command <command>`
- `--schema-mode known`
- `--form-mode backend`

`--schema-mode open` and `--form-mode agent` intentionally fail with usage
errors until their separate implementations exist.

## Artifacts

The runner writes:

- `validation-report.json`
- `mcp-agent-run.json`
- `mcp-agent-prompt.md`
- `mcp-agent-transcript.txt`
- `stored-preferences.json`
- `database-score-report.json`
- `filled-form.json`
- `filled-form.pdf`
- `form-fill-response.json`
- `form-score-report.json`
- `combined-score-report.json`
- `evaluation-run.json`

Prompt rendering includes only safe context: scenario purpose/prompt, form id,
schema/form modes, MCP server name, corpus root, and document id/path/title/
category/output extension. It excludes profile truth, validation reports,
fact-storage maps, expected snapshots, score artifacts, and manifest truth
metadata.

## Verification

Passed:

```bash
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/ingest-documents.test.mjs
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

`pnpm eval:validate` still reports the existing Alex realistic corpus warnings
and no errors.

## Not Run

The optional live MCP smoke was not run. It requires:

- backend running
- `EVAL_AUTH_TOKEN`
- authenticated `context-router-local` MCP config for the selected agent

Suggested smoke:

```bash
pnpm eval:e2e-mcp-agent \
  --agent codex \
  --schema-mode known \
  --form-mode backend \
  --user alex-i9-test \
  --corpus realistic \
  --scenario alex-i9-realistic \
  --artifacts-root /private/tmp/alex-mcp-known \
  --mcp-server context-router-local \
  --reset-memory
```

## Follow-Up

- Run the live MCP smoke before implementing open-schema scoring.
- Keep `toolCallCount`, `preferenceWriteCount`, and `definitionCreateCount`
  null until a reliable source such as MCP access logs is wired into the eval
  artifact.

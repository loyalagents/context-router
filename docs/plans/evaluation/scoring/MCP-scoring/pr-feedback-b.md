# MCP Known-Schema Eval Runner Follow-Up Review

- Review target: `1b61cf9` (`Harden MCP eval runner isolation and Claude-only v1`)
- Compared against: prior feedback in `pr-feedback-a.md` and the resulting implementation in isolation.

## Prior Feedback Status

- Hidden-truth prompt/filesystem exposure: materially improved. The runner now stages an `agent-workspace/` and the prompt points at that workspace instead of the source fixture tree.
- Agent subprocess env leak: addressed for eval/backend/database credentials through `buildAgentEnvironment`.
- `mcp-agent-run.json` stuck as `running` on thrown agent failures: addressed with `runMcpAgentStage` error handling and a test.
- `eval:ingest-documents` partial setup diagnostics: addressed through `onProgress` and a regression test.

## Must Fix

### 1. The runner still cannot prove the MCP agent writes to the same backend user it scores

Setup, export, scoring, and form-fill all use `EVAL_AUTH_TOKEN` / `options.authToken`: setup passes it into `prepareKnownSchemaMemory` (`examples/eval/scripts/e2e-mcp-agent.mjs:131`), form-fill uses it (`examples/eval/scripts/e2e-mcp-agent.mjs:230`), and export args include it (`examples/eval/scripts/e2e-mcp-agent.mjs:1190`). The actual agent writes through a separate Claude MCP config and server name (`examples/eval/scripts/e2e-mcp-agent.mjs:871`), but the runner never verifies that the MCP-authenticated user matches `setupResult.backendUserId`.

If the Claude MCP config is authenticated as a different user, the run can reset/export/fill one user while the agent writes another. That produces a clean pipeline with low or empty scores, misattributing setup/auth drift as agent extraction failure.

This needs a hard preflight or post-agent identity check. A simple MCP identity tool would be ideal; absent that, the runner needs some explicit contract that proves the MCP session and GraphQL token target the same backend user before scoring.

## Should Fix

### 2. `--agent command` is not actually isolated from sibling artifacts

The staged workspace is under the artifact root (`examples/eval/scripts/e2e-mcp-agent.mjs:992`), while validation and runner artifacts are siblings (`examples/eval/scripts/e2e-mcp-agent.mjs:1002`). The command adapter runs with `cwd` set to `agentWorkspaceRoot` (`examples/eval/scripts/e2e-mcp-agent.mjs:898`), but a shell command can still read `../validation-report.json`, `../mcp-agent-run.json`, and later sibling artifacts.

That is acceptable if `--agent command` is only a deterministic test adapter, but it should not be treated as benchmark-safe isolation. Either gate/document it as test-only or keep forbidden artifacts somewhere the launched process cannot reach. For Claude, the current isolation also relies on Claude Code enforcing the working directory for file tools; the docs should avoid claiming a hard filesystem boundary unless that is verified.

## Optional Follow-Up

- `brainstorm.md` still contains older examples and checkpoints that name `--agent codex` as the first live command. Since v1 now intentionally reserves Codex, those sections should be updated or labeled as historical/general design notes.

## Verified

Passed:

```bash
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/ingest-documents.test.mjs
pnpm eval:validate
pnpm eval:test
```

`pnpm eval:validate` still reports the existing Alex realistic corpus warnings and no errors. I did not run the live Claude MCP smoke.

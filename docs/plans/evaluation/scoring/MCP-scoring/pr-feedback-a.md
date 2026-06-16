# MCP Known-Schema Eval Runner Review

- Review target: `b08f726` (`Implement MCP known-schema eval runner`) against `origin/main`
- Scope reviewed: MCP scoring plan docs, surrounding scoring/ingestor docs, eval runner scripts, prompt/schema contracts, tests, and the implementation diff.

## Must Fix

### 1. The agent can still read hidden truth from the repo

The prompt excludes answer-key content, but the launched agent is not isolated from the files that contain it. `runAgentProcess` starts the subprocess with `cwd: repoRoot` and normal pipes (`examples/eval/scripts/e2e-mcp-agent.mjs:745`), while the Codex adapter uses a read-only sandbox rooted at the repo (`examples/eval/scripts/e2e-mcp-agent.mjs:804`). Claude and command runs are also started from the repo. That means the agent can read files the plan explicitly says it must not see, including `examples/eval/users/alex-i9-test/profile.yaml:4`, `examples/eval/users/alex-i9-test/corpora/realistic/manifest.json:51`, and any generated `validation-report.json` if `--artifacts-root` is readable.

This invalidates benchmark scores because an agent can recover expected values, fact contracts, evaluation roles, or accepted-schema hints without using the listed corpus documents or MCP schema discovery. The current test only checks the rendered prompt (`examples/eval/scripts/e2e-mcp-agent.test.mjs:139`), not the process-readable filesystem.

The runner needs a real read boundary, such as copying only allowed corpus documents into a temporary agent workspace and launching the agent there, while keeping profiles, manifests, storage maps, expected snapshots, validation reports, and score artifacts outside the readable scope.

### 2. Agent subprocesses inherit `EVAL_AUTH_TOKEN` and can bypass MCP

`parseArgs` accepts `EVAL_AUTH_TOKEN` into `options.authToken` (`examples/eval/scripts/e2e-mcp-agent.mjs:526`), and `spawn` is called without an explicit `env` (`examples/eval/scripts/e2e-mcp-agent.mjs:745`). Node therefore inherits the runner environment into Codex, Claude, and command agents.

That exposes the backend bearer token to the evaluated agent. The agent can inspect env vars and call GraphQL or product HTTP endpoints directly, bypassing the MCP server, MCP permission grants, and the intended tool surface. Transcript redaction only removes exact token text after the fact; it does not prevent use of the token during the run.

The runner should launch agents with a curated environment that preserves only what the CLI needs, explicitly removing `EVAL_AUTH_TOKEN` and related eval/backend credentials unless there is a separate, deliberate adapter contract for them.

### 3. `mcp-agent-run.json` can be left as `running` on thrown agent-stage failures

The runner writes an initial `mcp-agent-run.json` after setup (`examples/eval/scripts/e2e-mcp-agent.mjs:154`). During `run-mcp-agent`, failures thrown while rendering/writing the prompt, invoking the adapter, writing the transcript, or updating the agent artifact are caught only by generic `runStage` handling (`examples/eval/scripts/e2e-mcp-agent.mjs:461`). That updates `evaluation-run.json`, but it does not update `agentRun.status`, `endedAt`, or `error`.

The tested failure path covers an adapter returning a nonzero result (`examples/eval/scripts/e2e-mcp-agent.test.mjs:312`), not an adapter or prompt path throwing. In those thrown cases, operators can get an `evaluation-run.json` that says `run-mcp-agent` failed while `mcp-agent-run.json` still says `running`.

The agent stage should use a `try`/`catch` or `finally` around the whole prompt/adapter/transcript flow and persist a failed `mcp-agent-run.json` whenever the stage fails after the artifact has been initialized.

### 4. Shared setup extraction loses `eval:ingest-documents` partial failure detail

`runIngestDocuments` now awaits `prepareKnownSchemaMemory` before copying `backendUserId`, `reset`, or `definitionSetup` into the report (`examples/eval/scripts/ingest-documents.mjs:55`). The helper performs side effects in sequence: `me`, optional `resetMyMemory`, then definition setup (`examples/eval/scripts/ingestor/setup.mjs:55`). If definition setup throws after a reset, the catch path writes a failed ingestion report without recording the backend user or reset that already happened.

That is a regression in failure diagnostics for `eval:ingest-documents`: a setup failure can now hide state-changing work that occurred before the failure. The existing incompatible-definition test exercises the failure (`examples/eval/scripts/ingest-documents.test.mjs:256`), but it does not assert that prior setup side effects are represented in the partial artifact.

The helper should either expose incremental setup state to the caller or split side-effectful steps so the ingestion runner can record `backendUserId` and reset results before later definition failures.

## Optional Follow-Ups

- Redaction is narrow. `mcp-agent-run.agent.command` and the transcript redact only `options.authToken` (`examples/eval/scripts/e2e-mcp-agent.mjs:1200`). If `--agent-command` contains other secrets, they are persisted.
- `--mcp-server` is currently only prompt text (`examples/eval/scripts/e2e-mcp-agent.mjs:719`). There is no adapter preflight proving that the named server is configured or that the agent used that server rather than other tools.
- The prompt says to inspect schema "if needed" and does not explicitly require a final MCP readback verification (`examples/eval/prompts/mcp-known-schema.md:21`). The brainstorm called out final active-memory verification as expected behavior.
- `evaluation-run.schema.json` accepts MCP modes without requiring MCP-specific settings or `setup`/`agent` summaries (`examples/eval/schemas/evaluation-run.schema.json:60`). The implementation writes them, but the schema would not catch their omission for MCP artifacts.
- A live Codex/Claude MCP smoke remains unrun, which matches the implementation summary. The fake command tests do not prove the Codex/Claude adapters can access the configured MCP server.

## Verified

Passed:

```bash
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/ingest-documents.test.mjs
pnpm eval:validate
```

`pnpm eval:validate` reported the existing Alex realistic corpus warnings and no errors (`errors=0 warnings=11`).

Not run: live MCP smoke against `context-router-local`; backend, `EVAL_AUTH_TOKEN`, and authenticated local MCP config are required.

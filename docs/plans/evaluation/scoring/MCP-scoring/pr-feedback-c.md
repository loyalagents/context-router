# MCP Known-Schema Eval Runner Review C

- Review date: 2026-06-16
- Compared against prior feedback in `pr-feedback-b.md` and the latest commit
  `5d0a5fc` (`Harden MCP eval runner contracts and docs`).

## Prior Feedback Status

The latest change materially addresses the previous review:

- MCP/backend identity is now represented honestly in
  `mcp-agent-run.json` as unverified, and the docs/TODO classify live Claude
  results as smoke-only until a hard identity preflight exists.
- The deterministic command adapter now requires
  `--allow-test-command-agent`, is documented as test-only, and records
  `commandAdapterTestOnly`.
- The staged workspace and artifact schema now explicitly record
  `containsOnlyDeclaredDocuments: true` and `hardFilesystemBoundary: false`.
- The Claude/provider auth environment allowlist now covers headless/cloud auth
  paths, and normal agent transcripts redact those allowed provider secrets.

## Must Fix Before Credentialed Live Runs

### 1. Provider auth secrets can still leak through thrown agent-stage failures

The new redaction support correctly includes allowed Claude/model-provider
credentials for normal agent output. `runMcpAgentStage` builds
`redactionSecrets` from `agentArtifactSecrets(options, buildAgentEnvironment(env))`
and uses it for the agent transcript and `mcp-agent-run.json`
(`examples/eval/scripts/e2e-mcp-agent.mjs:383`,
`examples/eval/scripts/e2e-mcp-agent.mjs:421`,
`examples/eval/scripts/e2e-mcp-agent.mjs:483`).

However, the catch block then rethrows the original raw error
(`examples/eval/scripts/e2e-mcp-agent.mjs:492`). The outer stage recorder stores
that thrown error in `evaluation-run.json` after redacting only
`options.authToken` (`examples/eval/scripts/e2e-mcp-agent.mjs:508`), and the
top-level catch has the same auth-token-only redaction
(`examples/eval/scripts/e2e-mcp-agent.mjs:346`). Since the latest change now
passes provider credentials such as `ANTHROPIC_API_KEY`,
`CLAUDE_CODE_OAUTH_TOKEN`, AWS, Google, and Azure auth variables into the child
environment (`examples/eval/scripts/e2e-mcp-agent.mjs:1417`), any thrown error
that includes one of those values can leak it into `evaluation-run.json` or CLI
output even though `mcp-agent-run.json` is redacted.

The current tests cover thrown-stage redaction only when the thrown value is the
eval auth token (`examples/eval/scripts/e2e-mcp-agent.test.mjs:548`). They also
cover provider-secret redaction for normal transcript output
(`examples/eval/scripts/e2e-mcp-agent.test.mjs:440`), but not the thrown-error
path.

Recommendation: use the same provider-aware redaction set for outer
`run-mcp-agent` stage errors, or return a redacted failure result from
`runMcpAgentStage` instead of rethrowing the raw error. Add a regression where
`env.ANTHROPIC_API_KEY` or `env.CLAUDE_CODE_OAUTH_TOKEN` appears in a thrown
agent error, then assert it is absent from both `evaluation-run.json` and CLI
lines.

## Optional Follow-Ups

- None from this pass. The hard MCP/backend identity preflight remains an
  explicit follow-up in the docs and TODO, not a hidden contract issue in this
  revision.

## Verification

Passed:

```bash
node --test examples/eval/scripts/e2e-mcp-agent.test.mjs examples/eval/scripts/ingest-documents.test.mjs
pnpm eval:validate
pnpm eval:test
pnpm eval:verify
```

`pnpm eval:validate` still reports the existing 11 Alex realistic corpus
warnings and no errors.

# Claude Code Direct Baseline Implementation Plan

- Status: implemented, live run pending
- Last updated: 2026-06-29
- Scope: packet eval runner and comparable Claude Code model/thinking controls

## Goal

Add a Claude Code direct packet baseline for `packet-hard-required-v4` so the
v4 result can answer whether MCP Claude solved the packet because of
Claude/agentic reasoning or because MCP/backend memory helped.

A Claude Code direct baseline means Claude Code CLI reads the same packet
evidence and produces direct extraction/fill outputs without using context
router memory as an information source.

It must not use:

- MCP tools or `mcp__*` tools.
- Backend memory reads or writes.
- GraphQL/DB memory export, import, or lookup as model context.
- Context-router memory APIs as an information source.

Validation, scoring, local PDF filling, and synthetic-memory artifact scoring
may still run after model output.

## Recommended Design

Use one packet-level open-schema extraction pass, then one fact-only fill pass
per scenario.

Options considered:

- Claude directly returns form fill actions from packet docs. This is the
  closest no-memory path, but loses memory-score comparability and conflates
  evidence extraction with rendering.
- Claude extracts open-schema facts, then the existing direct form-fill runner
  fills forms. This is recommended because it reuses the direct packet artifact
  and scoring path, preserves `memoryKnownRecovered`, and isolates Claude Code
  generation from MCP/backend memory.
- Claude produces a memory-like artifact without storing it in the backend. This
  may be useful later, but adds more contract surface than needed because the
  direct runner already creates `synthetic-memory-snapshot.json`.

Implementation shape:

- Add `pnpm eval:claude-code-direct-packet`.
- Reuse `direct-open-schema-packet` validation, document ordering, synthetic
  memory scoring, local PDF fill, form scoring, and packet artifacts.
- Add a Claude Code CLI adapter using `claude --print --output-format
  stream-json --verbose --no-session-persistence`.
- For the direct runner, prepare an isolated Claude workspace containing only
  ordered packet documents plus `documents.json`; allow only `Read,Glob,Grep`;
  pass `--mcp-config '{"mcpServers":{}}' --strict-mcp-config`;
  use `--safe-mode --disable-slash-commands --setting-sources project`; do not
  allow `mcp__*` tools.
- The direct runner is not an OS-level filesystem sandbox. The isolation claim
  is that the runner does not intentionally provide MCP/backend memory and
  starts Claude Code in a restricted workspace with restricted tools/config.
- Keep one-scenario direct passes as a later diagnostic, not the headline
  baseline.

Expected direct command:

```bash
pnpm eval:claude-code-direct-packet \
  --user maya-chen-newhire \
  --corpus packet-hard-required-v4 \
  --scenarios maya-chen-newhire-i9-packet-hard-required-v4,maya-chen-newhire-fw4-packet-hard-required-v4,maya-chen-newhire-direct-deposit-packet-hard-required-v4 \
  --artifacts-root /private/tmp/maya-required-v4-claude-direct \
  --model claude-sonnet-4-20250514 \
  --thinking-mode default \
  --document-order canonical
```

Expected MCP comparison command:

```bash
pnpm eval:e2e-mcp-packet \
  --agent claude \
  --model claude-sonnet-4-20250514 \
  --thinking-mode default \
  --schema-mode open \
  --form-mode backend \
  --user maya-chen-newhire \
  --corpus packet-hard-required-v4 \
  --scenarios maya-chen-newhire-i9-packet-hard-required-v4,maya-chen-newhire-fw4-packet-hard-required-v4,maya-chen-newhire-direct-deposit-packet-hard-required-v4 \
  --artifacts-root /private/tmp/maya-required-v4-mcp-canonical \
  --mcp-server context-router-local \
  --mcp-config /private/tmp/context-router-mcp.json \
  --reset-memory \
  --document-order canonical
```

## Model And Thinking Controls

Claude Code 2.1.195 exposes `--model` and `--effort
low|medium|high|xhigh|max`. Its help output did not show a real thinking-budget
flag.

Controls:

- `--model` is passed through to Claude Code for the direct runner and MCP
  Claude packet runner.
- `--model-label` remains a metadata-only fallback for older MCP runs.
- `--thinking-mode default|low|medium|high|xhigh|max` is supported.
- `default` omits `--effort`; other values map directly to `--effort`.
- No fake thinking-budget control is exposed. Artifacts record `budget: null`.

Metadata shape:

```json
{
  "agent": "claude",
  "model": {
    "label": "claude-sonnet-4-20250514",
    "source": "manual"
  },
  "thinking": {
    "mode": "default",
    "budget": null,
    "source": "manual"
  }
}
```

The `source` field distinguishes CLI-provided (`manual`), env-provided (`env`),
and defaulted (`default`) controls. Non-Claude MCP packet runs record
`thinking: null`.

MCP packet control changes are included with the direct runner because they are
limited to CLI parsing, Claude invocation flags, and packet-run artifact
metadata. Broader single-scenario `mcp-agent-run` schema changes remain a
follow-up if needed.

Until direct and MCP command artifacts both record model/thinking settings for a
given live comparison, direct-vs-MCP conclusions should be treated as
provisional.

## Artifacts

Required direct artifacts:

- Root `packet-evaluation-run.json`.
- Root `claude-direct-workspace/` containing only ordered packet documents,
  `documents.json`, and workspace instructions.
- Root `open-schema-extraction-prompt.md`.
- Root `open-schema-extraction-response.json`.
- Root `claude-extraction-transcript.txt` for Claude Code direct runs.
- Root `open-schema-extraction.json`.
- Root `synthetic-memory-snapshot.json`.
- Root `open-schema-database-score-report.json`.
- Per-scenario `direct-open-schema-fill-prompt.md`.
- Per-scenario `direct-open-schema-fill-response.json`.
- Per-scenario `claude-fill-transcript.txt` for Claude Code direct runs.
- Per-scenario `filled-form.json`, `filled-form.pdf`,
  `form-score-report.json`, and `open-schema-combined-score-report.json`.

Vertex direct packet runs keep transcript artifact fields null or absent rather
than advertising Claude transcript files that were not written.

The MCP packet runner must also persist comparable model/thinking metadata in
`packet-evaluation-run.json`.

## Checkpoints And Tests

1. Docs and command shape:
   - Add this plan and the implementation summary.
   - Update tracking with the planned baseline note.
   - Test: docs-only review.
2. Claude CLI adapter:
   - Build invocation, stream transcript capture, JSON text extraction, timeout
     handling, strict empty MCP config, project-only setting sources, and
     no-MCP direct tool flags.
   - Test with fake stream-json output; no live Claude required.
3. Direct packet runner:
   - Add `claude-code` provider and wrapper script.
   - Record provider-specific evaluation mode, model/thinking metadata, and
     transcript paths.
   - Test one extraction plus three fill passes with fake model output.
4. MCP packet controls:
   - Add `--model` and `--thinking-mode`.
   - Pass `--model` and `--effort` to Claude Code when `--agent claude`.
   - Persist packet-run model/thinking metadata.
   - Update MCP packet and shared invocation tests.

Future live acceptance:

- Validate v4 fixtures still pass.
- Run Claude Code direct v4 canonical.
- Run MCP Claude v4 canonical with the same model/thinking settings.
- Compare against Gemini direct v4 flash-lite, Gemini direct v4 pro, and MCP
  Claude v4.
- Compare `knownFieldCorrect`, per-scenario scores, wrong/missing fields,
  overfills, ownership/stale leaks, `DDA -> checking`, RDFI key lookup, W-4
  choice-code lookup, and I-9 citizenship normalization.

## Risks And Assumptions

Risks:

- Prompt nondeterminism and single-run variance.
- Cost/runtime for multiple Claude Code CLI calls.
- Large stream-json transcripts and corpus PII.
- Structured-output validation failures.
- Artifact compatibility with existing packet reporting.
- Fair comparison gap because MCP uses backend form fill while direct uses local
  fact-to-fill.
- Packet-level versus scenario-level Claude pass may affect results.
- Local Claude CLI does not expose a real thinking-budget control.
- Claude Code direct is not protected by a separate OS filesystem sandbox; live
  acceptance should inspect transcripts when global Claude configuration exists.

Assumptions:

- Initial baseline uses one packet-level extraction pass.
- `--thinking-mode default` means no `--effort` flag.
- Existing direct packet scoring remains the right comparison surface.
- Historical comparisons without model/thinking metadata are directional only.

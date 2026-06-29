# Claude Code Direct Baseline Implementation Summary

- Status: runner implemented, live evaluation not started
- Last updated: 2026-06-29
- Scope: Claude Code direct packet baseline and comparable MCP model/thinking controls

## What Plan Was Produced

The plan defines a Claude Code direct packet baseline for
`packet-hard-required-v4` to distinguish Claude/agentic reasoning from
MCP/backend-memory assistance.

The direct baseline is explicitly no-MCP and no-backend-memory as a model
information source. Scoring still uses the existing synthetic memory snapshot,
local PDF fill, and packet form reports.

## Recommended Design

Use one packet-level open-schema extraction pass, then one fact-only fill pass
per scenario.

This reuses the existing direct packet scoring surface, keeps
`memoryKnownRecovered`, and avoids introducing a separate memory-artifact
contract before it is needed.

## Model And Thinking Decision

Claude Code CLI support observed locally:

- `--model` is supported and is passed through for Claude direct and MCP packet
  Claude runs.
- `--effort low|medium|high|xhigh|max` is supported.
- No real thinking-budget flag was visible in `claude --help`.

The implemented control is `--thinking-mode
default|low|medium|high|xhigh|max`. `default` omits `--effort`; other values
map to `--effort`. Artifacts record `budget: null`.

## MCP Runner Decision

The MCP packet runner control changes were included in the same implementation
because they were limited to CLI parsing, Claude invocation flags, and packet
artifact metadata.

Broader single-scenario `mcp-agent-run` artifact/schema changes remain a
follow-up if the single-scenario MCP runner needs full thinking metadata.

## Open Questions

- Whether Claude Code direct should later rely on filesystem reads as the main
  evidence channel instead of the current direct packet prompt style, which also
  provides evidence inline.
- Whether repeat runs are needed before interpreting v4 direct-vs-MCP deltas.
- Whether a future Claude CLI exposes a real thinking-budget flag that should
  replace `budget: null`.
- Whether the direct path should eventually support a scenario-level diagnostic
  pass in addition to the packet-level baseline.

## Docs Updated

- Added `implementation-plan.md` in this directory.
- Added this `implementation-summary.md`.
- Updated `TRACKING.md` with the Claude Code direct baseline note and
  provisional-comparison warning.

## Implementation Status

Code changes were made:

- Added `pnpm eval:claude-code-direct-packet`.
- Added a Claude Code CLI adapter with stream-json transcript capture.
- Added `claude-code` provider support to the direct open-schema packet runner.
- Added model/thinking metadata to direct and MCP packet artifacts.
- Added `--model` and `--thinking-mode` controls for MCP packet Claude runs.
- Added targeted unit coverage with fake model output; no live Claude eval was
  run.

Live v4 acceptance is still pending.

# Claude Code Direct Baseline Implementation Summary

- Status: runner implemented, live evaluation not started
- Last updated: 2026-06-29
- Scope: Claude Code direct packet baseline and comparable MCP model/thinking controls

## What Plan Was Produced

The plan defines a Claude Code direct packet baseline for
`packet-hard-required-v4` to distinguish Claude/agentic reasoning from
MCP/backend-memory assistance.

The direct baseline is explicitly no-MCP and no-backend-memory as a model
information source during extraction. The canonical comparison now materializes
the extracted synthetic memory into backend memory after extraction, then uses
the same backend form-fill endpoint as MCP packet runs.

The implementation uses a restricted Claude Code invocation with an isolated
document workspace, `Read,Glob,Grep` only, strict empty MCP config, safe mode,
disabled slash commands, and project-only setting sources. It is not an
OS-level filesystem sandbox. Because safe mode disables `CLAUDE.md`, the
workspace-only/no-backend guard is included in the actual Claude prompt.

## Recommended Design

Use one packet-level open-schema extraction pass, then backend materialized form
fill per scenario.

This keeps `memoryKnownRecovered`, preserves the synthetic extraction artifact,
and isolates extraction quality by sharing the MCP packet backend form-fill
path. The old local fact-only fill path remains a diagnostic/historical direct
mode.

## Model And Thinking Decision

Claude Code CLI support observed locally:

- `--model` is supported and is passed through for Claude direct and MCP packet
  Claude runs.
- `--effort low|medium|high|xhigh|max` is supported.
- No real thinking-budget flag was visible in `claude --help`.

The implemented control is `--thinking-mode
default|low|medium|high|xhigh|max`. `default` omits `--effort`; other values
map to `--effort`. Artifacts record `budget: null`. Model metadata now
distinguishes CLI-provided, env-provided, and missing sources; thinking
metadata distinguishes CLI-provided, env-provided, and defaulted sources.
Non-Claude MCP packet/direct runs record `thinking: null`; invalid
`EVAL_THINKING_MODE` values are ignored for non-Claude paths, while explicit
`--thinking-mode` is rejected unless the selected agent/provider is Claude.

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
- Whether a future baseline should add an external filesystem sandbox around
  Claude Code rather than relying on Claude Code tool/config restrictions.
- Whether repeat runs are needed before interpreting v4 direct-vs-MCP deltas.
- Whether a future Claude CLI exposes a real thinking-budget flag that should
  replace `budget: null`.
- Whether the direct path should eventually support a scenario-level diagnostic
  pass in addition to the packet-level baseline.
- Whether duplicate extracted slugs need a stricter policy than deterministic
  backend overwrite semantics.

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
- Added `--fill-mode local-fact-fill|backend`; backend is the canonical Claude
  direct comparison mode, local fact-fill remains diagnostic.
- Added synthetic-memory materialization through existing GraphQL client
  primitives: reset memory, create definitions, suggest extracted preferences,
  accept suggestions, export materialized backend memory, and call backend form
  fill.
- Added `memory-materialization-report.json`,
  `memory-snapshot-after-materialization.json`, and per-scenario
  `form-fill-response.json` artifacts for backend fill mode.
- Direct packet failures from invalid extraction/fill contracts now finalize
  `packet-evaluation-run.json` with `status: fail`, `endedAt`, and
  `failureStage`.
- Added strict empty MCP config, safe mode, disabled slash commands, and
  project-only setting sources for Claude Code direct calls.
- Added the workspace-only/no-backend runtime guard to the actual Claude direct
  prompt.
- Added provider-specific direct open-schema evaluation mode and synthetic
  memory producer metadata.
- Kept Vertex direct packet artifact maps from advertising missing Claude
  transcript files.
- Made the Claude-named direct entrypoint reject non-Claude providers.
- Added model/thinking metadata to direct and MCP packet artifacts, including
  env/manual/default source tracking where applicable.
- Updated the single-scenario `evaluation-run` schema to accept env-sourced
  model metadata.
- Set Claude Code direct model precedence to CLI `--model`, then
  `EVAL_CLAUDE_CODE_MODEL`, then `EVAL_MODEL`.
- Added `--model` and `--thinking-mode` controls for MCP packet Claude runs.
- Made MCP/direct thinking controls apply only to Claude runs and record source
  more precisely.
- Added targeted unit coverage with fake model output; no live Claude eval was
  run.

Live v4 acceptance is still pending.

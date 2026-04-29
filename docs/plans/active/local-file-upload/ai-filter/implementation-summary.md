# AI Filter Implementation Summary

- Status: shipped
- Scope: `apps/local-orchestrator`
- Last updated: 2026-04-28

## What Shipped

The local orchestrator now supports optional local AI filtering through a `command` adapter.

Shipped behavior:

- removed legacy `--file-filter` and `--suggestion-filter` CLI flags
- added `--ai-filter`, `--ai-filter-stage`, `--ai-adapter`, `--ai-command`, `--ai-goal`, and `--ai-timeout-ms`
- upgraded manifest output to schema `version: 2` for every run
- refactored suggestion filtering to batch mode, one decision set per analyzed file
- added suggestion-stage AI filtering for curation after backend analysis
- added file-stage AI filtering for text-like preview triage before upload
- added dry-run fallback and apply-mode skip semantics for adapter failures
- added `filterAudit` evidence for accepted AI-filtered suggestions
- added AI-specific manifest and terminal summary reporting

## Final CLI Contract

Required base flags:

- `--folder <path>`
- `--token <token>` or `CONTEXT_ROUTER_BEARER_TOKEN`

Optional base flags:

- `--backend-url <url>`
- `--apply`
- `--concurrency <n>`
- `--out <path>`

AI flags:

- `--ai-filter`
- `--ai-filter-stage suggestion|file|both`
- `--ai-adapter command`
- `--ai-command <path-or-name>`
- `--ai-goal <text>`
- `--ai-timeout-ms <n>`

Validation rules:

- any `--ai-*` flag without `--ai-filter` is rejected
- `--ai-goal` is required when AI filtering is enabled
- `--ai-command` is required for the `command` adapter
- `--ai-command` is only valid for the `command` adapter

## Manifest v2

All runs now emit:

- `version: 2`
- `config.aiFilter.enabled`
- `config.aiFilter.stage`
- `config.aiFilter.adapter`
- `config.aiFilter.command`
- `config.aiFilter.goal`
- `config.aiFilter.timeoutMs`
- `config.aiFilter.promptVersion`
- `config.aiFilter.failurePolicy`

Per-file records can now include:

- `fileFilter.source`
- `suggestionDecisions[].source`
- `suggestionDecisions[].details`
- `ai.fileStage`
- `ai.suggestionStage`

Summary output now includes:

- AI file skip and bypass counts
- AI suggestion apply and skip counts
- fallback-accepted suggestion counts
- adapter failure counts
- apply-skipped file counts
- degraded-run status

## Command Adapter Contract

The orchestrator spawns the executable named by `--ai-command` and sends one JSON request on `stdin`.

Suggestion-stage request includes:

- goal text
- file metadata
- backend analysis metadata
- backend-accepted suggestions
- backend-filtered suggestions for context

Suggestion-stage response must return exactly one decision per input suggestion:

- `suggestionId`
- `action` as `apply` or `skip`
- `reason`
- optional `score`
- optional `details`

File-stage request includes:

- goal text
- file metadata
- bounded UTF-8 preview for text-like files

File-stage response must return:

- `action` as `analyze` or `skip`
- `reason`
- optional `score`
- optional `details`

Invalid JSON, malformed schemas, duplicate or missing suggestion IDs, spawn failures, non-zero exit codes, and timeouts are treated as adapter failures.

## Failure Semantics

Suggestion stage:

- dry-run adapter failure:
  - records adapter failure in manifest
  - falls back to passthrough suggestion decisions for that file
  - marks the run degraded
  - exits non-zero
- apply-mode adapter failure:
  - records adapter failure in manifest
  - skips apply for that file
  - continues the rest of the run
  - exits non-zero

File stage:

- adapter failure falls back to analyzing the file
- non-text-like files bypass local file-stage AI in V1 and continue through normal backend analysis

## Audit Bridge

Accepted AI-filtered suggestions now attach `filterAudit` in apply evidence with:

- stage
- adapter
- goal
- decision
- score
- reason

This preserves a local-to-backend trace:

- local manifest holds the full AI decision trail
- backend audit remains the write-of-record surface
- `analysisId` still bridges local manifest entries to backend audit `correlationId`

## Tests Run

- `pnpm --filter local-orchestrator test`
- `pnpm --filter local-orchestrator lint`
- `pnpm --filter local-orchestrator build`

## Known Limitations

- only the `command` adapter is shipped
- named built-in AI policies are not implemented
- file-stage previewing is text-first and bypasses non-text-like files in V1
- mislabeled binary files that look text-like can still produce low-quality preview text
- AI filtering narrows backend-accepted suggestions only; it cannot revive backend-filtered output

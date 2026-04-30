# Codex/Claude Wrapper Scripts Implementation Summary

- Status: shipped
- Scope: `apps/local-orchestrator`
- Last updated: 2026-04-29

## What Shipped

The local orchestrator now supports repo-owned Codex and Claude wrapper scripts on top of the existing `command` adapter.

Shipped behavior:

- kept `--ai-adapter command` as the only adapter mode
- added repeatable `--ai-command-arg <value>` support to the CLI
- forwarded command adapter args through runtime filter construction and child-process spawn
- extended manifest v2 with `config.aiFilter.commandArgs`
- added executable wrapper scripts:
  - `apps/local-orchestrator/scripts/claude-filter.mjs`
  - `apps/local-orchestrator/scripts/codex-filter.mjs`
- added a shared wrapper helper for prompt-building, provider-response validation, and subprocess execution
- supported both `file` and `suggestion` stages in each wrapper script
- standardized stage-specific prompt versions:
  - `claude-filter-file-v1`
  - `claude-filter-suggestion-v1`
  - `codex-filter-file-v1`
  - `codex-filter-suggestion-v1`
- updated package README/help examples and local orchestrator operator docs

## Final CLI Surface

AI flags now include:

- `--ai-filter`
- `--ai-filter-stage suggestion|file|both`
- `--ai-adapter command`
- `--ai-command <path-or-name>`
- `--ai-command-arg <value>` repeatable
- `--ai-goal <text>`
- `--ai-timeout-ms <n>`

Validation rules:

- any `--ai-*` flag without `--ai-filter` is rejected
- `--ai-goal` is required when AI filtering is enabled
- `--ai-command` is required for the `command` adapter
- `--ai-command-arg` requires `--ai-command`

## Wrapper Script Behavior

Claude wrapper:

- runs `claude` in non-interactive print mode
- disables tools
- applies JSON schema constraints to the provider response
- validates provider output again before returning adapter JSON

Codex wrapper:

- runs `codex exec` in non-interactive mode
- uses read-only sandboxing and ephemeral session state
- applies JSON schema constraints through `--output-schema`
- validates provider output again before returning adapter JSON

Shared behavior:

- read one adapter request JSON object from `stdin`
- branch on `stage`
- return the existing `command` adapter response shape on `stdout`
- exit non-zero with useful stderr on provider startup failure, provider non-zero exit, empty output, invalid JSON, or malformed decisions

## Tests Run

- `pnpm install --frozen-lockfile`
- `pnpm --filter local-orchestrator build`
- `pnpm --filter local-orchestrator lint`
- `pnpm --filter local-orchestrator test`

Added coverage for:

- repeated `--ai-command-arg` parsing and ordering
- command-adapter argv forwarding
- Claude wrapper `file` and `suggestion` success paths
- Codex wrapper `file` and `suggestion` success paths
- malformed provider output handling for both wrappers
- provider non-zero exit handling for both wrappers
- manifest emission of `config.aiFilter.commandArgs`
- README/help example alignment with the shipped script paths

## Known Limitations

- `command` remains the only adapter type; the new scripts are wrappers, not first-class native adapters
- the wrapper scripts assume the `claude` and `codex` CLIs are installed and authenticated on `PATH`
- the documented first-class wrapper argument is `--model`; richer provider-specific passthrough ergonomics are still future work
- file-stage AI remains text-first and still bypasses non-text-like files locally in V1

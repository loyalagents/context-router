# Local File Upload TODO

- Status: follow-up
- Read when: planning work beyond the initial local orchestrator build
- Last reviewed: 2026-04-30

## Backend and API follow-ups

- Consider a richer apply response that can report per-suggestion outcomes directly rather than requiring client-side reconciliation by slug.
- Add request pacing or rate limiting around the document-analysis upload path to better control Vertex AI cost and quota usage for batch imports.
- Add a server-owned batch import/orchestrator mode for UI-driven or durable runs.
- Define a hybrid handoff mode where the local side prefilters files and the server owns the rest of the run.
- Consider first-class backend MIME or parser support for additional config-like formats that currently flow through the local orchestrator as `text/plain`, and keep provider-aware MIME normalization in mind for types that the API accepts but Vertex file ingestion does not.

## Local orchestrator follow-ups

- Current behavior:
  - local AI filtering now supports `suggestion`, `file`, and `both` stages through the `command` adapter
  - preference extraction still happens on the backend via `POST /api/preferences/analysis`
  - persistence still happens on the backend via GraphQL `applyPreferenceSuggestions`
  - markdown and YAML now upload natively
  - `.toml`, `.ini`, `.cfg`, `.conf`, `.env`, and `.env.*` now upload through local `text/plain` mapping
  - hidden files and directories are still skipped by default, with opt-in traversal through `--include-hidden`

- Consider first-class native adapters beyond the current `command` plus wrapper-script approach, such as Ollama or built-in `codex` and `claude` modes.
- Add richer wrapper configuration beyond the current `--model` passthrough, such as named provider presets, per-provider defaults, or config-backed profiles.
- Add named built-in AI policies so common curation goals do not require raw prompt text every time.
- Add heuristic filters that can run without a model dependency.
- Add hash-based dedupe/resume so repeated runs on the same folder can skip unchanged files.
- Add broader hidden-file allowlists beyond `.env` and `.env.*` for meaningful dotfiles such as `.gitconfig`, `.npmrc`, or user-selected patterns.
- Add token refresh or improved auth ergonomics for long-running imports.
- Add retry and pacing policies for analysis/apply requests.
- Add a repeated-apply smoke check for the local orchestrator so we explicitly validate what happens when `--apply` is run multiple times against the same folder and user.
- Improve file-stage AI triage for borderline text-like or mislabeled binary files.
- Add content sniffing or better filename heuristics so support is not purely extension/basename driven.
- Consider more easy text-like formats such as CSV, TSV, XML, or HTML if real import data suggests they are valuable.
- Consider migrating from `node:test` to Jest if the package grows enough that monorepo consistency becomes more valuable than a lighter dependency footprint.

## Persistence and writer follow-ups

- Add an MCP-backed writer adapter using `mutatePreferences` for direct machine writes and future definition-aware imports.
- Support definition creation for missing user-owned slugs where the local or server agent has enough confidence to define and write.

## Product and observability follow-ups

- Add durable import run history instead of local-manifest-only observability.
- Add richer summary/reporting output for large imports.
- Add stronger real-backend integration tests or smoke automation when bearer tokens and a running backend are available.
- Consider dashboard parity for config-like local file types if product wants single-file browser uploads beyond the current backend-native document set.

# Local File Upload TODO

- Status: follow-up
- Read when: planning work beyond the initial local orchestrator build
- Last reviewed: 2026-04-28

## Backend and API follow-ups

- Add first-class backend MIME support for markdown and YAML instead of relying on client-side `text/plain` coercion.
- Consider a richer apply response that can report per-suggestion outcomes directly rather than requiring client-side reconciliation by slug.
- Add request pacing or rate limiting around the document-analysis upload path to better control Vertex AI cost and quota usage for batch imports.
- Add a server-owned batch import/orchestrator mode for UI-driven or durable runs.
- Define a hybrid handoff mode where the local side prefilters files and the server owns the rest of the run.

## Local orchestrator follow-ups

- Current behavior:
  - local AI filtering now supports `suggestion`, `file`, and `both` stages through the `command` adapter
  - preference extraction still happens on the backend via `POST /api/preferences/analysis`
  - persistence still happens on the backend via GraphQL `applyPreferenceSuggestions`

- Consider first-class native adapters beyond the current `command` plus wrapper-script approach, such as Ollama or built-in `codex` and `claude` modes.
- Add richer wrapper configuration beyond the current `--model` passthrough, such as named provider presets, per-provider defaults, or config-backed profiles.
- Add named built-in AI policies so common curation goals do not require raw prompt text every time.
- Add heuristic filters that can run without a model dependency.
- Add hash-based dedupe/resume so repeated runs on the same folder can skip unchanged files.
- Add an `--include-hidden` option or allowlist for meaningful dotfiles.
- Add token refresh or improved auth ergonomics for long-running imports.
- Add retry and pacing policies for analysis/apply requests.
- Improve file-stage AI triage for borderline text-like or mislabeled binary files.
- Consider migrating from `node:test` to Jest if the package grows enough that monorepo consistency becomes more valuable than a lighter dependency footprint.

## Persistence and writer follow-ups

- Add an MCP-backed writer adapter using `mutatePreferences` for direct machine writes and future definition-aware imports.
- Support definition creation for missing user-owned slugs where the local or server agent has enough confidence to define and write.

## Product and observability follow-ups

- Add durable import run history instead of local-manifest-only observability.
- Add richer summary/reporting output for large imports.
- Add stronger real-backend integration tests or smoke automation when bearer tokens and a running backend are available.

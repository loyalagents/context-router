# Implement `apps/local-orchestrator` V1

## Summary

Build a new workspace package at `apps/local-orchestrator` that acts as a local-first batch import client for preference extraction. V1 owns the orchestration loop locally, reuses the existing backend analysis and apply primitives, defaults to dry-run, and supports real writes behind `--apply`. The package ships only passthrough file/suggestion filters plus stable interfaces for future local-agent adapters. Do not change backend MIME support in V1; coerce common text-like local files to `text/plain` in the orchestrator, document the extraction-quality tradeoff, and add first-class backend MIME support to `docs/plans/active/local-file-upload/TODO.md`.

## Implementation Changes

### Checkpoint 1: Workspace scaffold, CLI contract, and package docs
- Create a new pnpm workspace package `apps/local-orchestrator` with its own `package.json`, `tsconfig.json`, `src/`, and scripts: `start`, `build`, `test`, `lint`.
- Use a lightweight Node 20 toolchain: `typescript`, `tsx`, `@types/node`; use native `fetch`, `FormData`, and `Blob` rather than adding HTTP/GraphQL client libraries.
- Use `node:test` via `tsx --test` for package tests; use `tsc --noEmit` for the package `lint` script. Document this as a deliberate V1 tradeoff against monorepo consistency, not as a general repo standard.
- Expose one CLI entrypoint with explicit flags:
  - required `--folder`
  - optional `--backend-url` default `http://localhost:3000`
  - optional `--token` with env fallback `CONTEXT_ROUTER_BEARER_TOKEN`
  - optional boolean `--apply`, default `false`
  - optional `--concurrency`, default `1`
  - optional `--out` for JSON manifest path
  - optional `--file-filter`, default `passthrough`
  - optional `--suggestion-filter`, default `passthrough`
- Do not add root convenience scripts in V1; run via `pnpm --filter local-orchestrator start -- ...`.
- Add a short package README or package-level usage doc with:
  - one copy-paste example command
  - token/env expectations
  - dry-run vs `--apply`
  - note that hidden files are skipped by default
  - note that repeated runs are safe but not deduplicated in V1

### Checkpoint 2: Discovery, file policy, manifest schema, and dry-run analysis pipeline
- Implement the local orchestration stages as explicit modules: discover, file filter, analyze, suggestion filter, apply, summary.
- Define shared run shapes used across all stages:
  - discovered file record
  - file filter decision `{ action, reason, score? }`
  - analysis record
  - suggestion decision `{ suggestionId, action, reason, score? }`
  - apply result
  - run summary / manifest
- Add a manifest root schema with `version: 1`.
- Discovery rules:
  - recurse the requested folder
  - skip hidden directories/files by default, including dotfiles such as `.editorconfig`, `.eslintrc`, `.prettierrc`
  - accept backend-native formats directly: JSON, PDF, PNG, JPEG, TXT
  - coerce `.md`, `.markdown`, `.yml`, `.yaml` to `text/plain` for upload
  - skip everything else in V1 and record the skip reason in the manifest
- Document the MIME coercion limitation:
  - coercion is practical for V1
  - complex markdown/YAML structure may lose format-specific signal compared with first-class backend MIME support
- Implement only `PassthroughFileFilter` and `PassthroughSuggestionFilter` in V1, but keep filter interfaces stable and package-local so real local-agent adapters can be added later without changing the runner shape.
- Implement the analysis client against `POST /api/preferences/analysis`; treat the backend as an external service and do not import Nest internals.
- Define the V1 analysis failure policy explicitly:
  - per-file failures never abort the entire run
  - record the failure in the manifest and continue
  - no automatic retries in V1
  - handle both transport failures and backend-returned non-success statuses
- Record backend analysis output completely in the manifest:
  - `analysisId`
  - `status`
  - `statusReason`
  - `documentSummary`
  - `suggestions`
  - `filteredSuggestions`
  - `filteredCount`
- Include `filteredCount` and analysis-status counts in the console summary.
- Make the schema-gate constraint explicit in docs and summary behavior:
  - V1 can only import preferences for slugs that already exist in the preference catalog
  - unknown candidate slugs appear in `filteredSuggestions` as `UNKNOWN_SLUG`; they are not persisted
- Dry-run behavior:
  - analyze eligible files
  - never persist
  - print a compact console summary
  - optionally emit a JSON manifest when `--out` is provided
- Document concurrency behavior:
  - default `--concurrency 1`
  - V1 does not add pacing or retries
  - help text / README should warn that higher concurrency increases Vertex AI request volume, cost, and quota pressure because the backend has no explicit batch throttling for this path
  - note that backend `maxSuggestions` also bounds per-document output, so large folders can still produce large aggregate suggestion counts

### Checkpoint 3: Suggestion mapping, apply path, partial-failure handling, and V1 limitations
- Add the apply client against GraphQL `applyPreferenceSuggestions`; this is the V1 writer for accepted suggestions.
- Preserve the analysis-response `analysisId` and suggestion IDs exactly as returned by the backend. Do not synthesize new analysis IDs in the orchestrator.
- Apply behavior:
  - group accepted suggestions by the real `analysisId` from each analysis response
  - submit one `applyPreferenceSuggestions` mutation per analysis result
  - send only user-accepted suggestions
- Make the analysis-to-apply field mapping explicit:
  - `analysisSuggestion.id -> suggestionId`
  - `analysisSuggestion.slug -> slug`
  - `analysisSuggestion.operation -> operation`
  - `analysisSuggestion.newValue -> newValue`
  - `analysisSuggestion.confidence -> confidence` when present
  - `analysisSuggestion.sourceSnippet` plus `analysisSuggestion.sourceMeta` -> structured `evidence`
- Use a documented evidence shape in the orchestrator manifest and apply client, such as:
  - `{ source: "local-orchestrator", snippet, sourceMeta, filePath, relativePath }`
  - keep it additive and safe; the backend evidence field is JSON and does not require a stricter schema
- Handle the resolver’s partial-success semantics explicitly: `applyPreferenceSuggestions` may return fewer rows than requested without a GraphQL error, so the orchestrator must compare requested suggestion IDs against returned rows and record unmatched items as apply failures/unknown outcomes in the manifest and summary.
- Make repeated-run behavior explicit:
  - repeated runs are safe
  - V1 does not deduplicate by file hash or prior import history
  - repeated runs may yield `NO_CHANGE`/already-satisfied outcomes or new updates depending on current stored preferences
- Record token expiry as a known V1 limitation:
  - the CLI accepts a bearer token but does not refresh it
  - if the token expires mid-run, subsequent requests fail and are recorded per file/batch
- Keep the writer behind an internal adapter boundary so a future MCP-backed writer can replace or augment the GraphQL writer without changing the rest of the pipeline.
- Keep V1 policy simple:
  - no real local-agent adapter yet
  - no persistent resume/cache yet
  - no server orchestrator yet
  - no backend MIME/config changes yet

### Checkpoint 4: Tests, manual verification, and docs
- Package tests in `apps/local-orchestrator` for:
  - CLI argument parsing and defaults
  - recursive discovery
  - hidden-file skipping
  - MIME coercion rules for markdown/YAML
  - passthrough file/suggestion filters
  - analysis client request shaping
  - apply client request shaping
  - analysis failure recording and summary counts
  - filtered suggestion recording
  - partial apply result reconciliation
  - manifest generation, including `version: 1`
- Use real temp-directory filesystem fixtures for discovery tests (`fs.mkdtemp*`, nested dirs, hidden files, mixed extensions). Use mocked `fetch`/HTTP responses for analysis/apply client tests.
- Use mocked `fetch`/HTTP responses for the automated package suite; do not require live backend access for default tests.
- Add one opt-in smoke path for contract verification:
  - either a package script or documented procedure that runs against a real backend only when `CONTEXT_ROUTER_BEARER_TOKEN` is set
  - skip it by default in ordinary package tests/CI
- Run package gates at each checkpoint:
  - `pnpm --filter local-orchestrator build`
  - `pnpm --filter local-orchestrator test`
  - `pnpm --filter local-orchestrator lint`
- Final implementation step: add `docs/plans/active/local-file-upload/initial-build/implementation-summary.md`.
  - summarize what shipped
  - capture the CLI contract and package placement
  - document tests run
  - document known limitations including token expiry, no retries, no real local-agent adapter, local MIME coercion quality tradeoff, skipped hidden files, repeated-run behavior, schema-gate constraints, and partial-success semantics
- Final implementation step: add `docs/plans/active/local-file-upload/TODO.md`.
  - real local-agent adapters
  - heuristic filters
  - backend first-class MIME support for markdown/YAML
  - server orchestrator / hybrid handoff mode
  - durable import run history
  - hash-based resume/dedupe
  - optional MCP writer migration
  - token refresh/auth ergonomics
  - request pacing / retry policy
  - stronger real-backend integration testing
  - optional `--include-hidden` support
- Update `docs/plans/active/local-file-upload/initial-build/brainstorm.md` to add one explicit design constraint:
  - V1 can only import preferences for slugs that already exist in the preference catalog; unknown slugs are filtered by the analysis path and surface in `filteredSuggestions`

## Public Interfaces / Behavior

- New workspace package: `apps/local-orchestrator`
- New CLI behavior:
  - dry-run by default
  - `--apply` enables persistence
  - `--file-filter` and `--suggestion-filter` exist in V1 but only `passthrough` is implemented
  - `--out` writes a machine-readable manifest
  - `--concurrency` defaults to `1` and is intentionally conservative
- Manifest behavior:
  - root includes `version: 1`
  - includes both accepted suggestions and backend `filteredSuggestions`
- V1 upload policy for common local text files:
  - `.md`, `.markdown`, `.yml`, `.yaml` are uploaded as `text/plain`
  - backend MIME allowlist remains unchanged in V1
- V1 server calls:
  - REST `POST /api/preferences/analysis`
  - GraphQL `applyPreferenceSuggestions`

## Assumptions and Defaults

- The first implementation is local-orchestrated only; server orchestration is a later extension, not part of V1.
- V1 includes both analysis and optional apply; it is not analysis-only.
- V1 includes extension interfaces for local-agent filters, but no real model integration yet.
- Backend behavior is reused rather than changed, except for documentation; markdown/YAML support is handled client-side for now and explicitly tracked as future backend work.
- The local orchestrator is treated as an external client of the backend even though it lives in the same monorepo.
- Real-backend contract verification is desirable but remains opt-in rather than part of the default automated test suite in V1.
- `node:test` is a deliberate V1 package-local tradeoff for low dependency weight; if `apps/local-orchestrator` grows materially, aligning it with the repo’s Jest usage is a valid follow-up.
